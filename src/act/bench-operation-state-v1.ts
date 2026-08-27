import { z } from 'zod'
import {
  ACTION_FAILURE_CATEGORIES,
  ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
  ACTION_NO_ROLLBACK_REASON,
  ACTION_OPERATION_STATUSES,
  ACTION_OPERATION_VERSION,
  CORE_CHECK_COUNT,
  type ActionContractV1,
  type ActionEvidenceReferenceV1,
  type ActionFailureCategoryV1,
  type ActionOperationStateV1,
  type ActionOperationStatus,
  type ActionResultCountsV1,
  type ActionResultReferenceV1,
  validateActionContractV1,
} from './action-contract-v1.js'
import { appendRecord, defaultActionsDir, readRecordHistoryStrict } from './journal.js'
import type { ActionRecord } from './types.js'
import { BENCH_EVALUATION_SCHEMA_VERSION, type BenchEvaluationV1 } from '../bench/task-pack-run-v1.js'

export const ACTION_RECORD_VERSION = 'metrora.action-record.v1' as const
export type BenchActionProposalOptions = { actionsDir?: string; now?: () => Date }
export type BenchActionCancellationOptions = { actionsDir?: string; dataDir?: string; now?: () => Date }
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
  constructor(public readonly code: ActionOperationErrorCode, message: string) {
    super(message)
    this.name = 'ActionOperationError'
  }
}

const ActionId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)
const Digest = z.string().regex(/^[0-9a-f]{64}$/)
const IsoDate = z.string().max(64).datetime({ offset: true })
const ResultReference = z.object({ kind: z.literal(BENCH_EVALUATION_SCHEMA_VERSION), runId: ActionId, resultDigest: Digest, history: z.enum(['saved', 'duplicate']) }).strict()
const EvidenceReference = z.object({ kind: z.literal('metrora.bench-history.v1'), runId: ActionId, resultDigest: Digest, history: z.enum(['saved', 'duplicate']) }).strict()
const ResultCounts = z.object({ planned: z.literal(CORE_CHECK_COUNT), attempted: z.number().int().min(0).max(CORE_CHECK_COUNT), passed: z.number().int().min(0).max(CORE_CHECK_COUNT), failed: z.number().int().min(0).max(CORE_CHECK_COUNT), unavailable: z.number().int().min(0).max(CORE_CHECK_COUNT), timedOut: z.number().int().min(0).max(CORE_CHECK_COUNT), cancelled: z.number().int().min(0).max(CORE_CHECK_COUNT) }).strict()
const OperationFailure = z.object({ category: z.enum(ACTION_FAILURE_CATEGORIES), message: z.string().min(1).max(240) }).strict()
const OperationStateShape = z.object({
  operationVersion: z.literal(ACTION_OPERATION_VERSION), actionId: ActionId, ownerProcessId: z.number().int().nonnegative().nullable(), startedAt: IsoDate.nullable(), completedAt: IsoDate.nullable(),
  progress: z.object({ planned: z.literal(CORE_CHECK_COUNT), completed: z.number().int().min(0).max(CORE_CHECK_COUNT) }).strict(), checksPlanned: z.literal(CORE_CHECK_COUNT), checksCompleted: z.number().int().min(0).max(CORE_CHECK_COUNT),
  cancellation: z.object({ requested: z.boolean(), requestedAt: IsoDate.nullable() }).strict(), timeout: z.object({ perRequestMs: z.number().int().min(50).max(120_000), operationMs: z.number().int().min(50).max(1_000_000), triggered: z.boolean() }).strict(),
  result: ResultReference.nullable(), resultCounts: ResultCounts.nullable(), evidenceReferences: z.array(EvidenceReference).max(1), failure: OperationFailure.nullable(), rollback: z.object({ capability: z.literal('none'), reason: z.literal(ACTION_NO_ROLLBACK_REASON) }).strict(),
}).strict()
const CoreRecordShape = z.object({ recordVersion: z.literal(ACTION_RECORD_VERSION), id: ActionId, at: IsoDate, kind: z.literal(ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH), findingId: z.null(), description: z.string().min(1).max(240), changes: z.tuple([]), status: z.enum(ACTION_OPERATION_STATUSES), contract: z.unknown(), operation: OperationStateShape }).strict()

export function boundedMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  return (raw.replace(/[\r\n]+/g, ' ').slice(0, 240) || fallback)
}
export function nowIso(now: () => Date): string { return now().toISOString() }
export function proposalContract(contract: ActionContractV1): ActionContractV1 {
  return validateActionContractV1({ ...contract, approval: { ...contract.approval, confirmationDigest: null } })
}
export function assertFreshActionContract(contract: ActionContractV1, allowConfirmation: boolean): void {
  if (!allowConfirmation && contract.approval.confirmationDigest !== null) throw new ActionOperationError('validation', 'a proposal must not contain a confirmation digest')
  if (allowConfirmation && contract.approval.confirmationDigest === null) throw new ActionOperationError('approval-invalid', 'execution requires a trusted confirmation digest')
  if (contract.resultIdentity.runId !== null || contract.resultIdentity.resultDigest !== null || contract.evidenceReferences.runId !== null || contract.evidenceReferences.resultDigest !== null || contract.failureCategory !== null) throw new ActionOperationError('validation', 'execution contracts must not carry a prior result or failure')
}
export function initialOperationState(contract: ActionContractV1): ActionOperationStateV1 {
  return { operationVersion: ACTION_OPERATION_VERSION, actionId: contract.actionId, ownerProcessId: null, startedAt: null, completedAt: null, progress: { planned: CORE_CHECK_COUNT, completed: 0 }, checksPlanned: CORE_CHECK_COUNT, checksCompleted: 0, cancellation: { requested: false, requestedAt: null }, timeout: { perRequestMs: contract.timeout.perRequestMs, operationMs: contract.timeout.operationMs, triggered: false }, result: null, resultCounts: null, evidenceReferences: [], failure: null, rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON } }
}
export function makeRecord(contract: ActionContractV1, status: ActionOperationStatus, operation: ActionOperationStateV1, now: () => Date): CoreBenchActionRecordV1 {
  return { recordVersion: ACTION_RECORD_VERSION, id: contract.actionId, at: nowIso(now), kind: ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH, findingId: null, description: `Run Core conformance on ${contract.target.model}`, changes: [], status, contract, operation }
}

function assertOperationCoherent(status: ActionOperationStatus, operation: ActionOperationStateV1, actionId: string): void {
  if (operation.actionId !== actionId || operation.checksCompleted !== operation.progress.completed || operation.progress.completed > operation.progress.planned || operation.cancellation.requested !== (operation.cancellation.requestedAt !== null)) throw new ActionOperationError('journal', 'the action journal operation state is inconsistent')
  if (operation.result === null) {
    if (operation.resultCounts !== null || operation.evidenceReferences.length !== 0) throw new ActionOperationError('journal', 'the action journal result references are inconsistent')
  } else {
    const evidence = operation.evidenceReferences[0]
    if (operation.result.runId !== actionId || !evidence || evidence.runId !== operation.result.runId || evidence.resultDigest !== operation.result.resultDigest || evidence.history !== operation.result.history || operation.resultCounts === null || operation.progress.completed !== operation.resultCounts.attempted) throw new ActionOperationError('identity-mismatch', 'the action journal result and evidence identity is inconsistent')
  }
  switch (status) {
    case 'proposed': case 'ready':
      if (operation.ownerProcessId !== null || operation.startedAt !== null || operation.completedAt !== null || operation.progress.completed !== 0 || operation.failure !== null || operation.result !== null || operation.cancellation.requested) throw new ActionOperationError('journal', 'a not-started action has running or terminal state')
      return
    case 'running':
      if (operation.ownerProcessId === null || operation.startedAt === null || operation.completedAt !== null || operation.result !== null || operation.failure !== null) throw new ActionOperationError('journal', 'a running action has inconsistent ownership or terminal state')
      return
    case 'completed':
      if (operation.ownerProcessId !== null || operation.startedAt === null || operation.completedAt === null || operation.result === null || operation.failure !== null) throw new ActionOperationError('journal', 'a completed action has inconsistent terminal state')
      return
    case 'unavailable':
      if (operation.ownerProcessId !== null || operation.startedAt === null || operation.completedAt === null || operation.result === null || operation.failure?.category !== 'unavailable') throw new ActionOperationError('journal', 'an unavailable action has inconsistent terminal state')
      return
    case 'cancelled':
      if (operation.ownerProcessId !== null || operation.completedAt === null || operation.result !== null || operation.failure?.category !== 'cancelled' || !operation.cancellation.requested || (operation.startedAt === null && operation.progress.completed !== 0)) throw new ActionOperationError('journal', 'a cancelled action has inconsistent terminal state')
      return
    case 'failed':
      if (operation.ownerProcessId !== null || operation.startedAt === null || operation.completedAt === null || operation.failure === null || operation.failure.category === 'cancelled' || operation.failure.category === 'unavailable') throw new ActionOperationError('journal', 'a failed action has inconsistent terminal state')
      return
  }
}

export function parseCoreRecord(input: unknown): CoreBenchActionRecordV1 {
  const parsed = CoreRecordShape.safeParse(input)
  if (!parsed.success) throw new ActionOperationError('journal', 'the action journal contains an invalid Core Bench record')
  let contract: ActionContractV1
  try { contract = validateActionContractV1(parsed.data.contract) } catch { throw new ActionOperationError('journal', 'the action journal contains an invalid action contract') }
  if (parsed.data.id !== contract.actionId) throw new ActionOperationError('identity-mismatch', 'the action journal record identity does not match its contract')
  if (parsed.data.status === 'proposed' && contract.approval.confirmationDigest !== null) throw new ActionOperationError('journal', 'a proposed action must not contain a confirmation digest')
  if (contract.resultIdentity.runId !== null || contract.resultIdentity.resultDigest !== null || contract.evidenceReferences.runId !== null || contract.evidenceReferences.resultDigest !== null || contract.failureCategory !== null) throw new ActionOperationError('journal', 'the action journal contract contains mutable outcome data')
  const operation = parsed.data.operation as ActionOperationStateV1
  assertOperationCoherent(parsed.data.status, operation, parsed.data.id)
  return { ...parsed.data, contract, operation }
}

const NEXT_STATUSES: Readonly<Record<ActionOperationStatus, readonly ActionOperationStatus[]>> = {
  proposed: ['proposed', 'ready', 'cancelled'], ready: ['ready', 'running', 'cancelled'], running: ['running', 'completed', 'failed', 'cancelled', 'unavailable'], completed: ['completed'], failed: ['failed'], cancelled: ['cancelled'], unavailable: ['unavailable'],
}
function assertTransition(previous: ActionOperationStatus | undefined, current: CoreBenchActionRecordV1): void {
  const status = current.status
  if (previous === undefined && status !== 'proposed') throw new ActionOperationError('journal', 'a Core Bench action must begin in proposed state')
  if (previous === 'proposed' && status === 'running' && !processIsAlive(current.operation.ownerProcessId)) return
  if (previous !== undefined && !NEXT_STATUSES[previous].includes(status)) throw new ActionOperationError('journal', 'the action journal contains an invalid lifecycle transition')
}
export async function readCoreRecords(actionsDir: string): Promise<CoreBenchActionRecordV1[]> {
  let history: ActionRecord[]
  try { history = await readRecordHistoryStrict(actionsDir) } catch { throw new ActionOperationError('journal', 'the action journal contains corrupt or malformed JSON') }
  const groups = new Map<string, ActionRecord[]>()
  for (const record of history) groups.set(record.id, [...(groups.get(record.id) ?? []), record])
  const result: CoreBenchActionRecordV1[] = []
  for (const entries of groups.values()) {
    const core = entries.filter(record => record.kind === ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH)
    if (core.length === 0) continue
    if (core.length !== entries.length) throw new ActionOperationError('duplicate', 'an action id is used by multiple action kinds')
    let previous: ActionOperationStatus | undefined
    let latest: CoreBenchActionRecordV1 | undefined
    for (const entry of core) {
      const parsed = parseCoreRecord(entry)
      assertTransition(previous, parsed)
      previous = parsed.status
      latest = parsed
    }
    if (latest) result.push(latest)
  }
  return result
}
export async function latestRecord(actionsDir: string, actionId: string): Promise<CoreBenchActionRecordV1 | null> {
  const record = (await readCoreRecords(actionsDir)).find(item => item.id === actionId)
  if (record) return record
  let history: ActionRecord[]
  try { history = await readRecordHistoryStrict(actionsDir) } catch { throw new ActionOperationError('journal', 'the action journal contains corrupt or malformed JSON') }
  if (history.some(item => item.id === actionId)) throw new ActionOperationError('duplicate', 'the action id is already used by another ACT record')
  return null
}
export async function appendOperationRecord(actionsDir: string, contract: ActionContractV1, status: ActionOperationStatus, operation: ActionOperationStateV1, now: () => Date): Promise<CoreBenchActionRecordV1> {
  const record = makeRecord(contract, status, operation, now)
  parseCoreRecord(record)
  await appendRecord(actionsDir, record)
  return record
}
export function processIsAlive(processId: number | null): boolean {
  if (processId === null || processId <= 0) return false
  try { process.kill(processId, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}
export function resultCounts(result: BenchEvaluationV1): ActionResultCountsV1 {
  return { planned: result.aggregate.planned, attempted: result.aggregate.attempted, passed: result.aggregate.passed, failed: result.aggregate.failed, unavailable: result.tasks.filter(task => task.status === 'unavailable').length, timedOut: result.tasks.filter(task => task.status === 'timeout').length, cancelled: result.aggregate.cancelled }
}
export function failureFromBench(result: BenchEvaluationV1, fallback: string): string { return boundedMessage(result.tasks.find(task => task.failure !== null)?.failure, fallback) }
export function resultReference(result: BenchEvaluationV1, history: 'saved' | 'duplicate'): ActionResultReferenceV1 { return { kind: BENCH_EVALUATION_SCHEMA_VERSION, runId: result.runId, resultDigest: result.resultDigest, history } }
export function evidenceReference(result: BenchEvaluationV1, history: 'saved' | 'duplicate'): ActionEvidenceReferenceV1 { return { kind: 'metrora.bench-history.v1', runId: result.runId, resultDigest: result.resultDigest, history } }
