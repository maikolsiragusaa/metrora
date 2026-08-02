import * as z from 'zod/v4'

import type { LoadedLocalEndpointIdentityV1 } from './endpoint-identity.js'
import {
  CanonicalReviewedProductionSummaryV1Schema,
  produceCanonicalReviewedMeasurementsV1,
  type CanonicalReviewedProductionScanV1,
  type CanonicalReviewedProductionSummaryV1,
} from './reviewed-production-orchestrator.js'
import type {
  DesktopWorkspaceRuntimeV1,
  DesktopWorkspaceSnapshotV1,
} from './desktop-workspace-runtime.js'

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
  outcome: z.enum(['workspace-required', 'paused', 'blocked', 'healthy', 'reconciled']),
  retryAttempted: z.boolean(),
  blocker: z.enum(['invalid-evidence', 'quarantined-evidence', 'blocked-evidence']).nullable(),
  production: CanonicalReviewedProductionSummaryV1Schema.nullable(),
}).superRefine((value, context) => {
  const passive = value.outcome === 'workspace-required' || value.outcome === 'paused'
  if (passive && (value.retryAttempted || value.blocker !== null || value.production !== null)) {
    context.addIssue({ code: 'custom', message: `${value.outcome} recovery must not retry, block, or produce` })
  }

  if (value.outcome === 'blocked') {
    if (value.retryAttempted || value.blocker === null || value.production !== null) {
      context.addIssue({ code: 'custom', message: 'blocked recovery requires one bounded blocker and no retry' })
    }
    return
  }

  if (value.outcome === 'healthy' || value.outcome === 'reconciled') {
    if (!value.retryAttempted || value.blocker !== null || value.production?.outcome !== 'completed') {
      context.addIssue({ code: 'custom', message: `${value.outcome} recovery requires one completed bounded retry` })
      return
    }
    if (value.outcome === 'healthy' && value.production.existingCount !== 0) {
      context.addIssue({ code: 'custom', message: 'healthy recovery cannot report reconciled existing production' })
    }
    if (value.outcome === 'reconciled' && value.production.existingCount === 0) {
      context.addIssue({ code: 'custom', message: 'reconciled recovery requires existing production state' })
    }
  }
})

export type DesktopWorkspaceRecoverySummaryV1 = z.infer<typeof DesktopWorkspaceRecoverySummaryV1Schema>

export type DesktopWorkspaceRecoveryResultV1 = {
  summary: DesktopWorkspaceRecoverySummaryV1
  snapshot: DesktopWorkspaceSnapshotV1
}

export interface DesktopReviewedProductionRuntimeV1 extends DesktopWorkspaceRuntimeV1 {
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

  return {
    ...input.runtime,

    async produceReviewedMeasurements() {
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
      if (!snapshot.workspace) {
        return recoveryResult({
          outcome: 'workspace-required',
          retryAttempted: false,
          blocker: null,
          production: null,
        }, snapshot)
      }

      if (snapshot.productionLifecycle?.mode === 'paused') {
        return recoveryResult({
          outcome: 'paused',
          retryAttempted: false,
          blocker: null,
          production: null,
        }, snapshot)
      }

      const blocker = recoveryBlocker(snapshot)
      if (blocker) {
        return recoveryResult({
          outcome: 'blocked',
          retryAttempted: false,
          blocker,
          production: null,
        }, snapshot)
      }

      const retried = await this.produceReviewedMeasurements()
      if (retried.summary.outcome === 'paused') {
        return recoveryResult({
          outcome: 'paused',
          retryAttempted: false,
          blocker: null,
          production: null,
        }, retried.snapshot)
      }

      return recoveryResult({
        outcome: retried.summary.existingCount > 0 ? 'reconciled' : 'healthy',
        retryAttempted: true,
        blocker: null,
        production: retried.summary,
      }, retried.snapshot)
    },
  }
}
