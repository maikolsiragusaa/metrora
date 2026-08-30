import type {
  ActionContractV1,
  ActionOperationFailureV1,
  ActionOperationStateV1,
  ActionOperationStatus,
  ActionResultCountsV1,
  ActionResultReferenceV1,
  ActionEvidenceReferenceV1,
} from './action-contract-v1.js'

export type CoreCompatibilityActionRecordV1 = {
  recordVersion: 'metrora.action-record.v1'
  id: string
  at: string
  kind: 'run-core-compatibility'
  originatingSurface: 'cli' | 'desktop'
  findingId: null
  description: string
  changes: readonly []
  status: ActionOperationStatus
  contract: ActionContractV1
  operation: ActionOperationStateV1
}

export type JournalRecordV1 = import('./types.js').ActionRecord | CoreCompatibilityActionRecordV1

export type CoreCompatibilityReadResultV1 = {
  record: CoreCompatibilityActionRecordV1
  history: readonly CoreCompatibilityActionRecordV1[]
}

export type CoreCompatibilityOperationOptions = {
  actionsDir?: string
  dataDir?: string
  now?: () => Date
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  runBench?: (options: {
    model: string
    packId: string
    runId: string
    timeoutMs: number
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    now?: () => Date
    onProgress?: (progress: { planned: number; completed: number }) => void | Promise<void>
  }) => Promise<unknown>
}

export type CoreCompatibilityOperationResultV1 = {
  status: ActionOperationStatus
  action: CoreCompatibilityActionRecordV1
  result: unknown | null
}

export type CoreCompatibilityOutcomeV1 = {
  status: Extract<ActionOperationStatus, 'completed' | 'unavailable'>
  result: ActionResultReferenceV1
  evidence: ActionEvidenceReferenceV1
  counts: ActionResultCountsV1
}

export type CoreCompatibilityJournalStateV1 = {
  status: ActionOperationStatus
  contract: ActionContractV1
  operation: ActionOperationStateV1
}

export function isCoreCompatibilityActionRecord(value: unknown): value is CoreCompatibilityActionRecordV1 {
  return Boolean(value && typeof value === 'object' && (value as { recordVersion?: unknown }).recordVersion === 'metrora.action-record.v1' && (value as { kind?: unknown }).kind === 'run-core-compatibility')
}

export function isTerminalActionStatus(status: ActionOperationStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'unavailable'
}

export function isActiveActionStatus(status: ActionOperationStatus): boolean {
  return status === 'proposed' || status === 'ready' || status === 'running'
}
