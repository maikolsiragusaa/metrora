import * as z from 'zod/v4'

import type { LoadedLocalEndpointIdentityV1 } from './endpoint-identity.js'
import { reconcileMeasurementProductionReceiptsV1 } from './measurement-production-recovery.js'
import {
  CanonicalReviewedProductionSummaryV1Schema,
  produceCanonicalReviewedMeasurementsV1,
  type CanonicalReviewedProductionScanV1,
  type CanonicalReviewedProductionSummaryV1,
} from './reviewed-production-orchestrator.js'
import { createDesktopWorkspaceBootstrapSnapshotV1 } from './desktop-workspace-bootstrap-snapshot.js'
import type {
  DesktopWorkspaceRuntimeV1,
  DesktopWorkspaceSnapshotV1,
} from './desktop-workspace-runtime.js'
import {
  assertWorkspaceCapabilityV1,
  evaluateWorkspaceCapabilitiesV1,
  isReadOnlyCompatibilityV1,
} from './workspace-capability-policy.js'

export type DesktopCanonicalReviewedScannerInputV1 = {
  endpointId: string
  adapterVersion: string
  notBefore: string
}

export type DesktopCanonicalReviewedScannerV1 = (
  input: DesktopCanonicalReviewedScannerInputV1,
) => Promise<CanonicalReviewedProductionScanV1>

export type DesktopReviewedProductionResultV1 = {
  summary: CanonicalReviewedProductionSummaryV1
  snapshot: DesktopWorkspaceSnapshotV1
}

export const DesktopWorkspaceRecoverySummaryV1Schema = z.strictObject({
  kind: z.literal('metrora.desktop-workspace-recovery-summary'),
  version: z.literal(1),
  outcome: z.enum(['workspace-required', 'paused', 'verified-read-only', 'blocked', 'healthy', 'reconciled']),
  retryAttempted: z.boolean(),
  blocker: z.enum(['invalid-evidence', 'quarantined-evidence', 'blocked-evidence']).nullable(),
  receiptRepairCount: z.number().int().nonnegative(),
  production: CanonicalReviewedProductionSummaryV1Schema.nullable(),
}).superRefine((value, context) => {
  const passive = value.outcome === 'workspace-required'
    || value.outcome === 'paused'
    || value.outcome === 'verified-read-only'
  if (passive && (
    value.retryAttempted
    || value.blocker !== null
    || value.receiptRepairCount !== 0
    || value.production !== null
  )) {
    context.addIssue({ code: 'custom', message: `${value.outcome} recovery must not retry, repair, block, or produce` })
  }

  if (value.outcome === 'blocked') {
    if (
      value.retryAttempted
      || value.blocker === null
      || value.receiptRepairCount !== 0
      || value.production !== null
    ) {
      context.addIssue({ code: 'custom', message: 'blocked recovery requires one bounded blocker and no repair or retry' })
    }
    return
  }

  if (value.outcome === 'healthy' || value.outcome === 'reconciled') {
    if (!value.retryAttempted || value.blocker !== null || value.production?.outcome !== 'completed') {
      context.addIssue({ code: 'custom', message: `${value.outcome} recovery requires one completed bounded retry` })
      return
    }
    const reconciled = value.receiptRepairCount > 0 || value.production.existingCount > 0
    if (value.outcome === 'healthy' && reconciled) {
      context.addIssue({ code: 'custom', message: 'healthy recovery cannot report reconciled receipt or production state' })
    }
    if (value.outcome === 'reconciled' && !reconciled) {
      context.addIssue({ code: 'custom', message: 'reconciled recovery requires a repaired receipt or existing production state' })
    }
  }
})

export type DesktopWorkspaceRecoverySummaryV1 = z.infer<typeof DesktopWorkspaceRecoverySummaryV1Schema>

export type DesktopWorkspaceRecoveryResultV1 = {
  summary: DesktopWorkspaceRecoverySummaryV1
  snapshot: DesktopWorkspaceSnapshotV1
}

export interface DesktopReviewedProductionRuntimeV1 extends DesktopWorkspaceRuntimeV1 {
  getBootstrapSnapshot(): Promise<DesktopWorkspaceSnapshotV1>
  produceReviewedMeasurements(): Promise<DesktopReviewedProductionResultV1>
  recoverLocalState(): Promise<DesktopWorkspaceRecoveryResultV1>
}

export type AttachDesktopReviewedProductionV1Options = {
  runtime: DesktopWorkspaceRuntimeV1
  dataDir: string
  identity: LoadedLocalEndpointIdentityV1
  adapterVersion: string
  scanCanonicalCandidates?: DesktopCanonicalReviewedScannerV1
  now?: () => Date
}

export class DesktopReviewedProductionUnavailableError extends Error {
  constructor() {
    super('canonical reviewed-production scanner is unavailable')
    this.name = 'DesktopReviewedProductionUnavailableError'
  }
}

function scannerError(error: unknown): Error {
  if (error instanceof Error && error.name === 'CanonicalReviewedProductionScannerIntegrityError') {
    return error
  }
  return new DesktopReviewedProductionUnavailableError()
}

function recoveryBlocker(snapshot: DesktopWorkspaceSnapshotV1): DesktopWorkspaceRecoverySummaryV1['blocker'] {
  if (snapshot.evidence.invalidEventCount > 0) return 'invalid-evidence'
  if (snapshot.evidence.state === 'quarantined' || snapshot.evidence.quarantinedEventCount > 0) {
    return 'quarantined-evidence'
  }
  if (snapshot.evidence.state === 'blocked') return 'blocked-evidence'
  return null
}

function recoveryResult(
  summary: Omit<DesktopWorkspaceRecoverySummaryV1, 'kind' | 'version'>,
  snapshot: DesktopWorkspaceSnapshotV1,
): DesktopWorkspaceRecoveryResultV1 {
  return {
    summary: DesktopWorkspaceRecoverySummaryV1Schema.parse({
      kind: 'metrora.desktop-workspace-recovery-summary',
      version: 1,
      ...summary,
    }),
    snapshot,
  }
}

/**
 * Extend the private desktop Workspace runtime without exposing identity or
 * canonical calls. Electron receives zero-argument actions; the trusted scanner
 * receives only public endpoint/version inputs plus the Workspace creation
 * boundary derived inside the protected runtime.
 */
export function attachDesktopReviewedProductionV1(
  input: AttachDesktopReviewedProductionV1Options,
): DesktopReviewedProductionRuntimeV1 {
  const now = input.now ?? (() => new Date())
  const getProjectedSnapshot = async (): Promise<DesktopWorkspaceSnapshotV1> => {
    const snapshot = await input.runtime.getSnapshot()
    if (input.scanCanonicalCandidates) return snapshot
    return {
      ...snapshot,
      capabilities: evaluateWorkspaceCapabilitiesV1({
        inspected: true,
        workspaceConfigured: snapshot.workspace !== null,
        integrity: snapshot.evidence.integrity,
        compatibility: snapshot.evidence.compatibility,
        productionMode: snapshot.productionLifecycle?.mode ?? 'active',
        unbatchedEventCount: snapshot.evidence.unbatchedEventCount,
        pendingBatchCount: snapshot.evidence.pendingBatchCount,
        reviewedProductionAvailable: false,
      }),
    }
  }

  return {
    ...input.runtime,

    async getSnapshot() {
      return getProjectedSnapshot()
    },

    async getBootstrapSnapshot() {
      return createDesktopWorkspaceBootstrapSnapshotV1({
        dataDir: input.dataDir,
        identity: input.identity,
        now,
      })
    },

    async produceReviewedMeasurements() {
      const current = await this.getSnapshot()
      if (current.productionLifecycle?.mode === 'paused') {
        return {
          summary: {
            kind: 'metrora.canonical-reviewed-production-summary' as const,
            version: 1 as const,
            outcome: 'paused' as const,
            scanned: false,
            eligibleCount: 0,
            producedCount: 0,
            existingCount: 0,
            withheldCount: 0,
            failedCount: 0,
          },
          snapshot: current,
        }
      }
      assertWorkspaceCapabilityV1(current.capabilities, 'reviewedProduction')
      if (!input.scanCanonicalCandidates) {
        throw new DesktopReviewedProductionUnavailableError()
      }

      const summary = await produceCanonicalReviewedMeasurementsV1({
        dataDir: input.dataDir,
        identity: input.identity,
        scanCanonicalCandidates: async ({ notBefore }) => {
          try {
            return await input.scanCanonicalCandidates!({
              endpointId: input.identity.metadata.endpointId,
              adapterVersion: input.adapterVersion,
              notBefore,
            })
          } catch (error) {
            throw scannerError(error)
          }
        },
        now,
      })
      return {
        summary,
        snapshot: await this.getSnapshot(),
      }
    },

    async recoverLocalState() {
      const snapshot = await this.getSnapshot()
      assertWorkspaceCapabilityV1(snapshot.capabilities, 'recovery')
      if (!snapshot.workspace) {
        return recoveryResult({
          outcome: 'workspace-required',
          retryAttempted: false,
          blocker: null,
          receiptRepairCount: 0,
          production: null,
        }, snapshot)
      }

      if (snapshot.productionLifecycle?.mode === 'paused') {
        return recoveryResult({
          outcome: 'paused',
          retryAttempted: false,
          blocker: null,
          receiptRepairCount: 0,
          production: null,
        }, snapshot)
      }

      const blocker = recoveryBlocker(snapshot)
      if (blocker) {
        return recoveryResult({
          outcome: 'blocked',
          retryAttempted: false,
          blocker,
          receiptRepairCount: 0,
          production: null,
        }, snapshot)
      }

      if (isReadOnlyCompatibilityV1(snapshot.evidence.compatibility)) {
        return recoveryResult({
          outcome: 'verified-read-only',
          retryAttempted: false,
          blocker: null,
          receiptRepairCount: 0,
          production: null,
        }, snapshot)
      }

      // Repair already-authorized receipt publication independently of the
      // normal post-Workspace scanner scope. This can heal a receipt left by an
      // interrupted pre-fix historical pass without restarting that backfill.
      const receiptRecovery = await reconcileMeasurementProductionReceiptsV1({
        dataDir: input.dataDir,
        now,
      })

      const retried = await this.produceReviewedMeasurements()
      if (retried.summary.outcome === 'paused') {
        // A concurrent pause may win after receipt reconciliation but before the
        // bounded production retry. Preserve the repair result honestly rather
        // than claiming a passive no-mutation outcome.
        return recoveryResult({
          outcome: receiptRecovery.repairedEventCount > 0 ? 'reconciled' : 'paused',
          retryAttempted: receiptRecovery.repairedEventCount > 0,
          blocker: null,
          receiptRepairCount: receiptRecovery.repairedEventCount,
          production: receiptRecovery.repairedEventCount > 0
            ? {
                kind: 'metrora.canonical-reviewed-production-summary',
                version: 1,
                outcome: 'completed',
                scanned: false,
                eligibleCount: 0,
                producedCount: 0,
                existingCount: 0,
                withheldCount: 0,
                failedCount: 0,
              }
            : null,
        }, retried.snapshot)
      }

      const reconciled = receiptRecovery.repairedEventCount > 0 || retried.summary.existingCount > 0
      return recoveryResult({
        outcome: reconciled ? 'reconciled' : 'healthy',
        retryAttempted: true,
        blocker: null,
        receiptRepairCount: receiptRecovery.repairedEventCount,
        production: retried.summary,
      }, retried.snapshot)
    },
  }
}
