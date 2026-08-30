import { z } from 'zod'
import {
  ACTION_FAILURE_CATEGORIES,
  ACTION_KIND_RUN_CORE_COMPATIBILITY,
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
  computeActionProposalDigest, validateActionContractV1,
} from './action-contract-v1.js'
import { appendRecord, defaultActionsDir, readRecordHistoryStrict } from './journal.js'
import type { ActionRecord } from './types.js'
import { BENCH_EVALUATION_SCHEMA_VERSION, type BenchEvaluationV1 } from '../bench/task-pack-run-v1.js'

export const ACTION_RECORD_VERSION = 'metrora.action-record.v1' as const
export type CoreCompatibilityActionProposalOptions = { actionsDir?: string; now?: () => Date }
export type CoreCompatibilityActionCancellationResult =
  | { status: 'requested' }
  | { status: 'cancelled'; record: CoreCompatibilityActionRecordV1 }
  | { status: 'already-terminal'; record: CoreCompatibilityActionRecordV1 }
  | { status: 'owner-unavailable'; record: CoreCompatibilityActionRecordV1 }
  | { status: 'not-found' }
export type ActionOperationErrorCode = ActionFailureCategoryV1 | 'not-found' | 'owner-unavailable'
export class ActionOperationError extends Error {
  constructor(public readonly code: ActionOperationErrorCode, message: string) {
    super(message)
    this.name = 'ActionOperationError'
  }
}
export type CoreCompatibilityActionRecordV1 = {
  recordVersion: typeof ACTION_RECORD_VERSION
  id: string
  at: string
  kind: typeof ACTION_KIND_RUN_CORE_COMPATIBILITY
  originatingSurface: 'cli' | 'desktop'
  findingId: null
  description: string
  changes: []
  status: ActionOperationStatus
  contract: ActionContractV1
  operation: ActionOperationStateV1
}

const ActionId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)
const Digest = z.string().regex(/^[0-9a-f]{64}$/)
const IsoDate = z.string().max(64).datetime({ offset: true })
const ResultReference = z.object({ kind: z.literal(BENCH_EVALUATION_SCHEMA_VERSION), runId: ActionId, resultDigest: Digest, history: z.enum(['saved', 'duplicate']) }).strict()
const EvidenceReference = z.object({ kind: z.literal('metrora.bench-history.v1'), runId: ActionId, resultDigest: Digest, history: z.enum(['saved', 'duplicate']) }).strict()
const ResultCounts = z.object({
  planned: z.literal(CORE_CHECK_COUNT),
  attempted: z.number().int().min(0).max(CORE_CHECK_COUNT),
  passed: z.number().int().min(0).max(CORE_CHECK_COUNT),
  failed: z.number().int().min(0).max(CORE_CHECK_COUNT),
  unavailable: z.number().int().min(0).max(CORE_CHECK_COUNT),
  timedOut: z.number().int().min(0).max(CORE_CHECK_COUNT),
  cancelled: z.number().int().min(0).max(CORE_CHECK_COUNT),
}).strict()
const OperationFailure = z.object({ category: z.enum(ACTION_FAILURE_CATEGORIES), message: z.string().min(1).max(240) }).strict()
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
  approvalIssuedAt: IsoDate.nullable(),
  result: ResultReference.nullable(),
  resultCounts: ResultCounts.nullable(),
  evidenceReferences: z.array(EvidenceReference).max(1),
  failure: OperationFailure.nullable(),
  rollback: z.object({ capability: z.literal('none'), reason: z.literal(ACTION_NO_ROLLBACK_REASON) }).strict(),
}).strict()
const CoreRecordShape = z.object({
  recordVersion: z.literal(ACTION_RECORD_VERSION),
  id: ActionId,
  at: IsoDate,
  kind: z.literal(ACTION_KIND_RUN_CORE_COMPATIBILITY),
  originatingSurface: z.enum(['cli', 'desktop']),
  findingId: z.null(),
  description: z.string().min(1).max(240),
  changes: z.tuple([]),
  status: z.enum(ACTION_OPERATION_STATUSES),
  contract: z.unknown(),
  operation: OperationStateShape,
}).strict()

export function boundedMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  return (raw.replace(/[\r\n]+/g, ' ').slice(0, 240) || fallback)
}
export function nowIso(now: () => Date): string { return now().toISOString() }
export function proposalContract(contract: ActionContractV1): ActionContractV1 {
  return validateActionContractV1({ ...contract, approval: { ...contract.approval, confirmationDigest: null, executionDigest: null } })
}
export function assertFreshActionContract(contract: ActionContractV1, allowConfirmation: boolean): void {
  const approved = contract.approval.confirmationDigest !== null && contract.approval.executionDigest !== null
  if (allowConfirmation && !approved) throw new ActionOperationError('approval-invalid', 'execution requires a trusted confirmation')
  if (!allowConfirmation && approved) throw new ActionOperationError('validation', 'a proposal must not contain a confirmation')
  if (contract.resultIdentity.runId !== null || contract.resultIdentity.resultDigest !== null || contract.evidenceReferences.runId !== null || contract.evidenceReferences.resultDigest !== null || contract.failureCategory !== null) throw new ActionOperationError('validation', 'action contracts must not carry mutable outcome data')
}
export function initialOperationState(contract: ActionContractV1): ActionOperationStateV1 {
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
    timeout: { perRequestMs: contract.timeout.perRequestMs, operationMs: contract.timeout.operationMs, triggered: false },
    approvalIssuedAt: null,
    result: null,
    resultCounts: null,
    evidenceReferences: [],
    failure: null,
    rollback: { capability: 'none', reason: ACTION_NO_ROLLBACK_REASON },
  }
}
export function makeRecord(contract: ActionContractV1, status: ActionOperationStatus, operation: ActionOperationStateV1, now: () => Date): CoreCompatibilityActionRecordV1 {
  return { recordVersion: ACTION_RECORD_VERSION, id: contract.actionId, at: nowIso(now), kind: ACTION_KIND_RUN_CORE_COMPATIBILITY, originatingSurface: contract.originatingSurface, findingId: null, description: 'Run Core Compatibility on ' + contract.target.model, changes: [], status, contract, operation }
}
function isLegacyRecord(value: unknown): value is ActionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const rec = value as { id?: unknown; kind?: unknown; status?: unknown; at?: unknown }
  return typeof rec.id === 'string' && typeof rec.kind === 'string' && typeof rec.status === 'string' && typeof rec.at === 'string'
}
function assertOperationCoherent(status: ActionOperationStatus, operation: ActionOperationStateV1, actionId: string, contract: ActionContractV1): void {
  if (operation.actionId !== actionId || operation.checksCompleted !== operation.progress.completed || operation.progress.completed > operation.progress.planned || operation.cancellation.requested !== (operation.cancellation.requestedAt !== null)) throw new ActionOperationError('journal', 'the action operation state is inconsistent')
  if (operation.result === null) {
    if (operation.resultCounts !== null || operation.evidenceReferences.length !== 0) throw new ActionOperationError('journal', 'the action result references are inconsistent')
  } else {
    const evidence = operation.evidenceReferences[0]
    if (operation.result.runId !== actionId || !evidence || evidence.runId !== actionId || evidence.resultDigest !== operation.result.resultDigest || evidence.history !== operation.result.history || operation.resultCounts === null || operation.progress.completed !== operation.resultCounts.attempted) throw new ActionOperationError('identity-mismatch', 'the action result and evidence identity is inconsistent')
  }
  const approved = contract.approval.confirmationDigest !== null && contract.approval.executionDigest !== null
  switch (status) {
    case 'proposed':
      if (approved || operation.approvalIssuedAt !== null || operation.ownerProcessId !== null || operation.startedAt !== null || operation.completedAt !== null || operation.progress.completed !== 0 || operation.failure !== null || operation.result !== null || operation.cancellation.requested) throw new ActionOperationError('journal', 'a proposed action has inconsistent state')
      return
    case 'ready':
      if (!approved || operation.approvalIssuedAt === null || operation.ownerProcessId !== null || operation.startedAt !== null || operation.completedAt !== null || operation.progress.completed !== 0 || operation.failure !== null || operation.result !== null || operation.cancellation.requested) throw new ActionOperationError('journal', 'a ready action has inconsistent state')
      return
    case 'running':
      if (!approved || operation.approvalIssuedAt === null || operation.ownerProcessId === null || operation.startedAt === null || operation.completedAt !== null || operation.result !== null || operation.failure !== null) throw new ActionOperationError('journal', 'a running action has inconsistent state')
      return
    case 'completed':
      if (!approved || operation.ownerProcessId !== null || operation.startedAt === null || operation.completedAt === null || operation.result === null || operation.failure !== null) throw new ActionOperationError('journal', 'a completed action has inconsistent state')
      return
    case 'unavailable':
      if (!approved || operation.ownerProcessId !== null || operation.startedAt === null || operation.completedAt === null || operation.result === null || operation.failure?.category !== 'unavailable') throw new ActionOperationError('journal', 'an unavailable action has inconsistent state')
      return
    case 'cancelled':
      if (operation.ownerProcessId !== null || operation.completedAt === null || operation.result !== null || operation.failure?.category !== 'cancelled' || !operation.cancellation.requested || (operation.startedAt === null && operation.progress.completed !== 0)) throw new ActionOperationError('journal', 'a cancelled action has inconsistent state')
      return
    case 'failed':
      if (operation.ownerProcessId !== null || operation.completedAt === null || operation.failure === null || operation.failure.category === 'cancelled' || operation.failure.category === 'unavailable' || (operation.startedAt === null && operation.failure.category !== 'approval-expired')) throw new ActionOperationError('journal', 'a failed action has inconsistent state')
      return
  }
}
export function parseCoreCompatibilityRecord(input: unknown): CoreCompatibilityActionRecordV1 {
  const parsed = CoreRecordShape.safeParse(input)
  if (!parsed.success) throw new ActionOperationError('journal', 'the ACT journal contains an invalid Core Compatibility record')
  let contract: ActionContractV1
  try { contract = validateActionContractV1(parsed.data.contract) } catch {
    throw new ActionOperationError('journal', 'the ACT journal contains an invalid action contract')
  }
  if (parsed.data.id !== contract.actionId || parsed.data.operation.actionId !== parsed.data.id) throw new ActionOperationError('identity-mismatch', 'the ACT record identity does not match its contract')
  if (parsed.data.status === 'proposed' && (contract.approval.confirmationDigest !== null || contract.approval.executionDigest !== null)) throw new ActionOperationError('journal', 'a proposed action must not contain approval')
  if (contract.resultIdentity.runId !== null || contract.resultIdentity.resultDigest !== null || contract.evidenceReferences.runId !== null || contract.evidenceReferences.resultDigest !== null || contract.failureCategory !== null) throw new ActionOperationError('journal', 'the ACT contract contains mutable outcome data')
  const operation = parsed.data.operation as ActionOperationStateV1
  assertOperationCoherent(parsed.data.status, operation, parsed.data.id, contract)
  return { ...parsed.data, contract, operation }
}

const NEXT_STATUSES: Readonly<Record<ActionOperationStatus, readonly ActionOperationStatus[]>> = {
  proposed: ['proposed', 'ready', 'cancelled'],
  ready: ['ready', 'running', 'cancelled', 'failed'],
  running: ['running', 'completed', 'failed', 'cancelled', 'unavailable'],
  completed: [],
  failed: [],
  cancelled: [],
  unavailable: [],
}
function assertTransition(previous: ActionOperationStatus | undefined, current: CoreCompatibilityActionRecordV1): void {
  if (previous === undefined && current.status !== 'proposed') throw new ActionOperationError('journal', 'a controlled action must begin in proposed state')
  if (previous !== undefined && !NEXT_STATUSES[previous].includes(current.status)) throw new ActionOperationError('journal', 'the ACT journal contains an invalid lifecycle transition')
}

function strictLegacyRecord(value: unknown): boolean {
  if (!isLegacyRecord(value)) return false
  const rec = value as ActionRecord
  return ['applied', 'undone'].includes(rec.status) && typeof rec.description === 'string' && Array.isArray(rec.changes)
}

export async function readCoreCompatibilityRecords(actionsDir = defaultActionsDir()): Promise<CoreCompatibilityActionRecordV1[]> {
  let history: unknown[]
  try { history = await readRecordHistoryStrict(actionsDir) } catch (error) {
    throw new ActionOperationError('journal', boundedMessage(error, 'the ACT journal contains corrupt or malformed JSON'))
  }
  const groups = new Map<string, unknown[]>()
  for (const raw of history) {
    if (!isLegacyRecord(raw) && !(raw && typeof raw === 'object' && (raw as { recordVersion?: unknown }).recordVersion === ACTION_RECORD_VERSION)) throw new ActionOperationError('journal', 'the ACT journal contains an unknown record shape')
    if (!strictLegacyRecord(raw) && !((raw as { recordVersion?: unknown }).recordVersion === ACTION_RECORD_VERSION)) throw new ActionOperationError('journal', 'the ACT journal contains an invalid legacy record')
    const id = (raw as { id: string }).id
    groups.set(id, [...(groups.get(id) ?? []), raw])
  }
  const result: CoreCompatibilityActionRecordV1[] = []
  for (const entries of groups.values()) {
    const controlled = entries.filter(item => (item as { recordVersion?: unknown }).recordVersion === ACTION_RECORD_VERSION)
    if (controlled.length === 0) continue
    if (controlled.length !== entries.length) throw new ActionOperationError('duplicate', 'an action id is used by multiple ACT record kinds')
    let previous: ActionOperationStatus | undefined
    let latest: CoreCompatibilityActionRecordV1 | undefined
    let proposalDigest: string | undefined
    for (const entry of controlled) {
      const record = parseCoreCompatibilityRecord(entry)
      const digest = computeActionProposalDigest(record.contract)
      if (proposalDigest === undefined) proposalDigest = digest
      else if (proposalDigest !== digest) throw new ActionOperationError('identity-mismatch', 'the ACT lifecycle changed the exact action contract')
      assertTransition(previous, record)
      previous = record.status
      latest = record
    }
    if (latest) result.push(latest)
  }
  return result
}

export async function latestCoreCompatibilityRecord(actionsDir: string, actionId: string): Promise<CoreCompatibilityActionRecordV1 | null> {
  const record = (await readCoreCompatibilityRecords(actionsDir)).find(item => item.id === actionId)
  if (record) return record
  let history: unknown[]
  try { history = await readRecordHistoryStrict(actionsDir) } catch (error) { throw new ActionOperationError('journal', boundedMessage(error, 'the ACT journal contains corrupt or malformed JSON')) }
  if (history.some(item => item && typeof item === 'object' && (item as { id?: unknown }).id === actionId)) throw new ActionOperationError('duplicate', 'the action id is already used by another ACT record')
  return null
}

export async function appendOperationRecord(actionsDir: string, contract: ActionContractV1, status: ActionOperationStatus, operation: ActionOperationStateV1, now: () => Date): Promise<CoreCompatibilityActionRecordV1> {
  const record = makeRecord(contract, status, operation, now)
  parseCoreCompatibilityRecord(record)
  const existing = (await readCoreCompatibilityRecords(actionsDir)).find(item => item.id === record.id)
  if (existing && computeActionProposalDigest(existing.contract) !== computeActionProposalDigest(record.contract)) {
    throw new ActionOperationError('identity-mismatch', 'the ACT lifecycle changed the exact action contract')
  }
  assertTransition(existing?.status, record)
  await appendRecord(actionsDir, record)
  return record
}
export function processIsAlive(processId: number | null): boolean {
  if (processId === null || processId <= 0) return false
  try { process.kill(processId, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}
export function resultCounts(result: BenchEvaluationV1): ActionResultCountsV1 {
  return {
    planned: result.aggregate.planned,
    attempted: result.aggregate.attempted,
    passed: result.aggregate.passed,
    failed: result.aggregate.failed,
    unavailable: result.tasks.filter(task => task.status === 'unavailable').length,
    timedOut: result.tasks.filter(task => task.status === 'timeout').length,
    cancelled: result.aggregate.cancelled,
  }
}
export function failureFromBench(result: BenchEvaluationV1, fallback: string): string {
  const failure = result.tasks.find(task => task.failure !== null)?.failure
  return boundedMessage(failure?.message, fallback)
}
export function resultReference(result: BenchEvaluationV1, history: 'saved' | 'duplicate'): ActionResultReferenceV1 {
  return { kind: BENCH_EVALUATION_SCHEMA_VERSION, runId: result.runId, resultDigest: result.resultDigest, history }
}
export function evidenceReference(result: BenchEvaluationV1, history: 'saved' | 'duplicate'): ActionEvidenceReferenceV1 {
  return { kind: 'metrora.bench-history.v1', runId: result.runId, resultDigest: result.resultDigest, history }
}
export function sameActionContract(left: ActionContractV1, right: ActionContractV1): boolean {
  return computeActionProposalDigest(left) === computeActionProposalDigest(right)
}
export function clearOutcome(operation: ActionOperationStateV1): ActionOperationStateV1 {
  return { ...operation, result: null, resultCounts: null, evidenceReferences: [], failure: null }
}
export function isTerminal(status: ActionOperationStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'unavailable'
}
export function countsEqual(left: ActionResultCountsV1, right: ActionResultCountsV1): boolean {
  return left.planned === right.planned && left.attempted === right.attempted && left.passed === right.passed && left.failed === right.failed && left.unavailable === right.unavailable && left.timedOut === right.timedOut && left.cancelled === right.cancelled
}
