import { afterAll, describe, expect, it } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runAction } from '../src/act/apply.js'
import { undoAction } from '../src/act/undo.js'
import { appendRecord, journalPath, readRecords } from '../src/act/journal.js'
import {
  ACTION_KIND_RUN_CORE_COMPATIBILITY,
  ACTION_NO_ROLLBACK_REASON,
  CORE_TASK_PACK_SELECTOR,
  TrustedActionAuthorityV1,
  createCoreCompatibilityAction,
  validateActionContractV1,
  type ActionContractV1,
  type ApprovedActionV1,
} from '../src/act/action-contract-v1.js'
import {
  cancelCoreCompatibilityAction,
  executeApprovedCoreCompatibility,
  readCoreCompatibilityAction,
  recordCoreCompatibilityProposal,
} from '../src/act/core-compatibility-operation-v1.js'
import {
  appendOperationRecord,
  initialOperationState,
} from '../src/act/core-compatibility-state-v1.js'
import { scanBenchHistoryV1, saveBenchEvaluationV1 } from '../src/bench/history-v1.js'
import { OLLAMA_GENERATE_URL, OLLAMA_VERSION_URL, type BenchFetch } from '../src/bench/ollama-local.js'
import { runBenchTaskPackV1, type BenchEvaluationV1, type BenchTaskPackRunOptions } from '../src/bench/task-pack-run-v1.js'
import type { ActionPlan, ActionRecord } from '../src/act/types.js'

const roots: string[] = []
const NL = String.fromCharCode(10)
const BASE_TIME = Date.parse('2026-08-30T12:00:00.000Z')
// Success fixtures must leave room for bounded journal/progress I/O when the
// complete Vitest suite is scheduler-throttled. The dedicated timeout tests
// continue to exercise the canonical 50 ms minimum.
const SUCCESS_TIMEOUT_MS = 1_000

type Clock = { now: () => Date; advance: (milliseconds: number) => void }
function clock(start = BASE_TIME): Clock {
  let current = start
  return { now: () => new Date(current), advance: milliseconds => { current += milliseconds } }
}
async function dirs(): Promise<{ actionsDir: string; dataDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-act-foundation-v2-'))
  roots.push(root)
  return { actionsDir: join(root, 'actions'), dataDir: join(root, 'data') }
}
function secret(fill = 7): Uint8Array { return new Uint8Array(32).fill(fill) }
function authority(time: Clock, fill = 7): TrustedActionAuthorityV1 {
  return new TrustedActionAuthorityV1({ secret: secret(fill), now: time.now })
}
function contract(id: string, time: Clock, timeoutMs = 50): ActionContractV1 {
  return createCoreCompatibilityAction({ model: 'qwen3:8b', originatingSurface: 'cli', actionId: id, createdAt: time.now().toISOString(), timeoutMs })
}
function approve(value: ActionContractV1, time: Clock, fill = 7): { authority: TrustedActionAuthorityV1; approved: ApprovedActionV1 } {
  const trusted = authority(time, fill)
  return { authority: trusted, approved: trusted.issueApprovalAfterTrustedUserConfirmation(value) }
}
function passFetch(calls?: { version: number; generate: number }): BenchFetch {
  return async (input, init) => {
    const url = String(input)
    if (url === OLLAMA_VERSION_URL) {
      if (calls) calls.version += 1
      return new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
    }
    if (url === OLLAMA_GENERATE_URL) {
      if (calls) calls.generate += 1
      const body = JSON.parse(String(init?.body)) as { model: string }
      return new Response(JSON.stringify({ model: body.model, response: 'READY', done: true, eval_count: 1, prompt_eval_count: 1 }) + NL, { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }
}
async function validResult(actionId: string, time: Clock, model = 'qwen3:8b'): Promise<BenchEvaluationV1> {
  return runBenchTaskPackV1({ model, packId: CORE_TASK_PACK_SELECTOR, runId: actionId, timeoutMs: 50, fetchImpl: passFetch(), now: time.now })
}
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code })
}
function runningState(value: ActionContractV1, time: Clock, ownerProcessId = 999999): ReturnType<typeof initialOperationState> {
  const ready = { ...initialOperationState(value), approvalIssuedAt: time.now().toISOString() }
  return { ...ready, ownerProcessId, startedAt: time.now().toISOString() }
}
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }) })

describe('ACT foundation v2 strict contract and authority', () => {
  it('accepts one valid current-main-native Core Compatibility contract with exact identity', () => {
    const time = clock()
    const value = contract('act-valid', time)
    expect(validateActionContractV1(value)).toEqual(value)
    expect(value.contractVersion).toBe('metrora.action.v1')
    expect(value.kind).toBe('run-core-compatibility')
    expect(value.target.runtime.endpoint).toBe('http://127.0.0.1:11434')
    expect(value.arguments.runId).toBe(value.actionId)
    expect(value.arguments.promptSource).toBe('canonical-pack-only')
    expect(value.methodology).toMatchObject({ family: 'compatibility-runtime-health', runner: 'canonical-task-pack-v1', scoring: 'deterministic-task-assertions' })
    expect(value.limits.checksPlanned).toBe(6)
    expect(value.rollback).toEqual({ capability: 'none', reason: ACTION_NO_ROLLBACK_REASON })
  })

  it('rejects unknown schema versions and action kinds', () => {
    const value = contract('act-schema-kind', clock())
    expect(() => validateActionContractV1({ ...value, schemaVersion: 2 })).toThrow()
    expect(() => validateActionContractV1({ ...value, kind: 'run-core-conformance-bench' })).toThrow()
    expect(ACTION_KIND_RUN_CORE_COMPATIBILITY).toBe('run-core-compatibility')
  })

  it('rejects arbitrary endpoints, filesystem paths, and prompts', () => {
    const value = contract('act-boundary-inputs', clock())
    expect(() => validateActionContractV1({ ...value, target: { ...value.target, runtime: { ...value.target.runtime, endpoint: 'http://127.0.0.1:9999' } } })).toThrow()
    expect(() => validateActionContractV1({ ...value, arguments: { ...value.arguments, prompt: 'execute arbitrary text' } })).toThrow()
    expect(() => validateActionContractV1({ ...value, preconditions: { ...value.preconditions, arbitraryPaths: 'allowed' } })).toThrow()
  })

  it('rejects mutation effects and non-canonical timeout bounds', () => {
    const value = contract('act-effects-timeout', clock())
    expect(() => validateActionContractV1({ ...value, declaredEffects: { ...value.declaredEffects, writes: ['repository-files', 'secrets'] } })).toThrow()
    expect(() => validateActionContractV1({ ...value, timeout: { ...value.timeout, operationMs: 51 } })).toThrow()
    expect(() => createCoreCompatibilityAction({ model: 'qwen3:8b', originatingSurface: 'cli', actionId: 'bad-model', timeoutMs: 49 })).toThrow()
  })

  it('rejects cycles and accessor-backed contract data before schema parsing', () => {
    const value = contract('act-json-safety', clock()) as unknown as Record<string, unknown>
    const cycle: Record<string, unknown> = { ...value }
    cycle.self = cycle
    expect(() => validateActionContractV1(cycle)).toThrow()
    const accessor = { ...value, schemaVersion: 1 } as Record<string, unknown>
    Object.defineProperty(accessor, 'actionId', { get: () => 'act-json-safety' })
    expect(() => validateActionContractV1(accessor)).toThrow()
  })

  it('binds approval to the exact proposal, confirmation, execution, target, and model', () => {
    const time = clock()
    const value = contract('act-approval-binding', time)
    const { authority: trusted, approved } = approve(value, time)
    expect(trusted.verifyApprovedAction(approved)).toEqual(approved)
    expect(() => trusted.verifyApprovedAction({ ...approved, contract: { ...approved.contract, target: { ...approved.contract.target, model: 'llama3.2' }, arguments: { ...approved.contract.arguments, model: 'llama3.2' } } })).toThrow()
    expect(() => trusted.verifyApprovedAction({ ...approved, approval: { ...approved.approval, actionId: 'other-action' } })).toThrow()
  })

  it('rejects forged approval proofs and approvals issued by a different authority after restart', () => {
    const time = clock()
    const value = contract('act-forged-restart', time)
    const { approved } = approve(value, time)
    const forged = { ...approved, approval: { ...approved.approval, proof: '0'.repeat(64) } }
    expect(() => authority(time).verifyApprovedAction(forged as unknown)).toThrow()
    expect(() => new TrustedActionAuthorityV1({ secret: secret(8), now: time.now }).verifyApprovedAction(approved)).toThrow()
  })

  it('rejects expired approvals and does not renew them implicitly', () => {
    const time = clock()
    const value = contract('act-expired-approval', time)
    const { authority: trusted, approved } = approve(value, time)
    time.advance(5 * 60_000 + 1)
    expect(() => trusted.verifyApprovedAction(approved)).toThrow(/expired/)
    expect(() => trusted.issueApprovalAfterTrustedUserConfirmation(approved.contract)).toThrow()
  })

  it('normalizes forged and stale authority failures at the executor boundary', async () => {
    const time = clock()
    const { actionsDir } = await dirs()
    const value = contract('act-executor-approval-errors', time)
    const { authority: trusted, approved } = approve(value, time)
    const forged = { ...approved, approval: { ...approved.approval, proof: '0'.repeat(64) } }
    await expectCode(executeApprovedCoreCompatibility(forged, { authority: trusted, actionsDir, now: time.now }), 'approval-invalid')
    time.advance(5 * 60_000 + 1)
    await expectCode(executeApprovedCoreCompatibility(approved, { authority: trusted, actionsDir, now: time.now }), 'approval-expired')
  })
})

describe('ACT foundation v2 proposal, lifecycle, and evidence', () => {
  it('persists a proposal-only record without trusted approval or mutable outcome data', async () => {
    const time = clock()
    const { actionsDir } = await dirs()
    const value = contract('act-proposal-only', time)
    const record = await recordCoreCompatibilityProposal(value, { actionsDir, now: time.now })
    expect(record.status).toBe('proposed')
    expect(record.contract.approval.confirmationDigest).toBeNull()
    expect(record.operation.approvalIssuedAt).toBeNull()
    expect(record.operation.result).toBeNull()
    expect(record.operation.evidenceReferences).toEqual([])
  })

  it('rejects self-approved contracts at the proposal boundary', async () => {
    const time = clock()
    const { actionsDir } = await dirs()
    const { approved } = approve(contract('act-self-approval', time), time)
    await expectCode(recordCoreCompatibilityProposal(approved.contract, { actionsDir, now: time.now }), 'validation')
  })

  it('executes the canonical six-check runner and records exact Bench evidence references', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-completed', time, SUCCESS_TIMEOUT_MS)
    const { authority: trusted, approved } = approve(value, time)
    const calls = { version: 0, generate: 0 }
    const record = await executeApprovedCoreCompatibility(approved, { authority: trusted, actionsDir, dataDir, now: time.now, fetchImpl: passFetch(calls) })
    expect(record.status).toBe('completed')
    expect(calls).toEqual({ version: 1, generate: 6 })
    expect(record.operation.result).toMatchObject({ kind: 'metrora.bench-evaluation.v1', runId: value.actionId, history: 'saved' })
    expect(record.operation.evidenceReferences).toHaveLength(1)
    expect(record.operation.evidenceReferences[0]).toMatchObject({ kind: 'metrora.bench-history.v1', runId: value.actionId, history: 'saved' })
    const history = await scanBenchHistoryV1({ dataDir })
    expect(history.records).toHaveLength(1)
    expect(history.records[0]?.runId).toBe(value.actionId)
  })

  it('uses the canonical task-pack runner seam with exact selector and no arbitrary prompt input', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-canonical-runner', time)
    const { authority: trusted, approved } = approve(value, time)
    let seen: BenchTaskPackRunOptions | null = null
    const runBench = async (options: BenchTaskPackRunOptions): Promise<BenchEvaluationV1> => {
      seen = options
      return runBenchTaskPackV1({ ...options, fetchImpl: passFetch() })
    }
    const record = await executeApprovedCoreCompatibility(approved, { authority: trusted, actionsDir, dataDir, now: time.now, runBench })
    expect(record.status).toBe('completed')
    expect(seen).toMatchObject({ model: 'qwen3:8b', packId: CORE_TASK_PACK_SELECTOR, runId: value.actionId, timeoutMs: 50 })
    expect(seen && 'prompt' in seen).toBe(false)
  })

  it('journals monotonic bounded progress tied to the six canonical task checks', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-progress', time)
    const { authority: trusted, approved } = approve(value, time)
    const record = await executeApprovedCoreCompatibility(approved, {
      authority: trusted,
      actionsDir,
      dataDir,
      now: time.now,
      runBench: async options => {
        await options.onProgress?.({ planned: 6, completed: 1 })
        await options.onProgress?.({ planned: 6, completed: 3 })
        return validResult(value.actionId, time)
      },
    })
    expect(record.status).toBe('completed')
    const history = (await readFile(journalPath(actionsDir), 'utf8')).trim().split(NL).map(line => JSON.parse(line) as { status: string; operation?: { progress?: { completed: number } } })
    expect(history.filter(entry => entry.status === 'running').map(entry => entry.operation?.progress?.completed)).toEqual([0, 1, 3])
    expect(record.operation.progress).toEqual({ planned: 6, completed: 6 })
  })

  it('rejects terminal replay and leaves one canonical evidence record', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const { authority: trusted, approved } = approve(contract('act-replay', time, SUCCESS_TIMEOUT_MS), time)
    const first = await executeApprovedCoreCompatibility(approved, { authority: trusted, actionsDir, dataDir, now: time.now, fetchImpl: passFetch() })
    expect(first.status).toBe('completed')
    await expectCode(executeApprovedCoreCompatibility(approved, { authority: trusted, actionsDir, dataDir, now: time.now, fetchImpl: passFetch() }), 'replay')
    expect((await scanBenchHistoryV1({ dataDir })).records).toHaveLength(1)
  })

  it('rejects invalid lifecycle entry and transition shapes fail closed', async () => {
    const time = clock()
    const { actionsDir } = await dirs()
    const { approved } = approve(contract('act-invalid-transition', time), time)
    await expectCode(appendOperationRecord(actionsDir, approved.contract, 'running', runningState(approved.contract, time), time.now), 'journal')
    expect(await readCoreCompatibilityAction(approved.contract.actionId, { actionsDir, now: time.now })).toBeNull()
  })

  it('expires a persisted ready state on read and never silently renews its approval', async () => {
    const time = clock()
    const { actionsDir } = await dirs()
    const value = contract('act-ready-expiry', time)
    const { approved } = approve(value, time)
    await recordCoreCompatibilityProposal(value, { actionsDir, now: time.now })
    await appendOperationRecord(actionsDir, approved.contract, 'ready', { ...initialOperationState(approved.contract), approvalIssuedAt: approved.approval.issuedAt }, time.now)
    time.advance(5 * 60_000 + 1)
    const expired = await readCoreCompatibilityAction(value.actionId, { actionsDir, now: time.now })
    expect(expired?.status).toBe('failed')
    expect(expired?.operation.failure?.category).toBe('approval-expired')
    expect(expired?.operation.ownerProcessId).toBeNull()
  })
})

describe('ACT foundation v2 cancellation, timeout, recovery, and identity', () => {
  it('cancels before execution starts without invoking the Bench runner', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const { authority: trusted, approved } = approve(contract('act-cancel-before-start', time), time)
    const controller = new AbortController()
    controller.abort()
    let called = false
    const record = await executeApprovedCoreCompatibility(approved, {
      authority: trusted,
      actionsDir,
      dataDir,
      now: time.now,
      signal: controller.signal,
      runBench: async () => { called = true; throw new Error('must not run') },
    })
    expect(record.status).toBe('cancelled')
    expect(record.operation.failure?.category).toBe('cancelled')
    expect(called).toBe(false)
  })

  it('makes cancellation authoritative over a late result', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-cancel-late', time)
    const { authority: trusted, approved } = approve(value, time)
    let resolveLate!: (result: BenchEvaluationV1) => void
    const lateResult = new Promise<BenchEvaluationV1>(resolve => { resolveLate = resolve })
    const execution = executeApprovedCoreCompatibility(approved, {
      authority: trusted,
      actionsDir,
      dataDir,
      now: time.now,
      runBench: async () => lateResult,
    })
    let running = false
    for (let attempt = 0; attempt < 30 && !running; attempt++) {
      running = (await readCoreCompatibilityAction(value.actionId, { actionsDir, now: time.now }))?.status === 'running'
      if (!running) await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(running).toBe(true)
    const requested = await cancelCoreCompatibilityAction(value.actionId, { actionsDir, dataDir, now: time.now })
    expect(['requested', 'already-terminal']).toContain(requested.status)
    const cancelled = await execution
    expect(cancelled.status).toBe('cancelled')
    resolveLate(await validResult(value.actionId, time))
    await new Promise(resolve => setTimeout(resolve, 50))
    const afterLateResult = await readCoreCompatibilityAction(value.actionId, { actionsDir, dataDir, now: time.now })
    expect(afterLateResult?.status).toBe('cancelled')
    expect(afterLateResult?.operation.result).toBeNull()
    expect((await scanBenchHistoryV1({ dataDir })).records).toHaveLength(0)
  })

  it('records timeout distinctly and discards a late result after the bounded operation deadline', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-timeout-late', time)
    const { authority: trusted, approved } = approve(value, time)
    const execution = executeApprovedCoreCompatibility(approved, {
      authority: trusted,
      actionsDir,
      dataDir,
      now: time.now,
      runBench: async () => {
        await new Promise(resolve => setTimeout(resolve, 500))
        return validResult(value.actionId, time)
      },
    })
    const timedOut = await execution
    expect(timedOut.status).toBe('failed')
    expect(timedOut.operation.failure?.category).toBe('timeout')
    expect(timedOut.operation.timeout.triggered).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect((await scanBenchHistoryV1({ dataDir })).records).toHaveLength(0)
    expect((await readCoreCompatibilityAction(value.actionId, { actionsDir, dataDir, now: time }))?.status).toBe('failed')
  }, 5_000)

  it('recovers an orphaned running action to failed without automatic retry when evidence is absent', async () => {
    const time = clock()
    const { actionsDir } = await dirs()
    const value = contract('act-orphan-fail', time)
    const { approved } = approve(value, time)
    await recordCoreCompatibilityProposal(value, { actionsDir, now: time.now })
    await appendOperationRecord(actionsDir, approved.contract, 'ready', { ...initialOperationState(approved.contract), approvalIssuedAt: approved.approval.issuedAt }, time.now)
    await appendOperationRecord(actionsDir, approved.contract, 'running', runningState(approved.contract, time), time.now)
    const recovered = await readCoreCompatibilityAction(value.actionId, { actionsDir, now: time.now })
    expect(recovered?.status).toBe('failed')
    expect(recovered?.operation.failure).toMatchObject({ category: 'execution' })
    expect(recovered?.operation.result).toBeNull()
  })

  it('recovers an orphaned running action to completed only from exact canonical evidence', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-orphan-evidence', time)
    const { approved } = approve(value, time)
    const result = await validResult(value.actionId, time)
    await saveBenchEvaluationV1(result, { dataDir })
    await recordCoreCompatibilityProposal(value, { actionsDir, now: time.now })
    await appendOperationRecord(actionsDir, approved.contract, 'ready', { ...initialOperationState(approved.contract), approvalIssuedAt: approved.approval.issuedAt }, time.now)
    await appendOperationRecord(actionsDir, approved.contract, 'running', runningState(approved.contract, time), time.now)
    const recovered = await readCoreCompatibilityAction(value.actionId, { actionsDir, dataDir, now: time.now })
    expect(recovered?.status).toBe('completed')
    expect(recovered?.operation.result).toMatchObject({ resultDigest: result.resultDigest, history: 'duplicate' })
    expect(recovered?.operation.evidenceReferences[0]).toMatchObject({ runId: value.actionId, resultDigest: result.resultDigest, history: 'duplicate' })
  })

  it('fails closed on malformed Bench results and never publishes them as evidence', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const { authority: trusted, approved } = approve(contract('act-malformed-result', time), time)
    const record = await executeApprovedCoreCompatibility(approved, {
      authority: trusted,
      actionsDir,
      dataDir,
      now: time.now,
      runBench: async () => ({ malformed: true } as unknown as BenchEvaluationV1),
    })
    expect(record.status).toBe('failed')
    expect(record.operation.failure?.category).toBe('malformed-result')
    expect((await scanBenchHistoryV1({ dataDir })).records).toHaveLength(0)
  })

  it('fails closed when Bench result identity does not match the approved action', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-result-mismatch', time)
    const { authority: trusted, approved } = approve(value, time)
    const wrongResult = await validResult('different-run-id', time)
    const record = await executeApprovedCoreCompatibility(approved, { authority: trusted, actionsDir, dataDir, now: time.now, runBench: async () => wrongResult })
    expect(record.status).toBe('failed')
    expect(record.operation.failure?.category).toBe('identity-mismatch')
    expect((await scanBenchHistoryV1({ dataDir })).records).toHaveLength(0)
  })

  it('rejects an approved action whose exact identity differs from the recorded proposal', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-proposal-identity', time)
    await recordCoreCompatibilityProposal(value, { actionsDir, now: time.now })
    const alternate = createCoreCompatibilityAction({ model: 'qwen3:8b', originatingSurface: 'desktop', actionId: value.actionId, createdAt: value.createdAt, timeoutMs: 50 })
    const { authority: trusted, approved } = approve(alternate, time)
    await expectCode(executeApprovedCoreCompatibility(approved, { authority: trusted, actionsDir, dataDir, now: time.now, runBench: async () => validResult(value.actionId, time) }), 'identity-mismatch')
  })
})

describe('ACT foundation v2 journal strictness and legacy compatibility', () => {
  it('rejects duplicate proposals for the same action identity', async () => {
    const time = clock()
    const { actionsDir } = await dirs()
    const value = contract('act-duplicate-proposal', time)
    await recordCoreCompatibilityProposal(value, { actionsDir, now: time.now })
    await expectCode(recordCoreCompatibilityProposal(value, { actionsDir, now: time.now }), 'duplicate')
  })

  it('rejects unknown journal record shapes instead of treating them as legacy actions', async () => {
    const time = clock()
    const { actionsDir } = await dirs()
    await mkdir(actionsDir, { recursive: true })
    await writeFile(journalPath(actionsDir), JSON.stringify({ id: 'unknown-record', kind: 'unknown-kind', status: 'unknown-status', at: time.now().toISOString() }) + NL)
    await expectCode(readCoreCompatibilityAction('unknown-record', { actionsDir, now: time.now }), 'journal')
  })

  it('rejects malformed ACT journal JSON fail closed while legacy read remains intentionally compatible', async () => {
    const { actionsDir } = await dirs()
    await mkdir(actionsDir, { recursive: true })
    await appendFile(journalPath(actionsDir), '{not-json' + NL)
    await expectCode(readCoreCompatibilityAction('any-action', { actionsDir }), 'journal')
    expect(await readRecords(actionsDir)).toEqual([])
  })

  it('keeps legacy records readable beside controlled ACT records without mixing their identities', async () => {
    const time = clock()
    const { actionsDir } = await dirs()
    const legacy: ActionRecord = { id: 'legacy-compatible', at: time.now().toISOString(), kind: 'shell-config', findingId: null, description: 'legacy action', changes: [], status: 'applied' }
    await appendRecord(actionsDir, legacy)
    const value = contract('act-beside-legacy', time)
    await recordCoreCompatibilityProposal(value, { actionsDir, now: time.now })
    const all = await readRecords(actionsDir)
    expect(all).toHaveLength(2)
    expect((await readCoreCompatibilityAction(value.actionId, { actionsDir, now: time.now }))?.status).toBe('proposed')
  })

  it('preserves the legacy file mutation path for ordinary legacy action kinds', async () => {
    const { actionsDir } = await dirs()
    const target = join(actionsDir, 'legacy.txt')
    const result = await runAction({ kind: 'shell-config', description: 'legacy mutation', changes: [{ op: 'create', path: target, content: 'legacy' }] }, actionsDir)
    expect(result.status).toBe('applied')
    expect(await readFile(target, 'utf8')).toBe('legacy')
    expect((await readRecords(actionsDir)).some(record => record.id === result.id && record.status === 'applied')).toBe(true)
  })

  it('rejects the controlled operation before it can enter runAction or mutate files', async () => {
    const { actionsDir } = await dirs()
    const target = join(actionsDir, 'must-not-exist.txt')
    const controlledPlan = { kind: ACTION_KIND_RUN_CORE_COMPATIBILITY, description: 'controlled', changes: [{ op: 'create', path: target, content: 'nope' }] } as unknown as ActionPlan
    await expect(runAction(controlledPlan, actionsDir)).rejects.toThrow(/controlled operation/)
    expect(await readRecords(actionsDir)).toEqual([])
    await expect(readFile(target, 'utf8')).rejects.toThrow()
  })

  it('keeps controlled records outside the legacy undo selector', async () => {
    const time = clock()
    const { actionsDir } = await dirs()
    const value = contract('act-not-legacy-undo', time)
    await recordCoreCompatibilityProposal(value, { actionsDir, now: time.now })
    await expect(undoAction({ id: value.actionId }, { actionsDir })).rejects.toThrow(/No action matches/)
  })

  it('does not write prompt text, model output, or secrets into the ACT journal', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-journal-minimal', time)
    const { authority: trusted, approved } = approve(value, time)
    await executeApprovedCoreCompatibility(approved, { authority: trusted, actionsDir, dataDir, now: time.now, fetchImpl: passFetch() })
    const raw = await readFile(journalPath(actionsDir), 'utf8')
    expect(raw).not.toContain('single lowercase word')
    expect(raw).not.toContain('READY')
    expect(raw).not.toContain('secret')
    expect(raw).toContain('metrora.bench-history.v1')
  })

  it('returns already-terminal for cancellation after completion and never appends duplicate evidence', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-terminal-cancel', time, SUCCESS_TIMEOUT_MS)
    const { authority: trusted, approved } = approve(value, time)
    const completed = await executeApprovedCoreCompatibility(approved, { authority: trusted, actionsDir, dataDir, now: time.now, fetchImpl: passFetch() })
    const cancelled = await cancelCoreCompatibilityAction(value.actionId, { actionsDir, dataDir, now: time.now })
    expect(completed.status).toBe('completed')
    expect(cancelled.status).toBe('already-terminal')
    expect((await scanBenchHistoryV1({ dataDir })).records).toHaveLength(1)
    expect((await readCoreCompatibilityAction(value.actionId, { actionsDir, dataDir, now: time.now }))?.status).toBe('completed')
  })

  it('rejects duplicate terminal journal entries instead of accepting a second completion', async () => {
    const time = clock()
    const { actionsDir, dataDir } = await dirs()
    const value = contract('act-duplicate-terminal', time)
    const { authority: trusted, approved } = approve(value, time)
    const completed = await executeApprovedCoreCompatibility(approved, { authority: trusted, actionsDir, dataDir, now: time.now, fetchImpl: passFetch() })
    await appendRecord(actionsDir, completed)
    await expectCode(readCoreCompatibilityAction(value.actionId, { actionsDir, dataDir, now: time.now }), 'journal')
  })
})
