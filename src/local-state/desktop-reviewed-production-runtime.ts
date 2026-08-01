import type { LoadedLocalEndpointIdentityV1 } from './endpoint-identity.js'
import {
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
}

export type DesktopCanonicalReviewedScannerV1 = (
  input: DesktopCanonicalReviewedScannerInputV1,
) => Promise<CanonicalReviewedProductionScanV1>

export type DesktopReviewedProductionResultV1 = {
  summary: CanonicalReviewedProductionSummaryV1
  snapshot: DesktopWorkspaceSnapshotV1
}

export interface DesktopReviewedProductionRuntimeV1 extends DesktopWorkspaceRuntimeV1 {
  produceReviewedMeasurements(): Promise<DesktopReviewedProductionResultV1>
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

/**
 * Extend the private desktop Workspace runtime without exposing identity or
 * canonical calls. Electron receives one zero-argument action; the trusted
 * scanner receives only public endpoint/version inputs and its candidates stay
 * inside the main process.
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
        scanCanonicalCandidates: async () => {
          try {
            return await input.scanCanonicalCandidates!({
              endpointId: input.identity.metadata.endpointId,
              adapterVersion: input.adapterVersion,
            })
          } catch (error) {
            throw scannerError(error)
          }
        },
        now,
      })
      return {
        summary,
        snapshot: await input.runtime.getSnapshot(),
      }
    },
  }
}
