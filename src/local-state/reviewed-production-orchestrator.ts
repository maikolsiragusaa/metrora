import * as z from 'zod/v4'

import type { ParsedApiCall } from '../types.js'
import {
  defaultMetroraDataDir,
  LocalEndpointIdentityMetadataV1Schema,
  type LoadedLocalEndpointIdentityV1,
} from './endpoint-identity.js'
import {
  produceLocalReviewedMeasurementV1,
  type LocalReviewedMeasurementContextV1,
} from './reviewed-measurement-producer.js'
import {
  inspectLocalWorkspaceProductionLifecycleV1,
  withLocalWorkspaceProductionControlLeaseV1,
} from './workspace-production-lifecycle.js'

export const CanonicalReviewedProductionSummaryV1Schema = z.strictObject({
  kind: z.literal('metrora.canonical-reviewed-production-summary'),
  version: z.literal(1),
  outcome: z.enum(['paused', 'completed']),
  scanned: z.boolean(),
  eligibleCount: z.number().int().nonnegative(),
  producedCount: z.number().int().nonnegative(),
  existingCount: z.number().int().nonnegative(),
  withheldCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
})

const CanonicalReviewedProductionScanCountsV1Schema = z.strictObject({
  withheldCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
})

export type CanonicalReviewedProductionCandidateV1 = {
  call: ParsedApiCall
  context: LocalReviewedMeasurementContextV1
}

export type CanonicalReviewedProductionScanV1 = {
  candidates: readonly CanonicalReviewedProductionCandidateV1[]
  withheldCount: number
  failedCount: number
}

export type CanonicalReviewedProductionSummaryV1 = z.infer<typeof CanonicalReviewedProductionSummaryV1Schema>

export type ProduceCanonicalReviewedMeasurementsV1Options = {
  dataDir?: string
  identity: LoadedLocalEndpointIdentityV1
  scanCanonicalCandidates(): Promise<CanonicalReviewedProductionScanV1>
  now?: () => Date
}

function pausedSummary(): CanonicalReviewedProductionSummaryV1 {
  return CanonicalReviewedProductionSummaryV1Schema.parse({
    kind: 'metrora.canonical-reviewed-production-summary',
    version: 1,
    outcome: 'paused',
    scanned: false,
    eligibleCount: 0,
    producedCount: 0,
    existingCount: 0,
    withheldCount: 0,
    failedCount: 0,
  })
}

/**
 * Runs one explicit reviewed-production pass from candidates supplied by the
 * trusted canonical parser/cache authority. The renderer never supplies calls,
 * contexts, fingerprints, providers, costs, paths, or deduplication material.
 */
export async function produceCanonicalReviewedMeasurementsV1(
  input: ProduceCanonicalReviewedMeasurementsV1Options,
): Promise<CanonicalReviewedProductionSummaryV1> {
  const endpointIdentity = LocalEndpointIdentityMetadataV1Schema.parse(input.identity.metadata)
  const dataDir = input.dataDir ?? defaultMetroraDataDir()
  const now = input.now ?? (() => new Date())

  return withLocalWorkspaceProductionControlLeaseV1({ dataDir }, async () => {
    const lifecycle = await inspectLocalWorkspaceProductionLifecycleV1({
      dataDir,
      endpointIdentity,
      now,
    })
    if (lifecycle.mode === 'paused') return pausedSummary()

    const scan = await input.scanCanonicalCandidates()
    const scanCounts = CanonicalReviewedProductionScanCountsV1Schema.parse({
      withheldCount: scan.withheldCount,
      failedCount: scan.failedCount,
    })

    let producedCount = 0
    let existingCount = 0
    for (const candidate of scan.candidates) {
      const result = await produceLocalReviewedMeasurementV1({
        dataDir,
        identity: input.identity,
        call: candidate.call,
        context: candidate.context,
        now,
      })
      if (result.status === 'enqueued') {
        producedCount += 1
      } else if (result.status === 'duplicate') {
        existingCount += 1
      } else {
        throw new Error(`trusted canonical production candidate was withheld: ${result.reason}`)
      }
    }

    return CanonicalReviewedProductionSummaryV1Schema.parse({
      kind: 'metrora.canonical-reviewed-production-summary',
      version: 1,
      outcome: 'completed',
      scanned: true,
      eligibleCount: scan.candidates.length,
      producedCount,
      existingCount,
      withheldCount: scanCounts.withheldCount,
      failedCount: scanCounts.failedCount,
    })
  })
}
