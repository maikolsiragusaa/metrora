import { z } from 'zod'
import {
  ACTION_FAILURE_CATEGORIES,
  ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
  ACTION_NO_ROLLBACK_REASON,
  ACTION_OPERATION_STATUSES,
  ACTION_OPERATION_VERSION,
  CORE_CHECK_COUNT,
  type ActionContractV1,
  type ActionFailureCategoryV1,
  type ActionOperationStateV1,
  type ActionOperationStatus,
  type ActionResultCountsV1,
  type ActionResultReferenceV1,
  type ApprovedActionV1,
  TrustedActionAuthorityV1,
  computeActionProposalDigest,
  validateActionContractV1,
} from './action-contract-v1.js'
import { appendRecord, defaultActionsDir, readRecordsStrict, withLock } from './journal.js'
import type { ActionRecord } from './types.js'
import {
  BENCH_EVALUATION_SCHEMA_VERSION,
  runBenchTaskPackV1,
  type BenchEvaluationV1,
  type BenchTaskPackRunOptions,
} from '../bench/task-pack-run-v1.js'
import { parseBenchEvaluationV1, saveBenchEvaluationV1, scanBenchHistoryV1 } from '../bench/history-v1.js'
import type { BenchFetch } from '../bench/ollama-local.js'
export const ACTION_RECORD_VERSION = 'metrora.action-record.v1' as const
export type BenchActionExecutionOptions = {
  authority: TrustedActionAuthorityV1
  actionsDir?: string
  dataDir?: string
  fetchImpl?: BenchFetch
  signal?: AbortSignal
  now?: () => Date
  monotonicNow?: () => number
  runBench?: (options: BenchTaskPackRunOptions) => Promise<BenchEvaluationV1>
}
export type BenchActionProposalOptions = {
  actionsDir?: string
  now?: () => Date
}
export type BenchActionCancellationOptions = {
  actionsDir?: string
  dataDir?: string
  now?: () => Date
}
export type CoreBenchActionRecordV1 = Omit<ActionRecord, 'recordVersion' | 'id' | 'at' | 'kind' | 'findingId' | 'description' | 'changes' | 'status' | 'contract' | 'operation'> & {
  recordVersion: typeof ACTION_RECORD_VERSION
  id: string
  at: string
  kind: typeof ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH
  findingId: null
  description: string
  changes: []
  status: ActionOperationStatus
  contract: ActionContractV1
  operation: ActionOperationStateV1
}
export type BenchActionCancellationResult =
  | { status: 'requested' }
  | { status: 'cancelled'; record: CoreBenchActionRecordV1 }
  | { status: 'already-terminal'; record: CoreBenchActionRecordV1 }
  | { status: 'owner-unavailable'; record: CoreBenchActionRecordV1 }
  | { status: 'not-found' }
export type ActionOperationErrorCode = ActionFailureCategoryV1 | 'not-found' | 'owner-unavailable'
export class ActionOperationError extends Error {
  constructor(
    public readonly code: ActionOperationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ActionOperationError'
  }
}
const ActionId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)
const Digest = z.string().regex(/^[0-9a-f]{64}$/)
const IsoDate = z.string().datetime({ offset: true })
const ResultReference = z.object({
  kind: z.literal(BENCH_EVALUATION_SCHEMA_VERSION),
  runId: ActionId,
  resultDigest: Digest,
  history: z.enum(['saved', 'duplicate']),
}).strict()
const ResultCounts = z.object({
  planned: z.number().int().min(0).max(CORE_CHECK_COUNT),
  attempted: z.number().int().min(0).max(CORE_CHECK_COUNT),
  passed: z.number().int().min(0).max(CORE_CHECK_COUNT),
  failed: z.number().int().min(0).max(CORE_CHECK_COUNT),
  unavailable: z.number().int().min(0).max(CORE_CHECK_COUNT),
  cancelled: z.number().int().min(0).max(CORE_CHECK_COUNT),
}).strict()
const OperationFailure = z.object({
  category: z.enum(ACTION_FAILURE_CATEGORIES),
  message: z.string().min(1).max(240),
}).strict()
const OperationStateShape = z.object({
  operationVersion: z.literal(ACTION_OPERATION_VERSION),
  actionId: ActionId,
  ownerProcessId: z.number().int().nonnegative().nullable(),
  startedAt: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
  progress: z.object({ planned: z.literal(CORE_CHECK_COUNT), completed: z.number().int().min(0).max(CORE_CHECK_COUNT) }).strict(),
  checksPlanned: z.literal(CORE_CHECK_COUNT),
  checksCompleted: z.number().int().min(0).max(CORE_CHECK_COUNT),
  cancellation: z.object({ requested: z.boolean(), requestedAt: IsoDate.nullable() }).strict(),
  timeout: z.object({ perRequestMs: z.number().int().min(50).max(120_000), operationMs: z.number().int().min(50).max(1_000_000), triggered: z.boolean() }).strict(),
  result: ResultReference.nullable(),
  resultCounts: ResultCounts.nullable(),
  evidenceReferences: z.array(ResultReference).max(1),
  failure: OperationFailure.nullable(),
  rollback: z.object({ capability: z.literal('none'), reason: z.literal(ACTION_NO_ROLLBACK_REASON) }).strict(),
}).strict()
const CoreRecordShape = z.object({
  recordVersion: z.literal(ACTION_RECORD_VERSION),
  id: ActionId,
  at: IsoDate,
  kind: z.literal(ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH),
  findingId: z.null(),
  description: z.string().min(1).max(240),
  changes: z.tuple([]),
  status: z.enum(ACTION_OPERATION_STATUSES),
  contract: z.unknown(),
  operation: OperationStateShape,
}).strict()
function boundedMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  return (raw.replace(/[\r\n]+/g, ' ').slice(0, 240) || fallback)
}
function nowIso(now: () => Date): string {
  return now().toISOString()
}
function proposalContract(contract: ActionContractV1): ActionContractV1 {
  return validateActionContractV1({
    ...contract,
    approval: { ...contract.approval, confirmationDigest: null },
  })
}
function assertFreshActionContract(contract: ActionContractV1, allowConfirmation: boolean): void {
  if (!allowConfirmation && contract.approval.confirmationDigest !== null) {
    throw new ActionOperationError('validation', 'a proposal must not contain a confirmation digest')
  }
  if (allowConfirmation && contract.approval.confirmationDigest === null) {
    throw new ActionOperationError('approval-invalid', 'execution requires a trusted confirmation digest')
  }
  if (contract.resultIdentity.runId !== null || contract.resultIdentity.resultDigest !== null || contract.evidenceReferences.runId !== null || contract.evidenceReferences.resultDigest !== null || contract.failureCategory !== null) {
    throw new ActionOperationError('validation', 'execution contracts must not carry a prior result or failure')
  }
}
function initialOperationState(contract: ActionContractV1): ActionOperationStateV1 {
  return {
    operationVersion: ACTION_OPERATION_VERSION,
    actionId: contract.actionId,
    ownerProcessId: null,
    startedAt: null,
    completedAt: null,
    progress: { planned: CORE_CHECK_COUNT, completed: 0 },
    checksPlanned: CORE_CHECK_COUNT,
    checksCompleted: 0,
    cancellation: { requested: false, requestedAt: null },
    timeout: {
      perRequestMs: contract.timeout.perRequestMs,
      operationMs: contract.timeout.operationMs,
      triggered: false,
    },
    result: null,
    resultCounts: null,
    evidenceReferences: [],
    failure: null,
    rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
  }
}
function makeRecord(
  contract: ActionContractV1,
  status: ActionOperationStatus,
  operation: ActionOperationStateV1,
  now: () => Date,
): CoreBenchActionRecordV1 {
  return {
    recordVersion: ACTION_RECORD_VERSION,
    id: contract.actionId,
    at: nowIso(now),
    kind: ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
    findingId: null,
    description: `Run Core conformance on ${contract.target.model}`,
    changes: [],
    status,
    contract,
    operation,
  }
}
function parseCoreRecord(input: unknown): CoreBenchActionRecordV1 {
  const parsed = CoreRecordShape.safeParse(input)
  if (!parsed.success) throw new ActionOperationError('journal', 'the action journal contains an invalid Core Bench record')
  let contract: ActionContractV1
  try {
    contract = validateActionContractV1(parsed.data.contract)
  } catch {
    throw new ActionOperationError('journal', 'the action journal contains an invalid action contract')
  }
  if (parsed.data.id !== contract.actionId || parsed.data.operation.actionId !== parsed.data.id) {
    throw new ActionOperationError('identity-mismatch', 'the action journal record identity does not match its contract')
  }
  if (contract.resultIdentity.runId !== null || contract.resultIdentity.resultDigest !== null || contract.evidenceReferences.runId !== null || contract.evidenceReferences.resultDigest !== null || contract.failureCategory !== null) {
    throw new ActionOperationError('journal', 'the action journal contract contains mutable outcome data')
  }
  const operation = parsed.data.operation as ActionOperationStateV1
  if (operation.checksCompleted !== operation.progress.completed || operation.progress.completed > operation.progress.planned) {
    throw new ActionOperationError('journal', 'the action journal progress is inconsistent')
  }
  if (operation.result === null) {
    if (operation.resultCounts !== null || operation.evidenceReferences.length !== 0) throw new ActionOperationError('journal', 'the action journal result references are inconsistent')
  } else {
    if (operation.result.runId !== parsed.data.id || operation.evidenceReferences.length !== 1 || operation.evidenceReferences[0]?.resultDigest !== operation.result.resultDigest || operation.resultCounts === null) {
      throw new ActionOperationError('identity-mismatch', 'the action journal result identity is inconsistent')
    }
  }
  if ((parsed.data.status === 'completed' || parsed.data.status === 'unavailable') && operation.result === null) {
    throw new ActionOperationError('journal', 'a completed or unavailable action must reference Bench evidence')
  }
  if ((parsed.data.status === 'proposed' || parsed.data.status === 'ready' || parsed.data.status === 'running') && operation.completedAt !== null) {
    throw new ActionOperationError('journal', 'a non-terminal action cannot have a completion timestamp')
  }
  return { ...parsed.data, contract, operation }
}
async function latestRecord(actionsDir: string, actionId: string): Promise<CoreBenchActionRecordV1 | null> {
  let records: ActionRecord[]
  try {
    records = await readRecordsStrict(actionsDir)
  } catch {
    throw new ActionOperationError('journal', 'the action journal contains corrupt or malformed JSON')
  }
  const raw = records.find(record => record.id === actionId)
  if (!raw) return null
  if (raw.kind !== ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH) {
    throw new ActionOperationError('duplicate', 'the action id is already used by another ACT record')
  }
  return parseCoreRecord(raw)
}
function processIsAlive(processId: number | null): boolean {
  if (processId === null || processId <= 0) return false
  try { process.kill(processId, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}
async function appendOperationRecord(
  actionsDir: string,
  contract: ActionContractV1,
  status: ActionOperationStatus,
  operation: ActionOperationStateV1,
  now: () => Date,
): Promise<CoreBenchActionRecordV1> {
  const record = makeRecord(contract, status, operation, now)
  await appendRecord(actionsDir, record)
  return record
}
export async function recordCoreConformanceProposal(
  contractInput: ActionContractV1,
  options: BenchActionProposalOptions = {},
): Promise<CoreBenchActionRecordV1> {
  const contract = validateActionContractV1(contractInput)
  assertFreshActionContract(contract, false)
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const now = options.now ?? (() => new Date())
  return withLock(actionsDir, async () => {
    if (await latestRecord(actionsDir, contract.actionId)) throw new ActionOperationError('duplicate', 'the action id has already been proposed or executed')
    return appendOperationRecord(actionsDir, proposalContract(contract), 'proposed', initialOperationState(contract), now)
  })
}
type ActiveExecution = {
  actionId: string
  controller: AbortController
  cancelled: boolean
  cancellationRequestedAt: string | null
  accepted: boolean
}
const activeExecutions = new Map<string, ActiveExecution>()
function resultCounts(result: BenchEvaluationV1): ActionResultCountsV1 {
  return {
    planned: result.aggregate.planned,
    attempted: result.aggregate.attempted,
    passed: result.aggregate.passed,
    failed: result.aggregate.failed,
    unavailable: result.aggregate.unavailable,
    cancelled: result.aggregate.cancelled,
  }
}
function failureFromBench(result: BenchEvaluationV1, fallback: string): string {
  const failure = result.tasks.find(task => task.failure !== null)?.failure
  return boundedMessage(failure?.message, fallback)
}
function resultReference(
  result: BenchEvaluationV1,
  history: 'saved' | 'duplicate',
): ActionResultReferenceV1 {
  return {
    kind: BENCH_EVALUATION_SCHEMA_VERSION,
    runId: result.runId,
    resultDigest: result.resultDigest,
    history,
  }
}
export async function executeApprovedCoreConformanceBench(
  approvedInput: ApprovedActionV1,
  options: BenchActionExecutionOptions,
): Promise<CoreBenchActionRecordV1> {
  const approved = options.authority.verifyApprovedAction(approvedInput)
  const contract = approved.contract
  assertFreshActionContract(contract, true)
  const actionId = contract.actionId
  if (activeExecutions.has(actionId)) throw new ActionOperationError('concurrent', 'the Core Bench action is already running')
  const active: ActiveExecution = {
    actionId,
    controller: new AbortController(),
    cancelled: false,
    cancellationRequestedAt: null,
    accepted: false,
  }
  activeExecutions.set(actionId, active)
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const now = options.now ?? (() => new Date())
  const runBench = options.runBench ?? runBenchTaskPackV1
  let removeExternalAbort: (() => void) | undefined
  const requestExternalAbort = (): void => {
    if (active.accepted || active.cancelled) return
    active.cancelled = true
    active.cancellationRequestedAt = nowIso(now)
    active.controller.abort(options.signal?.reason)
  }
  if (options.signal) {
    if (options.signal.aborted) requestExternalAbort()
    else {
      options.signal.addEventListener('abort', requestExternalAbort, { once: true })
      removeExternalAbort = () => options.signal?.removeEventListener('abort', requestExternalAbort)
    }
  }

  try {
    return await withLock(actionsDir, async () => {
      let current = await latestRecord(actionsDir, actionId)
      if (current && computeActionProposalDigest(current.contract) !== computeActionProposalDigest(contract)) {
        throw new ActionOperationError('identity-mismatch', 'the approved action no longer matches the recorded proposal')
      }
      if (current) {
        if (current.status === 'running') {
          if (current.operation.ownerProcessId !== null && !processIsAlive(current.operation.ownerProcessId)) {
            return appendOperationRecord(actionsDir, contract, 'failed', {
              ...current.operation,
              ownerProcessId: null,
              completedAt: nowIso(now),
              failure: { category: 'execution', message: 'The previous Core Bench owner exited before completing; a new action is required.' },
            }, now)
          }
          throw new ActionOperationError('concurrent', 'the Core Bench action is already running')
        }
        if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled' || current.status === 'unavailable') {
          throw new ActionOperationError('replay', 'the action has already reached a terminal state; replay is rejected')
        }
        if (current.status === 'proposed') {
          current = await appendOperationRecord(actionsDir, contract, 'ready', current.operation, now)
        }
      } else {
        await appendOperationRecord(actionsDir, proposalContract(contract), 'proposed', initialOperationState(contract), now)
        current = await appendOperationRecord(actionsDir, contract, 'ready', initialOperationState(contract), now)
      }

      let operation: ActionOperationStateV1 = {
        ...current.operation,
        ownerProcessId: process.pid,
        startedAt: current.operation.startedAt ?? nowIso(now),
        completedAt: null,
        progress: { planned: CORE_CHECK_COUNT, completed: current.operation.progress.completed },
        checksPlanned: CORE_CHECK_COUNT,
        checksCompleted: current.operation.checksCompleted,
        cancellation: {
          requested: active.cancelled,
          requestedAt: active.cancelled ? active.cancellationRequestedAt ?? nowIso(now) : current.operation.cancellation.requestedAt,
        },
        timeout: { ...current.operation.timeout, triggered: false },
        result: null,
        resultCounts: null,
        evidenceReferences: [],
        failure: null,
        rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
      }
      await appendOperationRecord(actionsDir, contract, 'running', operation, now)

      let finalized = false
      const finalize = async (status: ActionOperationStatus, updates: Partial<ActionOperationStateV1>): Promise<CoreBenchActionRecordV1> => {
        finalized = true
        operation = {
          ...operation,
          ...updates,
          completedAt: nowIso(now),
          progress: { planned: CORE_CHECK_COUNT, completed: Math.min(CORE_CHECK_COUNT, operation.progress.completed) },
          checksPlanned: CORE_CHECK_COUNT,
          checksCompleted: Math.min(CORE_CHECK_COUNT, operation.checksCompleted),
        }
        return appendOperationRecord(actionsDir, contract, status, operation, now)
      }

      const onProgress = async (progress: { planned: number; completed: number; currentTaskId: string }): Promise<void> => {
        if (finalized || active.controller.signal.aborted) return
        const completed = Math.max(0, Math.min(CORE_CHECK_COUNT, Math.trunc(progress.completed)))
        operation = {
          ...operation,
          progress: { planned: CORE_CHECK_COUNT, completed },
          checksCompleted: completed,
        }
        await appendOperationRecord(actionsDir, contract, 'running', operation, now)
      }

      let timeoutTriggered = false
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      let removeAbortListener: (() => void) | undefined
      const abortPromise = new Promise<{ kind: 'abort'; reason: 'cancelled' | 'timeout' }>(resolve => {
        const onAbort = (): void => resolve({ kind: 'abort', reason: active.cancelled ? 'cancelled' : 'timeout' })
        active.controller.signal.addEventListener('abort', onAbort, { once: true })
        removeAbortListener = () => active.controller.signal.removeEventListener('abort', onAbort)
        if (active.controller.signal.aborted) onAbort()
      })
      timeoutHandle = setTimeout(() => {
        if (finalized || active.accepted || active.controller.signal.aborted) return
        timeoutTriggered = true
        active.controller.abort(new Error('Core Bench operation timeout'))
      }, contract.timeout.operationMs)

      const runPromise = Promise.resolve().then(() => runBench({
        model: contract.arguments.model,
        packId: contract.target.pack.selector,
        runId: actionId,
        fetchImpl: options.fetchImpl,
        signal: active.controller.signal,
        timeoutMs: contract.timeout.perRequestMs,
        now,
        monotonicNow: options.monotonicNow,
        onProgress,
      })).then(
        result => ({ kind: 'result' as const, result }),
        error => ({ kind: 'error' as const, error }),
      )
      const outcome = await Promise.race([runPromise, abortPromise])
      if (timeoutHandle) clearTimeout(timeoutHandle)
      removeAbortListener?.()

      if (outcome.kind === 'abort') {
        const cancelled = active.cancelled || outcome.reason === 'cancelled'
        operation = {
          ...operation,
          cancellation: {
            requested: cancelled,
            requestedAt: cancelled ? active.cancellationRequestedAt ?? nowIso(now) : operation.cancellation.requestedAt,
          },
          timeout: { ...operation.timeout, triggered: !cancelled && (timeoutTriggered || outcome.reason === 'timeout') },
          failure: {
            category: cancelled ? 'cancelled' : 'timeout',
            message: cancelled ? 'Core conformance cancellation requested; late results were discarded.' : 'Core conformance operation exceeded its bounded timeout.',
          },
        }
        return finalize(cancelled ? 'cancelled' : 'failed', operation)
      }

      if (active.cancelled || timeoutTriggered || active.controller.signal.aborted) {
        const cancelled = active.cancelled
        operation = {
          ...operation,
          cancellation: { requested: cancelled, requestedAt: cancelled ? active.cancellationRequestedAt ?? nowIso(now) : operation.cancellation.requestedAt },
          timeout: { ...operation.timeout, triggered: !cancelled && timeoutTriggered },
          failure: {
            category: cancelled ? 'cancelled' : 'timeout',
            message: cancelled ? 'Core conformance cancellation requested; late results were discarded.' : 'Core conformance operation exceeded its bounded timeout.',
          },
        }
        return finalize(cancelled ? 'cancelled' : 'failed', operation)
      }

      if (outcome.kind === 'error') {
        operation = {
          ...operation,
          failure: { category: 'execution', message: boundedMessage(outcome.error, 'Core conformance execution failed.') },
        }
        return finalize('failed', operation)
      }

      active.accepted = true
      let result: BenchEvaluationV1
      try {
        result = parseBenchEvaluationV1(outcome.result)
      } catch (error) {
        operation = { ...operation, failure: { category: 'malformed-result', message: boundedMessage(error, 'Bench returned a malformed result.') } }
        return finalize('failed', operation)
      }
      if (result.runId !== actionId || result.model.selected !== contract.target.model || result.pack.packId !== contract.target.pack.packId || result.pack.version !== contract.target.pack.version || result.pack.digest !== contract.target.pack.digest || result.runtime.id !== contract.target.runtime.id || result.runtime.endpoint !== contract.target.runtime.endpoint) {
        operation = { ...operation, failure: { category: 'identity-mismatch', message: 'Bench result identity did not match the approved action.' } }
        return finalize('failed', operation)
      }

      let saved: Awaited<ReturnType<typeof saveBenchEvaluationV1>>
      try {
        saved = await saveBenchEvaluationV1(result, { dataDir: options.dataDir })
      } catch (error) {
        operation = { ...operation, failure: { category: 'journal', message: boundedMessage(error, 'Bench result could not be saved to history.') } }
        return finalize('failed', operation)
      }

      const reference = resultReference(saved.record, saved.status)
      const counts = resultCounts(saved.record)
      operation = {
        ...operation,
        progress: { planned: CORE_CHECK_COUNT, completed: counts.attempted },
        checksCompleted: counts.attempted,
        result: reference,
        resultCounts: counts,
        evidenceReferences: [reference],
        timeout: { ...operation.timeout, triggered: timeoutTriggered || saved.record.tasks.some(task => task.status === 'timeout') },
        failure: null,
      }

      const hasTimeout = saved.record.tasks.some(task => task.status === 'timeout')
      if (saved.record.status === 'cancelled') {
        operation = { ...operation, failure: { category: 'cancelled', message: 'Core conformance was cancelled; no late result was accepted.' } }
        return finalize('cancelled', operation)
      }
      if (hasTimeout) {
        operation = { ...operation, failure: { category: 'timeout', message: failureFromBench(saved.record, 'A bounded Core conformance request timed out.') } }
        return finalize('failed', operation)
      }
      if (saved.record.status === 'unavailable') {
        operation = { ...operation, failure: { category: 'unavailable', message: failureFromBench(saved.record, 'Ollama local runtime was unavailable.') } }
        return finalize('unavailable', operation)
      }
      return finalize('completed', operation)
    })
  } finally {
    removeExternalAbort?.()
    if (activeExecutions.get(actionId) === active) activeExecutions.delete(actionId)
  }
}

export async function cancelCoreConformanceBenchAction(
  actionId: string,
  options: BenchActionCancellationOptions = {},
): Promise<BenchActionCancellationResult> {
  const active = activeExecutions.get(actionId)
  if (active) {
    if (active.accepted) {
      const record = await readCoreConformanceAction(actionId, { actionsDir: options.actionsDir, dataDir: options.dataDir })
      if (!record) return { status: 'not-found' }
      return record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled' || record.status === 'unavailable'
        ? { status: 'already-terminal', record }
        : { status: 'owner-unavailable', record }
    }
    active.cancelled = true
    active.cancellationRequestedAt = (options.now ?? (() => new Date()))().toISOString()
    active.controller.abort(new Error('Core Bench cancellation requested'))
    return { status: 'requested' }
  }

  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const now = options.now ?? (() => new Date())
  return withLock(actionsDir, async () => {
    const record = await latestRecord(actionsDir, actionId)
    if (!record) return { status: 'not-found' }
    if (record.status === 'proposed' || record.status === 'ready') {
      const operation: ActionOperationStateV1 = {
        ...record.operation,
        completedAt: nowIso(now),
        cancellation: { requested: true, requestedAt: nowIso(now) },
        failure: { category: 'cancelled', message: 'Core conformance was cancelled before execution started.' },
      }
      return { status: 'cancelled', record: await appendOperationRecord(actionsDir, record.contract, 'cancelled', operation, now) }
    }
    if (record.status === 'running') return { status: 'owner-unavailable', record }
    return { status: 'already-terminal', record }
  })
}
export async function readCoreConformanceAction(
  actionId: string,
  options: { actionsDir?: string; dataDir?: string } = {},
): Promise<CoreBenchActionRecordV1 | null> {
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const record = await latestRecord(actionsDir, actionId)
  if (!record?.operation.result) return record
  const scan = await scanBenchHistoryV1({ dataDir: options.dataDir })
  const reference = scan.records.find(item =>
    item.runId === record.operation.result?.runId
    && item.resultDigest === record.operation.result.resultDigest
    && item.model.selected === record.contract.target.model
    && item.pack.packId === record.contract.target.pack.packId
    && item.pack.version === record.contract.target.pack.version
    && item.pack.digest === record.contract.target.pack.digest
    && item.runtime.id === record.contract.target.runtime.id
    && item.runtime.endpoint === record.contract.target.runtime.endpoint,
  )
  if (!reference) throw new ActionOperationError('identity-mismatch', 'the action journal references missing or mismatched Bench evidence')
  const counts = record.operation.resultCounts
  if (!counts || counts.planned !== reference.aggregate.planned || counts.attempted !== reference.aggregate.attempted || counts.passed !== reference.aggregate.passed || counts.failed !== reference.aggregate.failed || counts.unavailable !== reference.aggregate.unavailable || counts.cancelled !== reference.aggregate.cancelled) throw new ActionOperationError('identity-mismatch', 'the action journal result counts do not match Bench evidence')
  return record
}
