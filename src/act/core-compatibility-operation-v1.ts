import { defaultActionsDir, withLock } from './journal.js'
import {
  ActionContractError,
  ACTION_NO_ROLLBACK_REASON,
  CORE_CHECK_COUNT,
  type ActionContractV1,
  type ActionFailureCategoryV1,
  type ActionOperationStateV1,
  type ActionOperationStatus,
  type ApprovedActionV1,
  TrustedActionAuthorityV1,
  computeActionProposalDigest,
  isFreshApprovalIssuedAt,
  validateActionContractV1,
} from './action-contract-v1.js'
import {
  ActionOperationError,
  appendOperationRecord,
  assertFreshActionContract,
  boundedMessage,
  clearOutcome,
  countsEqual,
  evidenceReference,
  failureFromBench,
  initialOperationState,
  isTerminal,
  latestCoreCompatibilityRecord,
  nowIso,
  processIsAlive,
  proposalContract,
  readCoreCompatibilityRecords,
  resultCounts,
  resultReference,
  sameActionContract,
  type CoreCompatibilityActionCancellationResult,
  type CoreCompatibilityActionRecordV1,
} from './core-compatibility-state-v1.js'
import {
  BENCH_EVALUATION_SCHEMA_VERSION,
  BENCH_TASK_RUNNER_ID,
  BENCH_TASK_RUNNER_VERSION,
  digestBenchEvaluationV1,
  runBenchTaskPackV1,
  type BenchEvaluationV1,
  type BenchTaskPackRunOptions,
} from '../bench/task-pack-run-v1.js'
import { parseBenchEvaluationV1, saveBenchEvaluationV1, scanBenchHistoryV1 } from '../bench/history-v1.js'
import { CORE_TASK_PACK_V1 } from '../bench/task-pack-v1.js'
import { OLLAMA_LOCAL_BASE_URL, type BenchFetch } from '../bench/ollama-local.js'

export { ACTION_RECORD_VERSION, ActionOperationError } from './core-compatibility-state-v1.js'
export type { CoreCompatibilityActionCancellationResult, CoreCompatibilityActionRecordV1 } from './core-compatibility-state-v1.js'

export type CoreCompatibilityActionExecutionOptions = {
  authority: TrustedActionAuthorityV1
  actionsDir?: string
  dataDir?: string
  fetchImpl?: BenchFetch
  signal?: AbortSignal
  now?: () => Date
  monotonicNow?: () => number
  /** Internal test seam; the public action surface always uses the canonical runner. */
  runBench?: (options: BenchTaskPackRunOptions) => Promise<BenchEvaluationV1>
}
export type CoreCompatibilityActionCancellationOptions = { actionsDir?: string; dataDir?: string; now?: () => Date }

const LOCK_RETRIES = 120
const LOCK_RETRY_MS = 25
const CANCELLATION_POLL_MS = 100
type ActiveExecution = {
  actionId: string
  controller: AbortController
  cancelled: boolean
  cancellationRequestedAt: string | null
  operationTimedOut: boolean
  journalFailure: ActionOperationError | null
  finalized: boolean
  finalizing: boolean
}
const activeExecutions = new Map<string, ActiveExecution>()

function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)) }
function isLockBusy(error: unknown): boolean {
  return error instanceof Error && (error.message.includes('another metrora action is in progress') || error.message.includes('could not acquire the metrora action lock'))
}
async function withActionLock<T>(actionsDir: string, operation: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try { return await withLock(actionsDir, operation) } catch (error) {
      if (!isLockBusy(error)) throw error
      last = error
      await sleep(LOCK_RETRY_MS)
    }
  }
  throw new ActionOperationError('concurrent', boundedMessage(last, 'the ACT journal lock remained busy'))
}
function failedOperation(operation: ActionOperationStateV1, category: Exclude<ActionFailureCategoryV1, 'cancelled' | 'unavailable'>, message: string, now: () => Date): ActionOperationStateV1 {
  return { ...clearOutcome(operation), ownerProcessId: null, completedAt: nowIso(now), timeout: { ...operation.timeout, triggered: operation.timeout.triggered || category === 'timeout' }, failure: { category, message: boundedMessage(message, 'Core Compatibility failed.') }, rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON } }
}
function cancelledBeforeStart(record: CoreCompatibilityActionRecordV1, now: () => Date, requestedAt: string, message = 'Core Compatibility was cancelled before execution started.'): ActionOperationStateV1 {
  return { ...clearOutcome(record.operation), ownerProcessId: null, startedAt: null, completedAt: nowIso(now), progress: { planned: CORE_CHECK_COUNT, completed: 0 }, checksPlanned: CORE_CHECK_COUNT, checksCompleted: 0, cancellation: { requested: true, requestedAt }, failure: { category: 'cancelled', message }, rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON } }
}
function cancellationState(operation: ActionOperationStateV1, now: () => Date, requestedAt: string, message: string): ActionOperationStateV1 {
  return { ...clearOutcome(operation), ownerProcessId: null, completedAt: nowIso(now), cancellation: { requested: true, requestedAt: operation.cancellation.requestedAt ?? requestedAt }, failure: { category: 'cancelled', message: boundedMessage(message, 'Core Compatibility was cancelled.') }, rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON } }
}
function exactBenchIdentity(result: BenchEvaluationV1, actionId: string, contract: ActionContractV1): boolean {
  return result.schemaVersion === BENCH_EVALUATION_SCHEMA_VERSION
    && result.runId === actionId
    && result.runner.id === BENCH_TASK_RUNNER_ID
    && result.runner.version === BENCH_TASK_RUNNER_VERSION
    && result.model.selected === contract.target.model
    && result.pack.packId === contract.target.pack.packId
    && result.pack.version === contract.target.pack.version
    && result.pack.digest === contract.target.pack.digest
    && result.runtime.id === contract.target.runtime.id
    && result.runtime.endpoint === contract.target.runtime.endpoint
    && result.generation.policy === 'one-bounded-request-per-task'
    && result.generation.parameters.temperature === 0
    && result.generation.parameters.seed === 1729
    && result.generation.parameters.numPredict === 64
    && result.tasks.length === CORE_TASK_COUNT
    && result.aggregate.planned === CORE_CHECK_COUNT
    && digestBenchEvaluationV1(result) === result.resultDigest
}
const CORE_TASK_COUNT = CORE_TASK_PACK_V1.tasks.length
async function findEvidence(actionId: string, contract: ActionContractV1, dataDir?: string): Promise<BenchEvaluationV1 | undefined> {
  const scan = await scanBenchHistoryV1({ dataDir })
  return scan.records.find(result => exactBenchIdentity(result, actionId, contract))
}
function terminalFromResult(record: CoreCompatibilityActionRecordV1, result: BenchEvaluationV1, history: 'saved' | 'duplicate', now: () => Date): { status: ActionOperationStatus; operation: ActionOperationStateV1 } {
  const counts = resultCounts(result)
  const reference = resultReference(result, history)
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
    evidenceReferences: [evidenceReference(result, history)],
    failure: null,
    rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
  }
  if (record.operation.cancellation.requested || result.status === 'cancelled') {
    return { status: 'cancelled', operation: { ...clearOutcome(common), cancellation: { requested: true, requestedAt: record.operation.cancellation.requestedAt ?? nowIso(now) }, failure: { category: 'cancelled', message: 'Core Compatibility cancellation was authoritative; the result was discarded.' } } }
  }
  if (counts.timedOut > 0) return { status: 'failed', operation: { ...common, failure: { category: 'timeout', message: failureFromBench(result, 'A bounded Core Compatibility request timed out.') } } }
  if (result.status === 'unavailable') return { status: 'unavailable', operation: { ...common, failure: { category: 'unavailable', message: failureFromBench(result, 'Ollama local runtime was unavailable.') } } }
  return { status: 'completed', operation: common }
}
async function recoverRunningRecord(record: CoreCompatibilityActionRecordV1, actionsDir: string, dataDir: string | undefined, now: () => Date): Promise<CoreCompatibilityActionRecordV1> {
  const evidence = await findEvidence(record.id, record.contract, dataDir)
  if (evidence) {
    const terminal = terminalFromResult(record, evidence, 'duplicate', now)
    return appendOperationRecord(actionsDir, record.contract, terminal.status, terminal.operation, now)
  }
  if (record.operation.cancellation.requested) return appendOperationRecord(actionsDir, record.contract, 'cancelled', cancellationState(record.operation, now, record.operation.cancellation.requestedAt ?? nowIso(now), 'The previous owner exited after cancellation was requested.'), now)
  const category = record.operation.timeout.triggered ? 'timeout' : 'execution'
  return appendOperationRecord(actionsDir, record.contract, 'failed', failedOperation(record.operation, category, category === 'timeout' ? 'The previous owner exited after the bounded timeout.' : 'The previous owner exited before completion; a new action is required.', now), now)
}
async function verifyStoredEvidence(record: CoreCompatibilityActionRecordV1, dataDir?: string): Promise<CoreCompatibilityActionRecordV1> {
  if (!record.operation.result) return record
  const evidence = await findEvidence(record.id, record.contract, dataDir)
  if (!evidence || record.operation.result.resultDigest !== evidence.resultDigest || !record.operation.resultCounts || !countsEqual(record.operation.resultCounts, resultCounts(evidence))) throw new ActionOperationError('identity-mismatch', 'the ACT journal references missing or mismatched Bench evidence')
  return record
}
export async function recordCoreCompatibilityProposal(contractInput: ActionContractV1, options: { actionsDir?: string; now?: () => Date } = {}): Promise<CoreCompatibilityActionRecordV1> {
  let contract: ActionContractV1
  try { contract = validateActionContractV1(contractInput) } catch (error) { throw new ActionOperationError('validation', boundedMessage(error, 'the Core Compatibility action contract is invalid')) }
  assertFreshActionContract(contract, false)
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const now = options.now ?? (() => new Date())
  return withActionLock(actionsDir, async () => {
    if (await latestCoreCompatibilityRecord(actionsDir, contract.actionId)) throw new ActionOperationError('duplicate', 'the action id has already been proposed or executed')
    const proposal = proposalContract(contract)
    return appendOperationRecord(actionsDir, proposal, 'proposed', initialOperationState(proposal), now)
  })
}

async function prepareExecution(contract: ActionContractV1, approvalIssuedAt: string, active: ActiveExecution, actionsDir: string, dataDir: string | undefined, now: () => Date): Promise<{ kind: 'running'; record: CoreCompatibilityActionRecordV1 } | { kind: 'terminal'; record: CoreCompatibilityActionRecordV1 }> {
  return withActionLock(actionsDir, async () => {
    let current = await latestCoreCompatibilityRecord(actionsDir, contract.actionId)
    if (current && !sameActionContract(current.contract, contract)) throw new ActionOperationError('identity-mismatch', 'the approved action does not match the recorded proposal')
    if (current?.status === 'running') {
      if (processIsAlive(current.operation.ownerProcessId)) throw new ActionOperationError('concurrent', 'the Core Compatibility action is already running')
      return { kind: 'terminal', record: await recoverRunningRecord(current, actionsDir, dataDir, now) }
    }
    if (current && isTerminal(current.status)) throw new ActionOperationError('replay', 'the action has already reached a terminal state; replay is rejected')

    let records = await readCoreCompatibilityRecords(actionsDir)
    for (const record of records) {
      if (record.id === contract.actionId || record.status !== 'running') continue
      if (processIsAlive(record.operation.ownerProcessId)) throw new ActionOperationError('concurrent', 'another Core Compatibility action is already running')
      await recoverRunningRecord(record, actionsDir, dataDir, now)
    }
    current = await latestCoreCompatibilityRecord(actionsDir, contract.actionId)
    if (current?.status === 'running') throw new ActionOperationError('concurrent', 'the Core Compatibility action is already running')
    if (current && isTerminal(current.status)) throw new ActionOperationError('replay', 'the action has already reached a terminal state; replay is rejected')

    if (!current) {
      const proposal = proposalContract(contract)
      await appendOperationRecord(actionsDir, proposal, 'proposed', initialOperationState(proposal), now)
      current = await latestCoreCompatibilityRecord(actionsDir, contract.actionId)
    }
    if (!current) throw new ActionOperationError('journal', 'the action proposal could not be persisted')
    if (current.status === 'proposed') {
      const readyOperation: ActionOperationStateV1 = { ...initialOperationState(contract), approvalIssuedAt }
      current = await appendOperationRecord(actionsDir, contract, 'ready', readyOperation, now)
    } else if (current.status === 'ready') {
      if (current.operation.approvalIssuedAt !== approvalIssuedAt) throw new ActionOperationError('approval-invalid', 'the approval is not the exact approval recorded for this action')
      if (!isFreshApprovalIssuedAt(current.operation.approvalIssuedAt, now())) {
        const expired = failedOperation(current.operation, 'approval-expired', 'the persisted action approval expired before execution.', now)
        current = await appendOperationRecord(actionsDir, current.contract, 'failed', expired, now)
        throw new ActionOperationError('approval-expired', 'the persisted action approval expired before execution')
      }
    }
    if (active.cancelled || active.controller.signal.aborted) {
      const requestedAt = active.cancellationRequestedAt ?? nowIso(now)
      active.cancellationRequestedAt ??= requestedAt
      return { kind: 'terminal', record: await appendOperationRecord(actionsDir, contract, 'cancelled', cancelledBeforeStart(current, now, requestedAt), now) }
    }
    const runningOperation: ActionOperationStateV1 = {
      ...clearOutcome(current.operation),
      ownerProcessId: process.pid,
      startedAt: nowIso(now),
      completedAt: null,
      progress: { planned: CORE_CHECK_COUNT, completed: current.operation.progress.completed },
      checksPlanned: CORE_CHECK_COUNT,
      checksCompleted: current.operation.checksCompleted,
      cancellation: { requested: false, requestedAt: null },
      timeout: { ...current.operation.timeout, triggered: false },
      approvalIssuedAt,
      rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
    }
    return { kind: 'running', record: await appendOperationRecord(actionsDir, contract, 'running', runningOperation, now) }
  })
}

function progressCallback(active: ActiveExecution, contract: ActionContractV1, actionsDir: string, now: () => Date): (progress: { planned: number; completed: number }) => Promise<void> {
  return async progress => {
    if (active.finalized || active.finalizing || active.controller.signal.aborted) return
    if (progress.planned !== CORE_CHECK_COUNT || !Number.isInteger(progress.completed) || progress.completed < 0 || progress.completed > CORE_CHECK_COUNT) {
      active.journalFailure ??= new ActionOperationError('validation', 'the canonical Bench runner reported invalid bounded progress')
      active.controller.abort()
      return
    }
    await withActionLock(actionsDir, async () => {
      if (active.finalized || active.finalizing || active.controller.signal.aborted) return
      const current = await latestCoreCompatibilityRecord(actionsDir, contract.actionId)
      if (!current || current.status !== 'running' || current.operation.ownerProcessId !== process.pid) throw new ActionOperationError('concurrent', 'the ACT operation owner changed during progress')
      if (progress.completed < current.operation.progress.completed) throw new ActionOperationError('validation', 'the canonical Bench runner reported regressed progress')
      if (progress.completed === current.operation.progress.completed) return
      const operation = { ...current.operation, progress: { planned: CORE_CHECK_COUNT, completed: progress.completed }, checksCompleted: progress.completed }
      await appendOperationRecord(actionsDir, contract, 'running', operation, now)
    }).catch(error => {
      if (!active.finalized && !active.finalizing) {
        active.journalFailure ??= error instanceof ActionOperationError ? error : new ActionOperationError('journal', boundedMessage(error, 'the ACT journal became unavailable'))
        active.controller.abort()
      }
    })
  }
}
function failureCategory(error: unknown): Exclude<ActionFailureCategoryV1, 'cancelled' | 'unavailable'> {
  if (error instanceof ActionOperationError && error.code !== 'cancelled' && error.code !== 'unavailable' && error.code !== 'not-found' && error.code !== 'owner-unavailable') return error.code
  return 'execution'
}
type FinalOutcome = { kind: 'result'; result: unknown } | { kind: 'error'; error: unknown } | { kind: 'abort'; category: 'cancelled' | 'timeout' | 'journal' }

async function finalizeOperation(active: ActiveExecution, contract: ActionContractV1, actionsDir: string, dataDir: string | undefined, now: () => Date, outcome: FinalOutcome): Promise<CoreCompatibilityActionRecordV1> {
  active.finalizing = true
  try {
    return await withActionLock(actionsDir, async () => {
      const current = await latestCoreCompatibilityRecord(actionsDir, active.actionId)
      if (!current) throw new ActionOperationError('journal', 'the running action disappeared from the ACT journal')
      if (isTerminal(current.status)) return verifyStoredEvidence(current, dataDir)
      if (current.status !== 'running' || current.operation.ownerProcessId !== process.pid) throw new ActionOperationError('concurrent', 'the ACT operation owner changed unexpectedly')
      if (active.cancelled || current.operation.cancellation.requested || (outcome.kind === 'abort' && outcome.category === 'cancelled')) {
        return appendOperationRecord(actionsDir, contract, 'cancelled', cancellationState(current.operation, now, active.cancellationRequestedAt ?? current.operation.cancellation.requestedAt ?? nowIso(now), 'Core Compatibility cancellation was authoritative; late results were discarded.'), now)
      }
      if (active.operationTimedOut || (outcome.kind === 'abort' && outcome.category === 'timeout')) {
        return appendOperationRecord(actionsDir, contract, 'failed', failedOperation(current.operation, 'timeout', 'Core Compatibility exceeded its bounded operation timeout; late results were discarded.', now), now)
      }
      if (active.journalFailure || (outcome.kind === 'abort' && outcome.category === 'journal')) {
        const message = active.journalFailure?.message ?? 'the ACT journal became unavailable during Core Compatibility.'
        return appendOperationRecord(actionsDir, contract, 'failed', failedOperation(current.operation, 'journal', message, now), now)
      }
      if (outcome.kind === 'error') {
        return appendOperationRecord(actionsDir, contract, 'failed', failedOperation(current.operation, failureCategory(outcome.error), boundedMessage(outcome.error, 'Core Compatibility execution failed.'), now), now)
      }
      if (outcome.kind !== 'result') return appendOperationRecord(actionsDir, contract, 'failed', failedOperation(current.operation, outcome.category === 'timeout' ? 'timeout' : 'journal', 'the controlled operation aborted before producing a result.', now), now)
      let result: BenchEvaluationV1
      try { result = parseBenchEvaluationV1(outcome.result) } catch (error) {
        return appendOperationRecord(actionsDir, contract, 'failed', failedOperation(current.operation, 'malformed-result', boundedMessage(error, 'the canonical Bench runner returned a malformed result.'), now), now)
      }
      if (!exactBenchIdentity(result, active.actionId, contract)) {
        return appendOperationRecord(actionsDir, contract, 'failed', failedOperation(current.operation, 'identity-mismatch', 'Bench result identity did not match the approved action.', now), now)
      }
      let saved: Awaited<ReturnType<typeof saveBenchEvaluationV1>>
      try { saved = await saveBenchEvaluationV1(result, { dataDir }) } catch (error) {
        return appendOperationRecord(actionsDir, contract, 'failed', failedOperation(current.operation, 'journal', boundedMessage(error, 'Bench evidence could not be saved to canonical history.'), now), now)
      }
      if (active.cancelled || active.operationTimedOut || current.operation.cancellation.requested) {
        return appendOperationRecord(actionsDir, contract, 'cancelled', cancellationState(current.operation, now, active.cancellationRequestedAt ?? current.operation.cancellation.requestedAt ?? nowIso(now), 'Core Compatibility cancellation was authoritative; the late result was discarded.'), now)
      }
      const terminal = terminalFromResult(current, saved.record, saved.status, now)
      return appendOperationRecord(actionsDir, contract, terminal.status, terminal.operation, now)
    })
  } finally {
    active.finalized = true
    if (activeExecutions.get(active.actionId) === active) activeExecutions.delete(active.actionId)
  }
}

function startCancellationPoll(active: ActiveExecution, actionsDir: string, now: () => Date): () => void {
  let stopped = false
  let inFlight = false
  const tick = async (): Promise<void> => {
    if (stopped || inFlight || active.finalized || active.finalizing) return
    inFlight = true
    try {
      const record = await withActionLock(actionsDir, () => latestCoreCompatibilityRecord(actionsDir, active.actionId))
      if (!record) throw new ActionOperationError('journal', 'the running action disappeared from the ACT journal')
      if (record.status !== 'running' || record.operation.ownerProcessId !== process.pid) throw new ActionOperationError('concurrent', 'the ACT operation owner changed unexpectedly')
      if (record.operation.cancellation.requested) {
        active.cancelled = true
        active.cancellationRequestedAt ??= record.operation.cancellation.requestedAt ?? nowIso(now)
        active.controller.abort()
      }
    } catch (error) {
      if (!stopped && !active.finalized && !active.finalizing) {
        active.journalFailure ??= error instanceof ActionOperationError ? error : new ActionOperationError('journal', boundedMessage(error, 'the ACT journal became unavailable'))
        active.controller.abort()
      }
    } finally { inFlight = false }
  }
  const handle = setInterval(() => { void tick() }, CANCELLATION_POLL_MS)
  handle.unref?.()
  void tick()
  return () => { stopped = true; clearInterval(handle) }
}
function abortCategory(active: ActiveExecution): 'cancelled' | 'timeout' | 'journal' {
  if (active.journalFailure) return 'journal'
  if (active.cancelled) return 'cancelled'
  return 'timeout'
}

export async function executeApprovedCoreCompatibility(approvedInput: ApprovedActionV1 | unknown, options: CoreCompatibilityActionExecutionOptions): Promise<CoreCompatibilityActionRecordV1> {
  let approved: ApprovedActionV1
  try { approved = options.authority.verifyApprovedAction(approvedInput) } catch (error) {
    if (error instanceof ActionOperationError) throw error
    if (error instanceof ActionContractError) throw new ActionOperationError(error.code === 'stale-approval' ? 'approval-expired' : 'approval-invalid', error.message)
    throw error
  }
  const contract = approved.contract
  assertFreshActionContract(contract, true)
  const actionId = contract.actionId
  if (activeExecutions.has(actionId)) throw new ActionOperationError('concurrent', 'the Core Compatibility action is already running')
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const dataDir = options.dataDir
  const now = options.now ?? (() => new Date())
  const active: ActiveExecution = { actionId, controller: new AbortController(), cancelled: false, cancellationRequestedAt: null, operationTimedOut: false, journalFailure: null, finalized: false, finalizing: false }
  activeExecutions.set(actionId, active)
  let removeExternalAbort: (() => void) | undefined
  const requestExternalAbort = (): void => {
    if (!active.finalized) {
      active.cancelled = true
      active.cancellationRequestedAt ??= nowIso(now)
      active.controller.abort()
    }
  }
  if (options.signal) {
    if (options.signal.aborted) requestExternalAbort()
    else {
      options.signal.addEventListener('abort', requestExternalAbort, { once: true })
      removeExternalAbort = () => options.signal?.removeEventListener('abort', requestExternalAbort)
    }
  }
  let stopPoll: (() => void) | undefined
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let removeAbortListener: (() => void) | undefined
  try {
    const prepared = await prepareExecution(contract, approved.approval.issuedAt, active, actionsDir, dataDir, now)
    if (prepared.kind === 'terminal') return prepared.record
    stopPoll = startCancellationPoll(active, actionsDir, now)
    timeoutHandle = setTimeout(() => {
      if (!active.finalized) {
        active.operationTimedOut = true
        active.controller.abort()
      }
    }, contract.timeout.operationMs)
    timeoutHandle.unref?.()
    const abortPromise = new Promise<FinalOutcome>(resolve => {
      const onAbort = (): void => resolve({ kind: 'abort', category: abortCategory(active) })
      active.controller.signal.addEventListener('abort', onAbort, { once: true })
      removeAbortListener = () => active.controller.signal.removeEventListener('abort', onAbort)
      if (active.controller.signal.aborted) onAbort()
    })
    if (active.controller.signal.aborted) return finalizeOperation(active, contract, actionsDir, dataDir, now, { kind: 'abort', category: abortCategory(active) })
    const runBench = options.runBench ?? runBenchTaskPackV1
    const runPromise: Promise<FinalOutcome> = Promise.resolve().then(() => runBench({
      model: contract.arguments.model,
      packId: contract.target.pack.selector,
      runId: actionId,
      fetchImpl: options.fetchImpl,
      signal: active.controller.signal,
      timeoutMs: contract.timeout.perRequestMs,
      now,
      monotonicNow: options.monotonicNow,
      onProgress: progressCallback(active, contract, actionsDir, now),
    })).then(result => ({ kind: 'result', result }) as FinalOutcome, error => ({ kind: 'error', error }) as FinalOutcome)
    const outcome = await Promise.race([runPromise, abortPromise])
    return finalizeOperation(active, contract, actionsDir, dataDir, now, outcome)
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    removeAbortListener?.()
    stopPoll?.()
    removeExternalAbort?.()
    active.finalized = true
    if (activeExecutions.get(actionId) === active) activeExecutions.delete(actionId)
  }
}
async function appendCancellationRequest(record: CoreCompatibilityActionRecordV1, actionsDir: string, now: () => Date, requestedAt: string): Promise<CoreCompatibilityActionCancellationResult> {
  if (isTerminal(record.status)) return { status: 'already-terminal', record }
  if (record.status === 'proposed' || record.status === 'ready') {
    return { status: 'cancelled', record: await appendOperationRecord(actionsDir, record.contract, 'cancelled', cancelledBeforeStart(record, now, requestedAt), now) }
  }
  if (record.status !== 'running') return { status: 'owner-unavailable', record }
  if (record.operation.cancellation.requested) return { status: 'requested' }
  await appendOperationRecord(actionsDir, record.contract, 'running', { ...record.operation, cancellation: { requested: true, requestedAt } }, now)
  return { status: 'requested' }
}

export async function cancelCoreCompatibilityAction(actionId: string, options: CoreCompatibilityActionCancellationOptions = {}): Promise<CoreCompatibilityActionCancellationResult> {
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const dataDir = options.dataDir
  const now = options.now ?? (() => new Date())
  const active = activeExecutions.get(actionId)
  if (active) {
    active.cancelled = true
    active.cancellationRequestedAt ??= nowIso(now)
    active.controller.abort()
    return withActionLock(actionsDir, async () => {
      const current = await latestCoreCompatibilityRecord(actionsDir, actionId)
      if (!current) return { status: 'requested' }
      if (isTerminal(current.status)) return { status: 'already-terminal', record: current }
      if (current.status === 'proposed' || current.status === 'ready') return appendCancellationRequest(current, actionsDir, now, active.cancellationRequestedAt!)
      if (current.status === 'running' && current.operation.ownerProcessId === process.pid && !current.operation.cancellation.requested) {
        await appendOperationRecord(actionsDir, current.contract, 'running', { ...current.operation, cancellation: { requested: true, requestedAt: active.cancellationRequestedAt! } }, now)
      }
      return { status: 'requested' }
    })
  }
  return withActionLock(actionsDir, async () => {
    const current = await latestCoreCompatibilityRecord(actionsDir, actionId)
    if (!current) return { status: 'not-found' }
    if (isTerminal(current.status)) return { status: 'already-terminal', record: current }
    if (current.status === 'proposed' || current.status === 'ready') return appendCancellationRequest(current, actionsDir, now, nowIso(now))
    if (current.status !== 'running') return { status: 'owner-unavailable', record: current }
    const evidence = await findEvidence(actionId, current.contract, dataDir)
    if (evidence) {
      const terminal = terminalFromResult(current, evidence, 'duplicate', now)
      return { status: 'already-terminal', record: await appendOperationRecord(actionsDir, current.contract, terminal.status, terminal.operation, now) }
    }
    if (processIsAlive(current.operation.ownerProcessId)) return appendCancellationRequest(current, actionsDir, now, nowIso(now))
    return { status: 'cancelled', record: await appendOperationRecord(actionsDir, current.contract, 'cancelled', cancellationState(current.operation, now, nowIso(now), 'Core Compatibility was cancelled after its owner became unavailable.'), now) }
  })
}

export async function readCoreCompatibilityAction(actionId: string, options: { actionsDir?: string; dataDir?: string; now?: () => Date } = {}): Promise<CoreCompatibilityActionRecordV1 | null> {
  const actionsDir = options.actionsDir ?? defaultActionsDir()
  const dataDir = options.dataDir
  const now = options.now ?? (() => new Date())
  return withActionLock(actionsDir, async () => {
    let record = await latestCoreCompatibilityRecord(actionsDir, actionId)
    if (!record) return null
    if (record.status === 'ready' && record.operation.approvalIssuedAt !== null && !isFreshApprovalIssuedAt(record.operation.approvalIssuedAt, now())) {
      record = await appendOperationRecord(actionsDir, record.contract, 'failed', failedOperation(record.operation, 'approval-expired', 'the persisted action approval expired and was not renewed.', now), now)
    } else if (record.status === 'running' && !processIsAlive(record.operation.ownerProcessId)) {
      record = await recoverRunningRecord(record, actionsDir, dataDir, now)
    }
    return verifyStoredEvidence(record, dataDir)
  })
}

export const executeApprovedCoreCompatibilityAction = executeApprovedCoreCompatibility
export const executeApprovedCoreCompatibilityBench = executeApprovedCoreCompatibility
export const recordCoreCompatibilityActionProposal = recordCoreCompatibilityProposal
export const cancelCoreCompatibility = cancelCoreCompatibilityAction
export const readCoreCompatibility = readCoreCompatibilityAction
