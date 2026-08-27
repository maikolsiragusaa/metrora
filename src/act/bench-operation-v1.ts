import {
  ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
  ACTION_NO_ROLLBACK_REASON,
  CORE_CHECK_COUNT,
  type ActionContractV1,
  type ActionFailureCategoryV1,
  type ActionOperationStateV1,
  type ActionOperationStatus,
  type ApprovedActionV1,
  TrustedActionAuthorityV1,
  computeActionProposalDigest,
  validateActionContractV1,
} from './action-contract-v1.js'
import { defaultActionsDir, withLock } from './journal.js'
import {
  ACTION_RECORD_VERSION,
  ActionOperationError,
  appendOperationRecord,
  assertFreshActionContract,
  boundedMessage,
  evidenceReference,
  failureFromBench,
  initialOperationState,
  latestRecord,
  nowIso,
  processIsAlive,
  proposalContract,
  readCoreRecords,
  resultCounts,
  resultReference,
  type BenchActionCancellationResult,
  type BenchActionProposalOptions,
  type CoreBenchActionRecordV1,
} from './bench-operation-state-v1.js'
import { CORE_TASK_PACK_V1 } from '../bench/task-pack-v1.js'
import {
  BENCH_EVALUATION_SCHEMA_VERSION,
  runBenchTaskPackV1,
  type BenchEvaluationV1,
  type BenchTaskPackProgressV1,
  type BenchTaskPackRunOptions,
} from '../bench/task-pack-run-v1.js'
import { parseBenchEvaluationV1, saveBenchEvaluationV1, scanBenchHistoryV1 } from '../bench/history-v1.js'
import type { BenchFetch } from '../bench/ollama-local.js'
export { ACTION_RECORD_VERSION, ActionOperationError }
export type { BenchActionCancellationResult, BenchActionProposalOptions, CoreBenchActionRecordV1 }
export type BenchActionExecutionOptions = {
  authority: TrustedActionAuthorityV1
  actionsDir?: string
  dataDir?: string
  fetchImpl?: BenchFetch
  signal?: AbortSignal
  now?: () => Date
  monotonicNow?: () => number
  /** Internal test seam; the public bridge never exposes an alternate executor. */
  runBench?: (options: BenchTaskPackRunOptions) => Promise<BenchEvaluationV1>
}
export type BenchActionCancellationOptions = {
  actionsDir?: string
  dataDir?: string
  now?: () => Date
}
const TERMINAL_STATUSES: readonly ActionOperationStatus[] = ['completed', 'failed', 'cancelled', 'unavailable']
const LOCK_RETRIES = 120
const LOCK_RETRY_MS = 25
const CANCELLATION_POLL_MS = 100
type FailedCategory = Exclude<ActionFailureCategoryV1, 'cancelled' | 'unavailable'>
function isTerminal(status: ActionOperationStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
function isLockBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes('another metrora action is in progress') || error.message.includes('could not acquire the metrora action lock')
}
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
/** Short ACT critical sections may race with legacy file actions. */
async function withActionLock<T>(actionsDir: string, operation: () => Promise<T>): Promise<T> {
  let lastBusy: unknown
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      return await withLock(actionsDir, operation)
    } catch (error) {
      if (!isLockBusy(error)) throw error
      lastBusy = error
      await sleep(LOCK_RETRY_MS)
    }
  }
  throw new ActionOperationError('concurrent', boundedMessage(lastBusy, 'the ACT journal lock remained busy'))
}
function sameActionContract(left: ActionContractV1, right: ActionContractV1): boolean {
  return computeActionProposalDigest(left) === computeActionProposalDigest(right)
}
function clearOutcome(operation: ActionOperationStateV1): ActionOperationStateV1 {
  return { ...operation, result: null, resultCounts: null, evidenceReferences: [], failure: null }
}
function failedCategory(error: unknown, fallback: FailedCategory): FailedCategory {
  const code = error instanceof ActionOperationError ? error.code : null
  return code && code !== 'not-found' && code !== 'owner-unavailable' && code !== 'cancelled' && code !== 'unavailable' ? code : fallback
}
function cancellationOperation(
  operation: ActionOperationStateV1,
  requestedAt: string,
  now: () => Date,
  message: string,
): ActionOperationStateV1 {
  return {
    ...clearOutcome(operation),
    ownerProcessId: null,
    completedAt: nowIso(now),
    cancellation: { requested: true, requestedAt: operation.cancellation.requestedAt ?? requestedAt },
    failure: { category: 'cancelled', message: boundedMessage(message, 'Core conformance was cancelled.') },
    rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
  }
}

function failureOperation(
  operation: ActionOperationStateV1,
  category: FailedCategory,
  message: string,
  now: () => Date,
): ActionOperationStateV1 {
  return {
    ...clearOutcome(operation),
    ownerProcessId: null,
    completedAt: nowIso(now),
    timeout: { ...operation.timeout, triggered: operation.timeout.triggered || category === 'timeout' },
    failure: { category, message: boundedMessage(message, 'Core conformance failed.') },
    rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
  }
}

function cancelledBeforeStart(record: CoreBenchActionRecordV1, now: () => Date, requestedAt: string): ActionOperationStateV1 {
  return {
    ...clearOutcome(record.operation),
    ownerProcessId: null,
    startedAt: null,
    completedAt: nowIso(now),
    progress: { planned: CORE_CHECK_COUNT, completed: 0 },
    checksPlanned: CORE_CHECK_COUNT,
    checksCompleted: 0,
    cancellation: { requested: true, requestedAt },
    failure: { category: 'cancelled', message: 'Core conformance was cancelled before execution started.' },
    rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
  }
}

function exactBenchIdentity(result: BenchEvaluationV1, actionId: string, contract: ActionContractV1): boolean {
  return result.schemaVersion === BENCH_EVALUATION_SCHEMA_VERSION
    && result.runId === actionId
    && result.model.selected === contract.target.model
    && result.pack.packId === contract.target.pack.packId
    && result.pack.version === contract.target.pack.version
    && result.pack.digest === contract.target.pack.digest
    && result.runtime.id === contract.target.runtime.id
    && result.runtime.endpoint === contract.target.runtime.endpoint
}

async function findBenchEvidence(actionId: string, contract: ActionContractV1, dataDir?: string): Promise<BenchEvaluationV1 | undefined> {
  const scan = await scanBenchHistoryV1({ dataDir })
  return scan.records.find(result => exactBenchIdentity(result, actionId, contract))
}

function countsEqual(left: ReturnType<typeof resultCounts>, right: ReturnType<typeof resultCounts>): boolean {
  return left.planned === right.planned
    && left.attempted === right.attempted
    && left.passed === right.passed
    && left.failed === right.failed
    && left.unavailable === right.unavailable
    && left.timedOut === right.timedOut
    && left.cancelled === right.cancelled
}

async function verifyBenchEvidence(record: CoreBenchActionRecordV1, dataDir?: string): Promise<CoreBenchActionRecordV1> {
  if (!record.operation.result) return record
  const evidence = await findBenchEvidence(record.id, record.contract, dataDir)
  if (!evidence) throw new ActionOperationError('identity-mismatch', 'the action journal references missing or mismatched Bench evidence')
  if (record.operation.result.resultDigest !== evidence.resultDigest) throw new ActionOperationError('identity-mismatch', 'the action journal result digest does not match canonical Bench evidence')
  if (!record.operation.resultCounts || !countsEqual(record.operation.resultCounts, resultCounts(evidence))) {
    throw new ActionOperationError('identity-mismatch', 'the action journal result counts do not match Bench evidence')
  }
  const expected = terminalFromEvidence(record, evidence, () => new Date())
  if (record.status !== expected.status || record.operation.failure?.category !== expected.operation.failure?.category) {
    throw new ActionOperationError('identity-mismatch', 'the action journal terminal state does not match Bench evidence')
  }
  return record
}

function terminalFromEvidence(record: CoreBenchActionRecordV1, evidence: BenchEvaluationV1, now: () => Date): { status: ActionOperationStatus; operation: ActionOperationStateV1 } {
  if (record.operation.cancellation.requested) return { status: 'cancelled', operation: cancellationOperation(record.operation, record.operation.cancellation.requestedAt ?? nowIso(now), now, 'Core conformance cancellation requested; persisted evidence was discarded.') }
  const counts = resultCounts(evidence)
  const reference = resultReference(evidence, 'saved')
  const common: ActionOperationStateV1 = {
    ...record.operation,
    ownerProcessId: null,
    completedAt: nowIso(now),
    progress: { planned: CORE_CHECK_COUNT, completed: counts.attempted },
    checksPlanned: CORE_CHECK_COUNT,
    checksCompleted: counts.attempted,
    timeout: { ...record.operation.timeout, triggered: record.operation.timeout.triggered || counts.timedOut > 0 },
    result: reference,
    resultCounts: counts,
    evidenceReferences: [evidenceReference(evidence, 'saved')],
    failure: null,
    rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
  }
  if (evidence.status === 'cancelled') {
    return {
      status: 'cancelled',
      operation: {
        ...common,
        result: null,
        resultCounts: null,
        evidenceReferences: [],
        cancellation: { requested: true, requestedAt: record.operation.cancellation.requestedAt ?? nowIso(now) },
        failure: { category: 'cancelled', message: 'Core conformance was cancelled before its terminal journal record was written.' },
      },
    }
  }
  if (counts.timedOut > 0) {
    return {
      status: 'failed',
      operation: { ...common, failure: { category: 'timeout', message: failureFromBench(evidence, 'A bounded Core conformance request timed out.') } },
    }
  }
  if (evidence.status === 'unavailable') {
    return {
      status: 'unavailable',
      operation: { ...common, failure: { category: 'unavailable', message: failureFromBench(evidence, 'Ollama local runtime was unavailable.') } },
    }
  }
  return { status: 'completed', operation: common }
}

async function recoverRunningRecord(
  record: CoreBenchActionRecordV1,
  actionsDir: string,
  dataDir: string | undefined,
  now: () => Date,
): Promise<CoreBenchActionRecordV1> {
  const evidence = await findBenchEvidence(record.id, record.contract, dataDir)
  if (evidence) {
    const terminal = terminalFromEvidence(record, evidence, now)
    return appendOperationRecord(actionsDir, record.contract, terminal.status, terminal.operation, now)
  }
  if (record.operation.cancellation.requested) {
    return appendOperationRecord(actionsDir, record.contract, 'cancelled', cancellationOperation(record.operation, record.operation.cancellation.requestedAt!, now, 'Core conformance owner exited after cancellation was requested.'), now)
  }
  const category = record.operation.timeout.triggered ? 'timeout' : 'execution'
  return appendOperationRecord(actionsDir, record.contract, 'failed', failureOperation(record.operation, category, category === 'timeout' ? 'The Core conformance owner exited after its bounded timeout.' : 'The previous Core Bench owner exited before completing; a new action is required.', now), now)
}

async function recoverDeadRunningRecords(
  records: CoreBenchActionRecordV1[],
  actionsDir: string,
  dataDir: string | undefined,
  now: () => Date,
): Promise<void> {
  for (const record of records) {
    if (record.status !== 'running' || processIsAlive(record.operation.ownerProcessId)) continue
    const current = await latestRecord(actionsDir, record.id)
    if (current?.status === 'running' && !processIsAlive(current.operation.ownerProcessId)) await recoverRunningRecord(current, actionsDir, dataDir, now)
  }
}

type ActiveExecution = {
  actionId: string
  controller: AbortController
  cancelled: boolean
  cancellationRequestedAt: string | null
  operationTimedOut: boolean
  fatalError: ActionOperationError | null
  finalized: boolean
  finalizing: boolean
  accepted: boolean
}

const activeExecutions = new Map<string, ActiveExecution>()

function interrupt(active: ActiveExecution, reason: 'cancelled' | 'timeout' | 'journal', error?: unknown): void {
  if (reason === 'cancelled') {
    active.cancelled = true
    active.cancellationRequestedAt ??= new Date().toISOString()
  } else if (reason === 'timeout') {
    active.operationTimedOut = true
  } else if (!active.fatalError) {
    active.fatalError = error instanceof ActionOperationError
      ? error
      : new ActionOperationError('journal', boundedMessage(error, 'the ACT journal became unavailable during execution'))
  }
  if (!active.controller.signal.aborted) active.controller.abort(new Error(`Core conformance ${reason}`))
}

function abortReason(active: ActiveExecution): 'cancelled' | 'timeout' | 'journal' {
  if (active.cancelled) return 'cancelled'
  if (active.fatalError) return 'journal'
  return 'timeout'
}

function startCancellationPoll(active: ActiveExecution, actionsDir: string, now: () => Date): () => void {
  let stopped = false
  let inFlight = false
  const tick = async (): Promise<void> => {
    if (stopped || active.finalized || active.finalizing || inFlight) return
    inFlight = true
    try {
      const current = await withActionLock(actionsDir, () => latestRecord(actionsDir, active.actionId))
      if (!current) throw new ActionOperationError('journal', 'the running action disappeared from the ACT journal')
      if (current.status !== 'running' || current.operation.ownerProcessId !== process.pid) throw new ActionOperationError('concurrent', 'the running action owner changed unexpectedly')
      if (current.operation.cancellation.requested) {
        active.cancellationRequestedAt ??= current.operation.cancellation.requestedAt ?? nowIso(now)
        interrupt(active, 'cancelled')
      }
    } catch (error) {
      if (!stopped && !active.finalized && !active.finalizing) interrupt(active, 'journal', error)
    } finally {
      inFlight = false
    }
  }
  const handle = setInterval(() => { void tick() }, CANCELLATION_POLL_MS)
  handle.unref?.()
  void tick()
  return () => {
    stopped = true
    clearInterval(handle)
  }
}

async function prepareExecution(
  contract: ActionContractV1,
  active: ActiveExecution,
  actionsDir: string,
  dataDir: string | undefined,
  now: () => Date,
): Promise<{ kind: 'running'; record: CoreBenchActionRecordV1 } | { kind: 'terminal'; record: CoreBenchActionRecordV1 }> {
  return withActionLock(actionsDir, async () => {
    let current = await latestRecord(actionsDir, contract.actionId)
    if (current && !sameActionContract(current.contract, contract)) throw new ActionOperationError('identity-mismatch', 'the approved action no longer matches the recorded proposal')
    if (current?.status === 'running') {
      if (processIsAlive(current.operation.ownerProcessId)) throw new ActionOperationError('concurrent', 'the Core Bench action is already running')
      return { kind: 'terminal', record: await recoverRunningRecord(current, actionsDir, dataDir, now) }
    }
    if (current && isTerminal(current.status)) throw new ActionOperationError('replay', 'the action has already reached a terminal state; replay is rejected')

    let records = await readCoreRecords(actionsDir)
    await recoverDeadRunningRecords(records.filter(record => record.id !== contract.actionId), actionsDir, dataDir, now)
    records = await readCoreRecords(actionsDir)
    const blocking = records.find(record => record.status === 'running' && processIsAlive(record.operation.ownerProcessId))
    if (blocking) throw new ActionOperationError('concurrent', 'another Core Bench action is already running')

    if (!current) {
      await appendOperationRecord(actionsDir, proposalContract(contract), 'proposed', initialOperationState(contract), now)
      current = await appendOperationRecord(actionsDir, contract, 'ready', initialOperationState(contract), now)
    } else if (current.status === 'proposed') {
      current = await appendOperationRecord(actionsDir, contract, 'ready', current.operation, now)
    }
    if (active.cancelled || active.controller.signal.aborted) {
      const requestedAt = active.cancellationRequestedAt ?? nowIso(now)
      active.cancellationRequestedAt ??= requestedAt
      return { kind: 'terminal', record: await appendOperationRecord(actionsDir, contract, 'cancelled', cancelledBeforeStart(current, now, requestedAt), now) }
    }
    const operation: ActionOperationStateV1 = {
      ...clearOutcome(current.operation),
      ownerProcessId: process.pid,
      startedAt: nowIso(now),
      completedAt: null,
      progress: { planned: CORE_CHECK_COUNT, completed: current.operation.progress.completed },
      checksPlanned: CORE_CHECK_COUNT,
      checksCompleted: current.operation.checksCompleted,
      cancellation: { requested: false, requestedAt: null },
      timeout: { ...current.operation.timeout, triggered: false },
      rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
    }
    return { kind: 'running', record: await appendOperationRecord(actionsDir, contract, 'running', operation, now) }
  })
}

async function finalizeOperation(
  active: ActiveExecution,
  contract: ActionContractV1,
  actionsDir: string,
  now: () => Date,
  build: (current: CoreBenchActionRecordV1) => { status: ActionOperationStatus; operation: ActionOperationStateV1 },
): Promise<CoreBenchActionRecordV1> {
  active.finalizing = true
  try {
    const record = await withActionLock(actionsDir, async () => {
      const current = await latestRecord(actionsDir, active.actionId)
      if (!current) throw new ActionOperationError('journal', 'the running action disappeared from the ACT journal')
      if (isTerminal(current.status)) return current
      if (current.status !== 'running' || current.operation.ownerProcessId !== process.pid) throw new ActionOperationError('concurrent', 'the running action owner changed unexpectedly')
      if (active.cancelled || current.operation.cancellation.requested) {
        return appendOperationRecord(actionsDir, contract, 'cancelled', cancellationOperation(current.operation, active.cancellationRequestedAt ?? current.operation.cancellation.requestedAt ?? nowIso(now), now, 'Core conformance cancellation requested; late results were discarded.'), now)
      }
      if (active.fatalError) return appendOperationRecord(actionsDir, contract, 'failed', failureOperation(current.operation, failedCategory(active.fatalError, 'journal'), active.fatalError.message, now), now)
      if (active.operationTimedOut) return appendOperationRecord(actionsDir, contract, 'failed', failureOperation(current.operation, 'timeout', 'Core conformance operation exceeded its bounded timeout; late results were discarded.', now), now)
      const decision = build(current)
      return appendOperationRecord(actionsDir, contract, decision.status, decision.operation, now)
    })
    active.accepted = isTerminal(record.status)
    return record
  } finally {
    active.finalized = true
  }
}

function progressCallback(active: ActiveExecution, contract: ActionContractV1, actionsDir: string, now: () => Date): (progress: BenchTaskPackProgressV1) => Promise<void> {
  return async progress => {
    if (active.finalized || active.finalizing || active.controller.signal.aborted) return
    if (progress.planned !== CORE_CHECK_COUNT || !Number.isInteger(progress.completed) || progress.completed < 1 || progress.completed > CORE_CHECK_COUNT || !CORE_TASK_PACK_V1.tasks.some(task => task.id === progress.currentTaskId)) throw new ActionOperationError('validation', 'the Bench runner reported invalid Core task progress')
    try {
      await withActionLock(actionsDir, async () => {
        const current = await latestRecord(actionsDir, contract.actionId)
        if (!current) throw new ActionOperationError('journal', 'the running action disappeared from the ACT journal')
        if (current.status !== 'running' || current.operation.ownerProcessId !== process.pid) throw new ActionOperationError('concurrent', 'the running action owner changed unexpectedly')
        if (current.operation.cancellation.requested) {
          active.cancellationRequestedAt ??= current.operation.cancellation.requestedAt ?? nowIso(now)
          interrupt(active, 'cancelled')
          return
        }
        if (progress.completed <= current.operation.progress.completed) return
        const operation: ActionOperationStateV1 = { ...current.operation, progress: { planned: CORE_CHECK_COUNT, completed: progress.completed }, checksPlanned: CORE_CHECK_COUNT, checksCompleted: progress.completed }
        await appendOperationRecord(actionsDir, contract, 'running', operation, now)
      })
    } catch (error) {
      if (!active.finalized && !active.finalizing) interrupt(active, 'journal', error)
      throw error
    }
  }
}

function resultDecision(current: CoreBenchActionRecordV1, saved: Awaited<ReturnType<typeof saveBenchEvaluationV1>>, now: () => Date): { status: ActionOperationStatus; operation: ActionOperationStateV1 } {
  const result = saved.record
  const counts = resultCounts(result)
  if (counts.attempted < current.operation.progress.completed) return { status: 'failed', operation: failureOperation(current.operation, 'identity-mismatch', 'Bench result progress regressed from the journaled progress.', now) }
  const reference = resultReference(result, saved.status)
  const operation: ActionOperationStateV1 = {
    ...current.operation,
    ownerProcessId: null,
    completedAt: nowIso(now),
    progress: { planned: CORE_CHECK_COUNT, completed: counts.attempted },
    checksPlanned: CORE_CHECK_COUNT,
    checksCompleted: counts.attempted,
    timeout: { ...current.operation.timeout, triggered: current.operation.timeout.triggered || counts.timedOut > 0 },
    result: reference,
    resultCounts: counts,
    evidenceReferences: [evidenceReference(result, saved.status)],
    failure: null,
    rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
  }
  if (result.status === 'cancelled') return { status: 'cancelled', operation: { ...operation, result: null, resultCounts: null, evidenceReferences: [], cancellation: { requested: true, requestedAt: current.operation.cancellation.requestedAt ?? nowIso(now) }, failure: { category: 'cancelled', message: 'Core conformance was cancelled; late results were discarded.' } } }
  if (counts.timedOut > 0) return { status: 'failed', operation: { ...operation, failure: { category: 'timeout', message: failureFromBench(result, 'A bounded Core conformance request timed out.') } } }
  if (result.status === 'unavailable') return { status: 'unavailable', operation: { ...operation, failure: { category: 'unavailable', message: failureFromBench(result, 'Ollama local runtime was unavailable.') } } }
  return { status: 'completed', operation }
}

export async function recordCoreConformanceProposal(contractInput: ActionContractV1, options: BenchActionProposalOptions = {}): Promise<CoreBenchActionRecordV1> {
  const contract = validateActionContractV1(contractInput)
  assertFreshActionContract(contract, false)
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const now = options.now ?? (() => new Date())
  return withActionLock(actionsDir, async () => {
    if (await latestRecord(actionsDir, contract.actionId)) throw new ActionOperationError('duplicate', 'the action id has already been proposed or executed')
    return appendOperationRecord(actionsDir, proposalContract(contract), 'proposed', initialOperationState(contract), now)
  })
}

export async function executeApprovedCoreConformanceBench(approvedInput: ApprovedActionV1, options: BenchActionExecutionOptions): Promise<CoreBenchActionRecordV1> {
  const approved = options.authority.verifyApprovedAction(approvedInput)
  const contract = approved.contract
  assertFreshActionContract(contract, true)
  const actionId = contract.actionId
  if (activeExecutions.has(actionId)) throw new ActionOperationError('concurrent', 'the Core Bench action is already running')
  const active: ActiveExecution = { actionId, controller: new AbortController(), cancelled: false, cancellationRequestedAt: null, operationTimedOut: false, fatalError: null, finalized: false, finalizing: false, accepted: false }
  activeExecutions.set(actionId, active)
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const now = options.now ?? (() => new Date())
  const dataDir = options.dataDir
  const runBench = options.runBench ?? runBenchTaskPackV1
  let removeExternalAbort: (() => void) | undefined
  const requestExternalAbort = (): void => {
    if (!active.finalized) interrupt(active, 'cancelled', options.signal?.reason)
  }
  if (options.signal) {
    if (options.signal.aborted) requestExternalAbort()
    else {
      options.signal.addEventListener('abort', requestExternalAbort, { once: true })
      removeExternalAbort = () => options.signal?.removeEventListener('abort', requestExternalAbort)
    }
  }

  let stopCancellationPoll: (() => void) | undefined
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let removeAbortListener: (() => void) | undefined
  try {
    const prepared = await prepareExecution(contract, active, actionsDir, dataDir, now)
    if (prepared.kind === 'terminal') return prepared.record
    stopCancellationPoll = startCancellationPoll(active, actionsDir, now)
    timeoutHandle = setTimeout(() => { if (!active.finalized) interrupt(active, 'timeout') }, contract.timeout.operationMs)
    timeoutHandle.unref?.()

    const abortPromise = new Promise<{ kind: 'abort'; reason: 'cancelled' | 'timeout' | 'journal' }>(resolve => {
      const onAbort = (): void => resolve({ kind: 'abort', reason: abortReason(active) })
      active.controller.signal.addEventListener('abort', onAbort, { once: true })
      removeAbortListener = () => active.controller.signal.removeEventListener('abort', onAbort)
      if (active.controller.signal.aborted) onAbort()
    })
    if (active.controller.signal.aborted) return finalizeOperation(active, contract, actionsDir, now, () => ({ status: 'failed', operation: failureOperation(prepared.record.operation, 'execution', 'Core conformance was cancelled before its runner started.', now) }))

    const runPromise = Promise.resolve().then(() => runBench({ model: contract.arguments.model, packId: contract.target.pack.selector, runId: actionId, fetchImpl: options.fetchImpl, signal: active.controller.signal, timeoutMs: contract.timeout.perRequestMs, now, monotonicNow: options.monotonicNow, onProgress: progressCallback(active, contract, actionsDir, now) })).then(
      result => ({ kind: 'result' as const, result }),
      error => ({ kind: 'error' as const, error }),
    )
    const outcome = await Promise.race([runPromise, abortPromise])
    if (outcome.kind === 'abort') return finalizeOperation(active, contract, actionsDir, now, () => ({ status: 'failed', operation: failureOperation(prepared.record.operation, outcome.reason === 'timeout' ? 'timeout' : outcome.reason === 'journal' ? 'journal' : 'execution', outcome.reason === 'cancelled' ? 'Core conformance cancellation requested; late results were discarded.' : outcome.reason === 'timeout' ? 'Core conformance operation exceeded its bounded timeout; late results were discarded.' : 'The ACT journal became unavailable during Core conformance.', now) }))
    if (active.cancelled || active.operationTimedOut || active.fatalError || active.controller.signal.aborted) return finalizeOperation(active, contract, actionsDir, now, current => ({ status: 'failed', operation: failureOperation(current.operation, active.fatalError ? 'journal' : active.operationTimedOut ? 'timeout' : 'execution', active.fatalError?.message ?? (active.operationTimedOut ? 'Core conformance operation exceeded its bounded timeout; late results were discarded.' : 'Core conformance cancellation requested; late results were discarded.'), now) }))
    if (outcome.kind === 'error') return finalizeOperation(active, contract, actionsDir, now, current => ({ status: 'failed', operation: failureOperation(current.operation, failedCategory(outcome.error, 'execution'), boundedMessage(outcome.error, 'Core conformance execution failed.'), now) }))

    let result: BenchEvaluationV1
    try { result = parseBenchEvaluationV1(outcome.result) } catch (error) { return finalizeOperation(active, contract, actionsDir, now, current => ({ status: 'failed', operation: failureOperation(current.operation, 'malformed-result', boundedMessage(error, 'Bench returned a malformed result.'), now) })) }
    if (!exactBenchIdentity(result, actionId, contract)) return finalizeOperation(active, contract, actionsDir, now, current => ({ status: 'failed', operation: failureOperation(current.operation, 'identity-mismatch', 'Bench result identity did not match the approved action.', now) }))

    const savePromise = saveBenchEvaluationV1(result, { dataDir }).then(saved => ({ kind: 'saved' as const, saved })).catch(error => ({ kind: 'error' as const, error }))
    const persisted = await Promise.race([savePromise, abortPromise])
    if (persisted.kind === 'abort') return finalizeOperation(active, contract, actionsDir, now, () => ({ status: 'failed', operation: failureOperation(prepared.record.operation, persisted.reason === 'timeout' ? 'timeout' : persisted.reason === 'journal' ? 'journal' : 'execution', persisted.reason === 'cancelled' ? 'Core conformance cancellation requested; late results were discarded.' : persisted.reason === 'timeout' ? 'Core conformance operation exceeded its bounded timeout; late results were discarded.' : 'The ACT journal became unavailable during Core conformance.', now) }))
    if (persisted.kind === 'error') return finalizeOperation(active, contract, actionsDir, now, current => ({ status: 'failed', operation: failureOperation(current.operation, 'journal', boundedMessage(persisted.error, 'Bench result could not be saved to history.'), now) }))
    return finalizeOperation(active, contract, actionsDir, now, current => resultDecision(current, persisted.saved, now))
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    removeAbortListener?.()
    stopCancellationPoll?.()
    active.finalized = true
    removeExternalAbort?.()
    if (activeExecutions.get(actionId) === active) activeExecutions.delete(actionId)
  }
}

async function appendCancellationRequest(record: CoreBenchActionRecordV1, actionsDir: string, now: () => Date, requestedAt: string): Promise<BenchActionCancellationResult> {
  if (isTerminal(record.status)) return { status: 'already-terminal', record }
  if (record.status === 'proposed' || record.status === 'ready') return { status: 'cancelled', record: await appendOperationRecord(actionsDir, record.contract, 'cancelled', cancelledBeforeStart(record, now, requestedAt), now) }
  if (record.status !== 'running') return { status: 'owner-unavailable', record }
  if (record.operation.cancellation.requested) return { status: 'requested' }
  await appendOperationRecord(actionsDir, record.contract, 'running', { ...record.operation, cancellation: { requested: true, requestedAt } }, now)
  return { status: 'requested' }
}

export async function cancelCoreConformanceBenchAction(actionId: string, options: BenchActionCancellationOptions = {}): Promise<BenchActionCancellationResult> {
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const dataDir = options.dataDir
  const now = options.now ?? (() => new Date())
  const requestedAt = nowIso(now)
  const active = activeExecutions.get(actionId)
  if (active) {
    const cancellationWasAccepted = !active.finalized && !active.accepted
    active.cancelled = true
    active.cancellationRequestedAt ??= requestedAt
    if (!active.controller.signal.aborted) active.controller.abort(new Error('Core conformance cancellation requested'))
    return withActionLock(actionsDir, async () => {
      const current = await latestRecord(actionsDir, actionId)
      if (!current) return { status: 'requested' }
      if (current.status === 'running' && current.operation.ownerProcessId === process.pid && !current.operation.cancellation.requested) {
        await appendOperationRecord(actionsDir, current.contract, 'running', { ...current.operation, cancellation: { requested: true, requestedAt: active.cancellationRequestedAt! } }, now)
        return { status: 'requested' }
      }
      if (current.status === 'proposed' || current.status === 'ready') return appendCancellationRequest(current, actionsDir, now, active.cancellationRequestedAt!)
      if (isTerminal(current.status)) return cancellationWasAccepted ? { status: 'requested' } : { status: 'already-terminal', record: current }
      if (current.status === 'running' && current.operation.ownerProcessId !== process.pid) return { status: 'owner-unavailable', record: current }
      return { status: 'requested' }
    })
  }

  return withActionLock(actionsDir, async () => {
    const current = await latestRecord(actionsDir, actionId)
    if (!current) return { status: 'not-found' }
    if (isTerminal(current.status)) return { status: 'already-terminal', record: current }
    if (current.status === 'proposed' || current.status === 'ready') return appendCancellationRequest(current, actionsDir, now, requestedAt)
    if (current.status !== 'running') return { status: 'owner-unavailable', record: current }
    const evidence = await findBenchEvidence(actionId, current.contract, dataDir)
    if (evidence) {
      const terminal = terminalFromEvidence(current, evidence, now)
      const recovered = await appendOperationRecord(actionsDir, current.contract, terminal.status, terminal.operation, now)
      return { status: 'already-terminal', record: recovered }
    }
    if (processIsAlive(current.operation.ownerProcessId)) return appendCancellationRequest(current, actionsDir, now, requestedAt)
    return { status: 'cancelled', record: await appendOperationRecord(actionsDir, current.contract, 'cancelled', cancellationOperation(current.operation, requestedAt, now, 'Core conformance was cancelled after its owner became unavailable.'), now) }
  })
}

export async function readCoreConformanceAction(actionId: string, options: { actionsDir?: string; dataDir?: string } = {}): Promise<CoreBenchActionRecordV1 | null> {
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const now = () => new Date()
  return withActionLock(actionsDir, async () => {
    let record = await latestRecord(actionsDir, actionId)
    if (!record) return null
    if (record.status === 'running' && !processIsAlive(record.operation.ownerProcessId)) record = await recoverRunningRecord(record, actionsDir, options.dataDir, now)
    return verifyBenchEvidence(record, options.dataDir)
  })
}
