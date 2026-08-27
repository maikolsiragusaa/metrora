import {
  ACTION_CONTRACT_VERSION,
  ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
  CORE_TASK_PACK_SELECTOR,
  CORE_CHECK_COUNT,
  type ActionFailureCategoryV1,
  type ActionOperationStatus,
  type ActionResultCountsV1,
} from './action-contract-v1.js'
import type { CoreBenchActionRecordV1 } from './bench-operation-v1.js'

export const ACTION_MOBILE_PROJECTION_VERSION = 'metrora.action-mobile-projection.v1' as const

export type ActionMobileProjectionV1 = {
  contractVersion: typeof ACTION_MOBILE_PROJECTION_VERSION
  schemaVersion: 1
  actionId: string
  kind: typeof ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH
  status: ActionOperationStatus
  runtime: { id: 'ollama-local'; model: string }
  pack: { selector: typeof CORE_TASK_PACK_SELECTOR; packId: 'metrora.bench.core'; version: '1.0.0'; digest: string }
  planned: typeof CORE_CHECK_COUNT
  completed: number
  startedAt: string | null
  completedAt: string | null
  cancellationCategory: 'cancelled' | 'timeout' | null
  failureCategory: ActionFailureCategoryV1 | null
  resultCounts: ActionResultCountsV1 | null
  evidence: { kind: 'metrora.bench-history.v1'; resultDigest: string } | null
}

/**
 * Content-minimal projection for a later Android reader. This deliberately
 * projects from the action record and never carries prompts, generated text,
 * credentials, local paths, or arbitrary execution arguments.
 */
export function projectActionForMobile(record: CoreBenchActionRecordV1): ActionMobileProjectionV1 {
  const failure = record.operation.failure
  const cancellationCategory = failure?.category === 'cancelled'
    ? 'cancelled'
    : failure?.category === 'timeout' || record.operation.timeout.triggered
      ? 'timeout'
      : null
  const evidence = record.operation.result
    ? { kind: 'metrora.bench-history.v1' as const, resultDigest: record.operation.result.resultDigest }
    : null
  return {
    contractVersion: ACTION_MOBILE_PROJECTION_VERSION,
    schemaVersion: 1,
    actionId: record.id,
    kind: ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
    status: record.status,
    runtime: { id: record.contract.target.runtime.id, model: record.contract.target.model },
    pack: {
      selector: record.contract.target.pack.selector,
      packId: record.contract.target.pack.packId,
      version: record.contract.target.pack.version,
      digest: record.contract.target.pack.digest,
    },
    planned: CORE_CHECK_COUNT,
    completed: record.operation.progress.completed,
    startedAt: record.operation.startedAt,
    completedAt: record.operation.completedAt,
    cancellationCategory,
    failureCategory: failure?.category ?? null,
    resultCounts: record.operation.resultCounts,
    evidence,
  }
}
