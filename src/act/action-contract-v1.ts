import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import {
  DEFAULT_OLLAMA_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  MAX_RESPONSE_BYTES,
  MAX_STREAM_CHUNKS,
  MAX_STREAM_EVENTS,
  OLLAMA_LOCAL_BASE_URL,
  validateOllamaModelId,
} from '../bench/ollama-local.js'
import { FIXED_GENERATION_PARAMETERS } from '../bench/contract-v1.js'
import { CORE_TASK_PACK_ID, CORE_TASK_PACK_VERSION, CORE_TASK_PACK_V1 } from '../bench/task-pack-v1.js'
import { validateBenchTimeoutMs } from '../bench/run-v1.js'
import { canonicalJson, sha256Json } from '../bench/serialization.js'

export const ACTION_CONTRACT_VERSION = 'metrora.action.v1' as const
export const ACTION_SCHEMA_VERSION = 1 as const
export const ACTION_KIND_RUN_CORE_COMPATIBILITY = 'run-core-compatibility' as const
export const ACTION_KIND_RUN_CORE_COMPATIBILITY_BENCH = ACTION_KIND_RUN_CORE_COMPATIBILITY
export const ACTION_OPERATION_VERSION = 'metrora.action-operation.v1' as const
export const ACTION_APPROVAL_TOKEN_VERSION = 'metrora.action-approval.v1' as const
export const ACTION_APPROVAL_AUTHORITY = 'metrora.trusted-process.v1' as const
export const ACTION_PROPOSAL_DIGEST_DOMAIN = 'metrora.action.proposal.v1' as const
export const ACTION_CONFIRMATION_DIGEST_DOMAIN = 'metrora.action.confirmation.v1' as const
export const ACTION_EXECUTION_DIGEST_DOMAIN = 'metrora.action.execution.v1' as const
export const CORE_TASK_PACK_SELECTOR = 'core-v1' as const
export const CORE_CHECK_COUNT = 6 as const
export const ACTION_APPROVAL_MAX_AGE_MS = 5 * 60_000
export const ACTION_APPROVAL_MAX_FUTURE_SKEW_MS = 30_000
export const ACTION_NO_ROLLBACK_REASON = 'bounded local evidence/history append has no reversible external mutation' as const

export const ACTION_OPERATION_STATUSES = [
  'proposed',
  'ready',
  'running',
  'completed',
  'failed',
  'cancelled',
  'unavailable',
] as const
export type ActionOperationStatus = typeof ACTION_OPERATION_STATUSES[number]

export const ACTION_FAILURE_CATEGORIES = [
  'validation',
  'approval-invalid',
  'approval-expired',
  'duplicate',
  'replay',
  'concurrent',
  'unavailable',
  'timeout',
  'cancelled',
  'malformed-result',
  'execution',
  'journal',
  'identity-mismatch',
] as const
export type ActionFailureCategoryV1 = typeof ACTION_FAILURE_CATEGORIES[number]
export type ActionOriginatingSurfaceV1 = 'cli' | 'desktop'

const ACTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const EMPTY_DIGEST = '0'.repeat(64)

const ActionId = z.string().regex(ACTION_ID_PATTERN)
const Digest = z.string().regex(DIGEST_PATTERN)
const IsoDate = z.string().max(64).datetime({ offset: true })
const ModelId = z.string().min(1).max(200).refine(value => {
  try {
    validateOllamaModelId(value)
    return true
  } catch {
    return false
  }
}, 'invalid Ollama model id')

const ContractShape = z.object({
  contractVersion: z.literal(ACTION_CONTRACT_VERSION),
  schemaVersion: z.literal(ACTION_SCHEMA_VERSION),
  actionId: ActionId,
  kind: z.literal(ACTION_KIND_RUN_CORE_COMPATIBILITY),
  originatingSurface: z.enum(['cli', 'desktop']),
  createdAt: IsoDate,
  scope: z.object({
    locality: z.literal('local-only'),
    filesystem: z.literal('none'),
    repositoryAccess: z.literal('none'),
    network: z.literal('loopback-only'),
  }).strict(),
  target: z.object({
    runtime: z.object({
      id: z.literal('ollama-local'),
      endpoint: z.literal(OLLAMA_LOCAL_BASE_URL),
    }).strict(),
    model: ModelId,
    pack: z.object({
      selector: z.literal(CORE_TASK_PACK_SELECTOR),
      packId: z.literal(CORE_TASK_PACK_ID),
      version: z.literal(CORE_TASK_PACK_VERSION),
      digest: z.literal(CORE_TASK_PACK_V1.digest),
    }).strict(),
  }).strict(),
  arguments: z.object({
    model: ModelId,
    runId: ActionId,
    packSelector: z.literal(CORE_TASK_PACK_SELECTOR),
    promptSource: z.literal('canonical-pack-only'),
  }).strict(),
  generation: z.object({
    parameters: z.object({
      temperature: z.literal(0),
      seed: z.literal(1729),
      numPredict: z.literal(64),
    }).strict(),
    policy: z.literal('one-bounded-request-per-task'),
  }).strict(),
  methodology: z.object({
    family: z.literal('compatibility-runtime-health'),
    runner: z.literal('canonical-task-pack-v1'),
    scoring: z.literal('deterministic-task-assertions'),
    evidence: z.literal('canonical-bench-history-v1'),
  }).strict(),
  preconditions: z.object({
    explicitModel: z.literal(true),
    canonicalPack: z.literal(true),
    runtime: z.literal('ollama-local-only'),
    credentials: z.literal('none'),
    shell: z.literal('none'),
    arbitraryPrompt: z.literal('rejected'),
    arbitraryPaths: z.literal('rejected'),
    arbitraryEndpoints: z.literal('rejected'),
    arbitraryActionKinds: z.literal('rejected'),
    repositoryCodeExecution: z.literal('none'),
  }).strict(),
  declaredEffects: z.object({
    network: z.literal('loopback-only'),
    writes: z.tuple([
      z.literal('metrora.act.journal.v1'),
      z.literal('metrora.bench-history.v1'),
    ]),
    credentials: z.literal('none'),
    shell: z.literal('none'),
    repositoryCodeExecution: z.literal('none'),
    promptSource: z.literal('canonical-pack-only'),
    hiddenEffects: z.literal('none'),
  }).strict(),
  limits: z.object({
    checksPlanned: z.literal(CORE_CHECK_COUNT),
    maxConcurrentOperations: z.literal(1),
    maxResponseBytes: z.literal(MAX_RESPONSE_BYTES),
    maxOutputBytes: z.literal(MAX_OUTPUT_BYTES),
    maxStreamChunks: z.literal(MAX_STREAM_CHUNKS),
    maxStreamEvents: z.literal(MAX_STREAM_EVENTS),
  }).strict(),
  timeout: z.object({
    perRequestMs: z.number().int().min(50).max(120_000),
    operationMs: z.number().int().min(50).max(1_000_000),
  }).strict(),
  cancellation: z.object({
    policy: z.literal('abort-signal-propagates'),
    lateResults: z.literal('discard'),
    terminalStatePrecedence: z.literal('cancelled-or-timeout'),
  }).strict(),
  approval: z.object({
    required: z.literal('explicit-user-confirmation'),
    proposalDigest: Digest,
    confirmationDigest: Digest.nullable(),
    executionDigest: Digest.nullable(),
  }).strict(),
  resultIdentity: z.object({
    kind: z.literal('metrora.bench-evaluation.v1'),
    runId: ActionId.nullable(),
    resultDigest: Digest.nullable(),
  }).strict(),
  evidenceReferences: z.object({
    kind: z.literal('metrora.bench-history.v1'),
    runId: ActionId.nullable(),
    resultDigest: Digest.nullable(),
  }).strict(),
  failureCategory: z.object({
    category: z.enum(ACTION_FAILURE_CATEGORIES),
    message: z.string().min(1).max(240),
  }).strict().nullable(),
  rollback: z.object({
    capability: z.literal('none'),
    reason: z.literal(ACTION_NO_ROLLBACK_REASON),
  }).strict(),
}).strict()

export type ActionContractV1 = z.infer<typeof ContractShape>

const ApprovalTokenShape = z.object({
  tokenVersion: z.literal(ACTION_APPROVAL_TOKEN_VERSION),
  actionId: ActionId,
  proposalDigest: Digest,
  confirmationDigest: Digest,
  executionDigest: Digest,
  issuedAt: IsoDate,
  authority: z.literal(ACTION_APPROVAL_AUTHORITY),
  proof: Digest,
}).strict()
const ApprovedActionEnvelopeShape = z.object({ contract: z.unknown(), approval: z.unknown() }).strict()
export type ActionApprovalTokenV1 = z.infer<typeof ApprovalTokenShape>
export type ApprovedActionV1 = { contract: ActionContractV1; approval: ActionApprovalTokenV1 }

export type ActionResultReferenceV1 = {
  kind: 'metrora.bench-evaluation.v1'
  runId: string
  resultDigest: string
  history: 'saved' | 'duplicate'
}
export type ActionResultCountsV1 = {
  planned: number
  attempted: number
  passed: number
  failed: number
  unavailable: number
  timedOut: number
  cancelled: number
}
export type ActionEvidenceReferenceV1 = {
  kind: 'metrora.bench-history.v1'
  runId: string
  resultDigest: string
  history: 'saved' | 'duplicate'
}
export type ActionOperationFailureV1 = {
  category: ActionFailureCategoryV1
  message: string
}
export type ActionOperationStateV1 = {
  operationVersion: typeof ACTION_OPERATION_VERSION
  actionId: string
  ownerProcessId: number | null
  startedAt: string | null
  completedAt: string | null
  progress: { planned: typeof CORE_CHECK_COUNT; completed: number }
  checksPlanned: typeof CORE_CHECK_COUNT
  checksCompleted: number
  cancellation: { requested: boolean; requestedAt: string | null }
  timeout: { perRequestMs: number; operationMs: number; triggered: boolean }
  approvalIssuedAt: string | null
  result: ActionResultReferenceV1 | null
  resultCounts: ActionResultCountsV1 | null
  evidenceReferences: ActionEvidenceReferenceV1[]
  failure: ActionOperationFailureV1 | null
  rollback: { capability: 'none'; reason: typeof ACTION_NO_ROLLBACK_REASON }
}

export class ActionContractError extends Error {
  constructor(
    public readonly code: 'invalid-contract' | 'invalid-approval' | 'stale-approval',
    message: string,
  ) {
    super(message)
    this.name = 'ActionContractError'
  }
}

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function assertJsonSafe(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ActionContractError('invalid-contract', 'action contract numbers must be finite')
    return
  }
  if (value === undefined || typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new ActionContractError('invalid-contract', 'action contract must contain JSON-safe values only')
  }
  if (typeof value !== 'object') throw new ActionContractError('invalid-contract', 'action contract contains an unsupported value')
  if (seen.has(value)) throw new ActionContractError('invalid-contract', 'action contract must not contain cycles')
  seen.add(value)
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some(key => typeof key === 'symbol')) throw new ActionContractError('invalid-contract', 'action contract must not contain symbol properties')
  if (Array.isArray(value)) {
    for (const key of ownKeys) {
      if (key === 'length') continue
      if (typeof key !== 'string' || !/^\d+$/.test(key)) throw new ActionContractError('invalid-contract', 'action contract arrays must not contain named properties')
      const index = Number(key)
      if (!Number.isSafeInteger(index) || index < 0 || index >= 2 ** 32 - 1 || String(index) !== key) throw new ActionContractError('invalid-contract', 'action contract arrays must contain only dense indexes')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) throw new ActionContractError('invalid-contract', 'action contract must not contain accessor properties')
      assertJsonSafe(descriptor.value, seen)
    }
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new ActionContractError('invalid-contract', 'action contract must contain plain JSON objects only')
    for (const key of ownKeys) {
      if (typeof key !== 'string' || FORBIDDEN_JSON_KEYS.has(key)) throw new ActionContractError('invalid-contract', 'action contract contains a forbidden object key')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) throw new ActionContractError('invalid-contract', 'action contract must not contain accessor properties')
      assertJsonSafe(descriptor.value, seen)
    }
  }
  seen.delete(value)
}

function invalidContract(): ActionContractError {
  return new ActionContractError('invalid-contract', 'action contract failed strict validation')
}
function parseContractShape(input: unknown): ActionContractV1 {
  try { assertJsonSafe(input) } catch (error) { if (error instanceof ActionContractError) throw error; throw invalidContract() }
  const parsed = ContractShape.safeParse(input)
  if (!parsed.success) throw invalidContract()
  const contract = parsed.data
  if (contract.target.model !== contract.arguments.model || contract.arguments.runId !== contract.actionId) throw invalidContract()
  if (contract.timeout.operationMs !== (contract.limits.checksPlanned + 1) * contract.timeout.perRequestMs) throw invalidContract()
  if ((contract.resultIdentity.runId === null) !== (contract.resultIdentity.resultDigest === null)) throw invalidContract()
  if ((contract.evidenceReferences.runId === null) !== (contract.evidenceReferences.resultDigest === null)) throw invalidContract()
  const hasConfirmation = contract.approval.confirmationDigest !== null
  if (!hasConfirmation && contract.approval.executionDigest !== null) throw invalidContract()
  if (hasConfirmation && contract.approval.confirmationDigest !== computeActionConfirmationDigest(contract.approval.proposalDigest)) throw invalidContract()
  if (hasConfirmation && contract.approval.executionDigest !== computeActionExecutionDigest(contract, contract.approval.confirmationDigest!)) throw invalidContract()
  return contract
}

function proposalPayload(contract: ActionContractV1): Record<string, unknown> {
  return {
    domain: ACTION_PROPOSAL_DIGEST_DOMAIN,
    contractVersion: contract.contractVersion,
    schemaVersion: contract.schemaVersion,
    actionId: contract.actionId,
    kind: contract.kind,
    originatingSurface: contract.originatingSurface,
    createdAt: contract.createdAt,
    scope: contract.scope,
    target: contract.target,
    arguments: contract.arguments,
    generation: contract.generation,
    methodology: contract.methodology,
    preconditions: contract.preconditions,
    declaredEffects: contract.declaredEffects,
    limits: contract.limits,
    timeout: contract.timeout,
    cancellation: contract.cancellation,
    approvalRequirement: contract.approval.required,
    rollback: contract.rollback,
  }
}

export function computeActionProposalDigest(input: ActionContractV1): string {
  return sha256Json(proposalPayload(parseContractShape(input)))
}
export function computeActionConfirmationDigest(proposalDigest: string): string {
  if (!DIGEST_PATTERN.test(proposalDigest)) throw new ActionContractError('invalid-contract', 'proposal digest must be a lowercase SHA-256 digest')
  return sha256Json({ domain: ACTION_CONFIRMATION_DIGEST_DOMAIN, contractVersion: ACTION_CONTRACT_VERSION, schemaVersion: ACTION_SCHEMA_VERSION, proposalDigest, confirmation: 'explicit-user-confirmation' })
}
export function computeActionExecutionDigest(contractInput: ActionContractV1, confirmationDigest: string): string {
  const contract = parseContractShape({ ...contractInput, approval: { ...contractInput.approval, confirmationDigest: null, executionDigest: null } })
  if (!DIGEST_PATTERN.test(confirmationDigest)) throw new ActionContractError('invalid-contract', 'confirmation digest must be a lowercase SHA-256 digest')
  return sha256Json({ domain: ACTION_EXECUTION_DIGEST_DOMAIN, proposalDigest: computeActionProposalDigest(contract), confirmationDigest, actionId: contract.actionId, kind: contract.kind, target: contract.target, arguments: contract.arguments, generation: contract.generation, timeout: contract.timeout, cancellation: contract.cancellation })
}
export function validateActionContractV1(input: unknown): ActionContractV1 {
  const contract = parseContractShape(input)
  if (contract.approval.proposalDigest !== sha256Json(proposalPayload(contract))) throw invalidContract()
  return contract
}

export function parseActionApprovalTokenV1(input: unknown): ActionApprovalTokenV1 {
  try { assertJsonSafe(input) } catch { throw new ActionContractError('invalid-approval', 'approval token must contain JSON-safe values only') }
  const parsed = ApprovalTokenShape.safeParse(input)
  if (!parsed.success) throw new ActionContractError('invalid-approval', 'approval token failed strict validation')
  return parsed.data
}

export type CreateCoreCompatibilityActionInput = {
  model: string
  originatingSurface: ActionOriginatingSurfaceV1
  actionId?: string
  createdAt?: string
  timeoutMs?: number
}

export function createCoreCompatibilityAction(input: CreateCoreCompatibilityActionInput): ActionContractV1 {
  const model = validateOllamaModelId(input.model)
  const actionId = input.actionId ?? randomUUID()
  if (!ACTION_ID_PATTERN.test(actionId)) throw new ActionContractError('invalid-contract', 'action id must be bounded and contain no path separators')
  const createdAt = input.createdAt ?? new Date().toISOString()
  const perRequestMs = validateBenchTimeoutMs(input.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS)
  const draft = {
    contractVersion: ACTION_CONTRACT_VERSION,
    schemaVersion: ACTION_SCHEMA_VERSION,
    actionId,
    kind: ACTION_KIND_RUN_CORE_COMPATIBILITY,
    originatingSurface: input.originatingSurface,
    createdAt,
    scope: { locality: 'local-only' as const, filesystem: 'none' as const, repositoryAccess: 'none' as const, network: 'loopback-only' as const },
    target: { runtime: { id: 'ollama-local' as const, endpoint: OLLAMA_LOCAL_BASE_URL }, model, pack: { selector: CORE_TASK_PACK_SELECTOR, packId: CORE_TASK_PACK_ID, version: CORE_TASK_PACK_VERSION, digest: CORE_TASK_PACK_V1.digest } },
    arguments: { model, runId: actionId, packSelector: CORE_TASK_PACK_SELECTOR, promptSource: 'canonical-pack-only' as const },
    generation: { parameters: { ...FIXED_GENERATION_PARAMETERS }, policy: 'one-bounded-request-per-task' as const },
    methodology: { family: 'compatibility-runtime-health' as const, runner: 'canonical-task-pack-v1' as const, scoring: 'deterministic-task-assertions' as const, evidence: 'canonical-bench-history-v1' as const },
    preconditions: { explicitModel: true as const, canonicalPack: true as const, runtime: 'ollama-local-only' as const, credentials: 'none' as const, shell: 'none' as const, arbitraryPrompt: 'rejected' as const, arbitraryPaths: 'rejected' as const, arbitraryEndpoints: 'rejected' as const, arbitraryActionKinds: 'rejected' as const, repositoryCodeExecution: 'none' as const },
    declaredEffects: { network: 'loopback-only' as const, writes: ['metrora.act.journal.v1', 'metrora.bench-history.v1'] as ['metrora.act.journal.v1', 'metrora.bench-history.v1'], credentials: 'none' as const, shell: 'none' as const, repositoryCodeExecution: 'none' as const, promptSource: 'canonical-pack-only' as const, hiddenEffects: 'none' as const },
    limits: { checksPlanned: CORE_CHECK_COUNT, maxConcurrentOperations: 1 as const, maxResponseBytes: MAX_RESPONSE_BYTES, maxOutputBytes: MAX_OUTPUT_BYTES, maxStreamChunks: MAX_STREAM_CHUNKS, maxStreamEvents: MAX_STREAM_EVENTS },
    timeout: { perRequestMs, operationMs: (CORE_CHECK_COUNT + 1) * perRequestMs },
    cancellation: { policy: 'abort-signal-propagates' as const, lateResults: 'discard' as const, terminalStatePrecedence: 'cancelled-or-timeout' as const },
    approval: { required: 'explicit-user-confirmation' as const, proposalDigest: EMPTY_DIGEST, confirmationDigest: null, executionDigest: null },
    resultIdentity: { kind: 'metrora.bench-evaluation.v1' as const, runId: null, resultDigest: null },
    evidenceReferences: { kind: 'metrora.bench-history.v1' as const, runId: null, resultDigest: null },
    failureCategory: null,
    rollback: { capability: 'none' as const, reason: ACTION_NO_ROLLBACK_REASON },
  }
  return validateActionContractV1({ ...draft, approval: { ...draft.approval, proposalDigest: computeActionProposalDigest(draft as ActionContractV1) } })
}

function signingPayload(token: Omit<ActionApprovalTokenV1, 'proof'>): string { return canonicalJson(token) }

export type TrustedActionAuthorityOptions = {
  secret?: Uint8Array
  now?: () => Date
  maxAgeMs?: number
  futureSkewMs?: number
}

export class TrustedActionAuthorityV1 {
  private readonly secret: Buffer
  private readonly now: () => Date
  private readonly maxAgeMs: number
  private readonly futureSkewMs: number

  constructor(secretOrOptions?: Uint8Array | TrustedActionAuthorityOptions) {
    const options = secretOrOptions instanceof Uint8Array ? { secret: secretOrOptions } : (secretOrOptions ?? {})
    if (options.secret !== undefined && options.secret.byteLength < 32) throw new Error('trusted action authority secret must be at least 32 bytes')
    this.secret = Buffer.from(options.secret ?? randomBytes(32))
    this.now = options.now ?? (() => new Date())
    this.maxAgeMs = options.maxAgeMs ?? ACTION_APPROVAL_MAX_AGE_MS
    this.futureSkewMs = options.futureSkewMs ?? ACTION_APPROVAL_MAX_FUTURE_SKEW_MS
    if (!Number.isInteger(this.maxAgeMs) || this.maxAgeMs <= 0 || !Number.isInteger(this.futureSkewMs) || this.futureSkewMs < 0) throw new Error('trusted action authority freshness bounds must be positive integers')
  }

  issueApprovalAfterTrustedUserConfirmation(contractInput: ActionContractV1): ApprovedActionV1 {
    const contract = validateActionContractV1(contractInput)
    if (contract.approval.confirmationDigest !== null || contract.approval.executionDigest !== null) throw new ActionContractError('invalid-approval', 'action already contains an approval')
    const proposalDigest = computeActionProposalDigest(contract)
    const confirmationDigest = computeActionConfirmationDigest(proposalDigest)
    const executionDigest = computeActionExecutionDigest(contract, confirmationDigest)
    const unsigned = { tokenVersion: ACTION_APPROVAL_TOKEN_VERSION, actionId: contract.actionId, proposalDigest, confirmationDigest, executionDigest, issuedAt: this.now().toISOString(), authority: ACTION_APPROVAL_AUTHORITY } satisfies Omit<ActionApprovalTokenV1, 'proof'>
    const proof = createHmac('sha256', this.secret).update(signingPayload(unsigned), 'utf8').digest('hex')
    const approval = parseActionApprovalTokenV1({ ...unsigned, proof })
    const approvedContract = validateActionContractV1({ ...contract, approval: { ...contract.approval, confirmationDigest, executionDigest } })
    return { contract: approvedContract, approval }
  }

  verifyApprovedAction(input: unknown): ApprovedActionV1 {
    let envelope: { contract: unknown; approval: unknown }
    try {
      assertJsonSafe(input)
      const parsed = ApprovedActionEnvelopeShape.safeParse(input)
      if (!parsed.success) throw new Error('invalid envelope')
      envelope = parsed.data as { contract: unknown; approval: unknown }
    } catch { throw new ActionContractError('invalid-approval', 'approved action envelope failed strict validation') }
    let contract: ActionContractV1
    let approval: ActionApprovalTokenV1
    try { contract = validateActionContractV1(envelope.contract); approval = parseActionApprovalTokenV1(envelope.approval) } catch (error) {
      if (error instanceof ActionContractError) throw new ActionContractError('invalid-approval', error.message)
      throw new ActionContractError('invalid-approval', 'approved action envelope failed strict validation')
    }
    const issuedAtMs = Date.parse(approval.issuedAt)
    const nowMs = this.now().getTime()
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(nowMs) || issuedAtMs > nowMs + this.futureSkewMs) throw new ActionContractError('invalid-approval', 'approval is not yet valid')
    if (nowMs - issuedAtMs > this.maxAgeMs) throw new ActionContractError('stale-approval', 'approval is expired')
    const expectedProposalDigest = computeActionProposalDigest(contract)
    const expectedConfirmationDigest = computeActionConfirmationDigest(expectedProposalDigest)
    const expectedExecutionDigest = computeActionExecutionDigest(contract, expectedConfirmationDigest)
    if (approval.actionId !== contract.actionId || approval.proposalDigest !== expectedProposalDigest || approval.confirmationDigest !== expectedConfirmationDigest || approval.executionDigest !== expectedExecutionDigest || contract.approval.confirmationDigest !== expectedConfirmationDigest || contract.approval.executionDigest !== expectedExecutionDigest) throw new ActionContractError('invalid-approval', 'approval is not bound to this exact action proposal')
    const expectedProof = createHmac('sha256', this.secret).update(signingPayload({ tokenVersion: approval.tokenVersion, actionId: approval.actionId, proposalDigest: approval.proposalDigest, confirmationDigest: approval.confirmationDigest, executionDigest: approval.executionDigest, issuedAt: approval.issuedAt, authority: approval.authority }), 'utf8').digest('hex')
    const expectedBytes = Buffer.from(expectedProof, 'hex')
    const actualBytes = Buffer.from(approval.proof, 'hex')
    if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) throw new ActionContractError('invalid-approval', 'approval proof was not issued by the trusted process')
    return { contract, approval }
  }

  isFreshIssuedAt(issuedAt: string): boolean {
    const issuedAtMs = Date.parse(issuedAt)
    const nowMs = this.now().getTime()
    return Number.isFinite(issuedAtMs) && Number.isFinite(nowMs) && issuedAtMs <= nowMs + this.futureSkewMs && nowMs - issuedAtMs <= this.maxAgeMs
  }
}

export function isFreshApprovalIssuedAt(issuedAt: string, now = new Date(), maxAgeMs = ACTION_APPROVAL_MAX_AGE_MS, futureSkewMs = ACTION_APPROVAL_MAX_FUTURE_SKEW_MS): boolean {
  const issuedAtMs = Date.parse(issuedAt)
  const nowMs = now.getTime()
  return Number.isFinite(issuedAtMs) && Number.isFinite(nowMs) && issuedAtMs <= nowMs + futureSkewMs && nowMs - issuedAtMs <= maxAgeMs
}

export function coreCompatibilityPackIdentity(): { selector: typeof CORE_TASK_PACK_SELECTOR; packId: typeof CORE_TASK_PACK_ID; version: typeof CORE_TASK_PACK_VERSION; checks: typeof CORE_CHECK_COUNT; digest: string } {
  return { selector: CORE_TASK_PACK_SELECTOR, packId: CORE_TASK_PACK_ID, version: CORE_TASK_PACK_VERSION, checks: CORE_CHECK_COUNT, digest: CORE_TASK_PACK_V1.digest }
}
