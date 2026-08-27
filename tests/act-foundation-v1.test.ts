import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ActionContractError,
  ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
  ACTION_OPERATION_VERSION,
  TrustedActionAuthorityV1,
  computeActionProposalDigest,
  createCoreConformanceBenchAction,
  validateActionContractV1,
} from '../src/act/action-contract-v1.js'
import {
  cancelCoreConformanceBenchAction,
  executeApprovedCoreConformanceBench,
  readCoreConformanceAction,
  recordCoreConformanceProposal,
} from '../src/act/bench-operation-v1.js'
import { createActionBridgeV1 } from '../src/act/bridge-v1.js'
import { projectActionForMobile } from '../src/act/projection-v1.js'
import { appendRecord, journalPath, readRecords } from '../src/act/journal.js'
import { runAction } from '../src/act/apply.js'
import { undoAction } from '../src/act/undo.js'
import { CORE_TASK_PACK_V1 } from '../src/bench/task-pack-v1.js'
import { OLLAMA_GENERATE_URL, OLLAMA_VERSION_URL, type BenchFetch } from '../src/bench/ollama-local.js'
import { runBenchTaskPackV1 } from '../src/bench/task-pack-run-v1.js'

const roots: string[] = []

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

async function makeRoot(): Promise<{ root: string; actionsDir: string; dataDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-act-foundation-'))
  roots.push(root)
  return { root, actionsDir: join(root, 'actions'), dataDir: join(root, 'data') }
}

async function withBridgeDefaults<T>(fx: { root: string; dataDir: string }, fetchImpl: BenchFetch, fn: () => Promise<T>): Promise<T> {
  const previousConfigDir = process.env['METRORA_CONFIG_DIR']
  const previousDataDir = process.env['METRORA_DATA_DIR']
  const previousFetch = globalThis.fetch
  process.env['METRORA_CONFIG_DIR'] = fx.root
  process.env['METRORA_DATA_DIR'] = fx.dataDir
  globalThis.fetch = fetchImpl
  try {
    return await fn()
  } finally {
    if (previousConfigDir === undefined) delete process.env['METRORA_CONFIG_DIR']
    else process.env['METRORA_CONFIG_DIR'] = previousConfigDir
    if (previousDataDir === undefined) delete process.env['METRORA_DATA_DIR']
    else process.env['METRORA_DATA_DIR'] = previousDataDir
    globalThis.fetch = previousFetch
  }
}

const NL = String.fromCharCode(10)

function stream(output: string, model = 'qwen3:8b'): Response {
  return new Response(
    JSON.stringify({ model, response: output, done: false }) + NL
      + JSON.stringify({ model, response: '', done: true, eval_count: 4, prompt_eval_count: 8 }) + NL,
    { status: 200 },
  )
}

function passingOutput(prompt: string): string {
  if (prompt.includes('single lowercase word')) return 'blue'
  if (prompt.includes('17 + 25')) return '42'
  if (prompt.includes('"answer":42')) return '{"answer":42,"unit":"items"}'
  if (prompt.includes('JSON object')) return '{"kind":"fixture","count":3}'
  if (prompt.includes('JSON array')) return '["alpha","beta","gamma"]'
  return 'READY'
}

function passingFetch(): BenchFetch {
  return async (input, init) => {
    const url = String(input)
    if (url === OLLAMA_VERSION_URL) return new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
    if (url !== OLLAMA_GENERATE_URL) return new Response('not found', { status: 404 })
    const body = JSON.parse(String(init?.body)) as { prompt: string }
    return stream(passingOutput(body.prompt))
  }
}

function action(over: Partial<Parameters<typeof createCoreConformanceBenchAction>[0]> = {}) {
  return createCoreConformanceBenchAction({
    model: 'qwen3:8b',
    originatingSurface: 'desktop',
    actionId: 'act-test-001',
    createdAt: '2026-08-27T10:00:00.000Z',
    timeoutMs: 1000,
    ...over,
  })
}

describe('ActionContractV1 strict public contract', () => {
  it('has a stable identity, exact Core pack/runtime bounds, and a stable proposal digest', () => {
    const proposal = action()
    expect(proposal).toMatchObject({
      contractVersion: 'metrora.action.v1',
      schemaVersion: 1,
      actionId: 'act-test-001',
      kind: ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
      target: {
        runtime: { id: 'ollama-local', endpoint: 'http://127.0.0.1:11434' },
        model: 'qwen3:8b',
        pack: { selector: 'core-v1', packId: 'metrora.bench.core', version: '1.0.0', digest: CORE_TASK_PACK_V1.digest },
      },
      approval: { required: 'explicit-user-confirmation', confirmationDigest: null },
      rollback: { capability: 'none' },
    })
    expect(proposal.limits.checksPlanned).toBe(6)
    expect(proposal.timeout.operationMs).toBe(7000)
    expect(computeActionProposalDigest(proposal)).toBe(proposal.approval.proposalDigest)
    const approved = new TrustedActionAuthorityV1(Buffer.alloc(32, 6)).issueApprovalAfterTrustedUserConfirmation(proposal)
    expect(computeActionProposalDigest(approved.contract)).toBe(proposal.approval.proposalDigest)
    expect(JSON.parse(JSON.stringify(proposal))).toEqual(proposal)
  })

  it('rejects undeclared fields, model approval claims, arbitrary prompts, endpoints, and path-like action ids', () => {
    const proposal = action()
    expect(() => validateActionContractV1({ ...proposal, approved: true })).toThrow(ActionContractError)
    expect(() => validateActionContractV1({ ...proposal, arguments: { ...proposal.arguments, prompt: 'run anything' } })).toThrow(ActionContractError)
    expect(() => validateActionContractV1({ ...proposal, actionId: '../outside' })).toThrow(ActionContractError)
    expect(() => validateActionContractV1({
      ...proposal,
      target: { ...proposal.target, runtime: { ...proposal.target.runtime, endpoint: 'https://remote.example' } },
    })).toThrow(ActionContractError)
  })

  it('binds approval to the exact proposal and invalidates material proposal mutations', () => {
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 7))
    const approved = authority.issueApprovalAfterTrustedUserConfirmation(action())
    expect(approved.contract.approval.confirmationDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(approved)).not.toContain('approved":true')
    expect(() => authority.verifyApprovedAction({
      ...approved,
      contract: {
        ...approved.contract,
        target: { ...approved.contract.target, model: 'other:8b' },
        arguments: { ...approved.contract.arguments, model: 'other:8b' },
      },
    })).toThrow(ActionContractError)
    expect(() => authority.verifyApprovedAction({
      ...approved,
      approval: { ...approved.approval, proof: '0'.repeat(64) },
    })).toThrow(ActionContractError)
  })
})

describe('controlled Core Bench action lifecycle', () => {
  it('records proposal/ready/running/completed in the existing ACT journal and references Bench history', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 8))
    const proposal = action({ actionId: 'act-complete-001' })
    await recordCoreConformanceProposal(proposal, { actionsDir: fx.actionsDir })
    const approved = authority.issueApprovalAfterTrustedUserConfirmation(proposal)
    const record = await executeApprovedCoreConformanceBench(approved, {
      authority,
      actionsDir: fx.actionsDir,
      dataDir: fx.dataDir,
      fetchImpl: passingFetch(),
    })

    expect(record.status).toBe('completed')
    expect(record.operation.operationVersion).toBe(ACTION_OPERATION_VERSION)
    expect(record.operation.progress).toEqual({ planned: 6, completed: 6 })
    expect(record.operation.checksCompleted).toBe(6)
    expect(record.operation.result).toMatchObject({ runId: proposal.actionId, history: 'saved' })
    expect(record.operation.result?.resultDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(record.operation.evidenceReferences).toHaveLength(1)
    expect(record.operation.failure).toBeNull()
    expect(record.operation.rollback.capability).toBe('none')
    await expect(readCoreConformanceAction(record.id, { actionsDir: fx.actionsDir, dataDir: fx.dataDir })).resolves.toMatchObject({ status: 'completed' })
    await expect(undoAction({ id: record.id }, { actionsDir: fx.actionsDir })).rejects.toThrow(/no conventional rollback/)

    await appendRecord(fx.actionsDir, {
      ...record,
      operation: { ...record.operation, resultCounts: { ...record.operation.resultCounts!, passed: 0 } },
    })
    await expect(readCoreConformanceAction(record.id, { actionsDir: fx.actionsDir, dataDir: fx.dataDir })).rejects.toMatchObject({ code: 'identity-mismatch' })

    const records = await readRecords(fx.actionsDir)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ id: proposal.actionId, kind: ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH, status: 'completed' })
    const journal = await readFile(journalPath(fx.actionsDir), 'utf8')
    expect(journal).not.toContain('Return exactly the single lowercase word blue')
    expect(journal).not.toContain('"response":"blue"')
  })

  it('rejects duplicate proposals and replay after a terminal action', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 9))
    const proposal = action({ actionId: 'act-replay-001' })
    await recordCoreConformanceProposal(proposal, { actionsDir: fx.actionsDir })
    await expect(recordCoreConformanceProposal(proposal, { actionsDir: fx.actionsDir })).rejects.toMatchObject({ code: 'duplicate' })
    const approved = authority.issueApprovalAfterTrustedUserConfirmation(proposal)
    await executeApprovedCoreConformanceBench(approved, { authority, actionsDir: fx.actionsDir, dataDir: fx.dataDir, fetchImpl: passingFetch() })
    await expect(executeApprovedCoreConformanceBench(approved, { authority, actionsDir: fx.actionsDir, dataDir: fx.dataDir, fetchImpl: passingFetch() })).rejects.toMatchObject({ code: 'replay' })
  })

  it('closes an orphaned running record without retrying an unknown operation', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 18))
    const proposal = action({ actionId: 'act-orphaned-001' })
    const proposed = await recordCoreConformanceProposal(proposal, { actionsDir: fx.actionsDir })
    await appendRecord(fx.actionsDir, {
      ...proposed,
      status: 'running',
      operation: {
        ...proposed.operation,
        ownerProcessId: Number.MAX_SAFE_INTEGER,
        startedAt: '2026-08-27T10:00:01.000Z',
      },
    })
    const recovered = await executeApprovedCoreConformanceBench(authority.issueApprovalAfterTrustedUserConfirmation(proposal), { authority, actionsDir: fx.actionsDir, dataDir: fx.dataDir, fetchImpl: passingFetch() })
    expect(recovered.status).toBe('failed')
    expect(recovered.operation.failure?.category).toBe('execution')
    expect(recovered.operation.ownerProcessId).toBeNull()
    expect(recovered.operation.completedAt).not.toBeNull()
    expect(recovered.operation.result).toBeNull()
  })

  it('keeps unavailable distinct from failed and saves the bounded unavailable result', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 10))
    const proposal = action({ actionId: 'act-unavailable-001' })
    const approved = authority.issueApprovalAfterTrustedUserConfirmation(proposal)
    const record = await executeApprovedCoreConformanceBench(approved, {
      authority,
      actionsDir: fx.actionsDir,
      dataDir: fx.dataDir,
      fetchImpl: async (input) => String(input) === OLLAMA_VERSION_URL
        ? new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
        : new Response('missing', { status: 404 }),
    })

    expect(record.status).toBe('unavailable')
    expect(record.operation.failure?.category).toBe('unavailable')
    expect(record.operation.result).not.toBeNull()
    expect(record.operation.resultCounts).toMatchObject({ planned: 6, unavailable: 6 })
  })

  it('keeps timeout distinct and bounded', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 11))
    const proposal = action({ actionId: 'act-timeout-001', timeoutMs: 50 })
    const approved = authority.issueApprovalAfterTrustedUserConfirmation(proposal)
    const record = await executeApprovedCoreConformanceBench(approved, {
      authority,
      actionsDir: fx.actionsDir,
      dataDir: fx.dataDir,
      fetchImpl: async () => await new Promise<Response>(() => undefined),
    })

    expect(record.status).toBe('failed')
    expect(record.operation.failure?.category).toBe('timeout')
    expect(record.operation.timeout.triggered).toBe(true)
    expect(record.operation.result).not.toBeNull()
  })

  it('propagates real cancellation and suppresses a late runtime result', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 12))
    const proposal = action({ actionId: 'act-cancel-001', timeoutMs: 1000 })
    const approved = authority.issueApprovalAfterTrustedUserConfirmation(proposal)
    let generateCalls = 0
    const fetchImpl: BenchFetch = async (input) => {
      if (String(input) === OLLAMA_VERSION_URL) return new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
      generateCalls += 1
      return await new Promise<Response>(resolve => setTimeout(() => resolve(stream(passingOutput(CORE_TASK_PACK_V1.tasks[generateCalls - 1]?.prompt ?? ''))), 150))
    }
    const execution = executeApprovedCoreConformanceBench(approved, { authority, actionsDir: fx.actionsDir, dataDir: fx.dataDir, fetchImpl })
    await new Promise(resolve => setTimeout(resolve, 10))
    const cancellation = await cancelCoreConformanceBenchAction(proposal.actionId, { actionsDir: fx.actionsDir })
    expect(cancellation.status).toBe('requested')
    const record = await execution
    expect(record.status).toBe('cancelled')
    expect(record.operation.failure?.category).toBe('cancelled')
    expect(record.operation.result).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 200))
    const late = await readCoreConformanceAction(proposal.actionId, { actionsDir: fx.actionsDir })
    expect(late?.status).toBe('cancelled')
    expect(late?.operation.result).toBeNull()
  })

  it('exposes truthful coarse progress while the canonical task pack is running', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 13))
    const proposal = action({ actionId: 'act-progress-001' })
    const approved = authority.issueApprovalAfterTrustedUserConfirmation(proposal)
    let releaseFirst: (() => void) | undefined
    let firstStarted!: () => void
    const started = new Promise<void>(resolve => { firstStarted = resolve })
    let generationCalls = 0
    const fetchImpl: BenchFetch = async (input, init) => {
      if (String(input) === OLLAMA_VERSION_URL) return new Response(JSON.stringify({ version: '0.12.6' }), { status: 200 })
      generationCalls += 1
      const body = JSON.parse(String(init?.body)) as { prompt: string }
      if (generationCalls === 1) {
        firstStarted()
        await new Promise<void>(resolve => { releaseFirst = resolve })
      }
      return stream(passingOutput(body.prompt))
    }
    const execution = executeApprovedCoreConformanceBench(approved, { authority, actionsDir: fx.actionsDir, dataDir: fx.dataDir, fetchImpl })
    await started
    const running = await readCoreConformanceAction(proposal.actionId, { actionsDir: fx.actionsDir })
    expect(running?.status).toBe('running')
    expect(running?.operation.progress).toEqual({ planned: 6, completed: 0 })
    releaseFirst?.()
    const completed = await execution
    expect(completed.operation.progress).toEqual({ planned: 6, completed: 6 })
  })

  it('fails closed on a malformed Bench result and does not invent evidence', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 14))
    const proposal = action({ actionId: 'act-malformed-001' })
    const approved = authority.issueApprovalAfterTrustedUserConfirmation(proposal)
    const record = await executeApprovedCoreConformanceBench(approved, {
      authority,
      actionsDir: fx.actionsDir,
      dataDir: fx.dataDir,
      runBench: async () => ({ malformed: true } as never),
    })

    expect(record.status).toBe('failed')
    expect(record.operation.failure?.category).toBe('malformed-result')
    expect(record.operation.result).toBeNull()
  })

  it('fails closed when the shared action journal contains corrupt JSON', async () => {
    const fx = await makeRoot()
    const proposal = action({ actionId: 'act-corrupt-journal-001' })
    await recordCoreConformanceProposal(proposal, { actionsDir: fx.actionsDir })
    await writeFile(journalPath(fx.actionsDir), '{not-json}\n', { flag: 'a' })

    await expect(readCoreConformanceAction(proposal.actionId, { actionsDir: fx.actionsDir })).rejects.toMatchObject({ code: 'journal' })
  })

  it('rejects a result whose identity is not the approved action', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 15))
    const proposal = action({ actionId: 'act-identity-001' })
    const approved = authority.issueApprovalAfterTrustedUserConfirmation(proposal)
    const other = await runBenchTaskPackV1({ model: 'qwen3:8b', runId: 'other-run', fetchImpl: passingFetch(), timeoutMs: 1000 })
    const record = await executeApprovedCoreConformanceBench(approved, {
      authority,
      actionsDir: fx.actionsDir,
      dataDir: fx.dataDir,
      runBench: async () => other,
    })
    expect(record.status).toBe('failed')
    expect(record.operation.failure?.category).toBe('identity-mismatch')
    expect(record.operation.result).toBeNull()
  })
})

describe('trusted bridge and mobile projection', () => {
  it('proposes only the bounded action, returns a confirmation summary, and projects content-minimal status', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 16))
    await withBridgeDefaults(fx, passingFetch(), async () => {
      const bridge = createActionBridgeV1({ authority })
      const proposed = await bridge.proposeCoreConformance({ model: 'qwen3:8b', timeoutMs: 1000 })
      expect(proposed.confirmation).toMatchObject({
        title: 'Core conformance',
        model: 'qwen3:8b',
        runtime: 'Ollama local',
        checksPlanned: 6,
        network: 'Local only',
        apiCost: 'None',
        result: 'Saved to Bench history',
      })
      expect(proposed.confirmation).not.toHaveProperty('prompt')
      expect(proposed.confirmation).not.toHaveProperty('credentials')
      expect(proposed.confirmation.proposalDigest).toBe(proposed.proposal.approval.proposalDigest)

      const before = await bridge.status(proposed.proposal.actionId)
      expect(before?.status).toBe('proposed')
      const approved = authority.issueApprovalAfterTrustedUserConfirmation(proposed.proposal)
      const record = await bridge.executeCoreConformance(approved)
      const projection = await bridge.status(record.id)
      expect(projection).toMatchObject({
        contractVersion: 'metrora.action-mobile-projection.v1',
        schemaVersion: 1,
        actionId: record.id,
        kind: ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
        status: 'completed',
        runtime: { id: 'ollama-local', model: 'qwen3:8b' },
        pack: { selector: 'core-v1', packId: 'metrora.bench.core', version: '1.0.0', digest: CORE_TASK_PACK_V1.digest },
        planned: 6,
        completed: 6,
        resultCounts: { planned: 6, attempted: 6, passed: 6, failed: 0, unavailable: 0, cancelled: 0 },
      })
      expect(projection?.evidence?.resultDigest).toBe(record.operation.result?.resultDigest)
      expect(JSON.stringify(projection)).not.toContain('single lowercase word')
      expect(JSON.stringify(projection)).not.toContain('response')
      expect(JSON.stringify(projection)).not.toContain('credentials')
      expect(JSON.stringify(projection)).not.toContain('path')
      expect(projectActionForMobile(record)).toEqual(projection)
    })
  })

  it('does not allow a desktop bridge to execute a CLI-originated proposal', async () => {
    const fx = await makeRoot()
    const authority = new TrustedActionAuthorityV1(Buffer.alloc(32, 17))
    await withBridgeDefaults(fx, passingFetch(), async () => {
      const bridge = createActionBridgeV1({ authority })
      const cliProposal = createCoreConformanceBenchAction({ model: 'qwen3:8b', originatingSurface: 'cli', actionId: 'act-cli-001', createdAt: '2026-08-27T10:00:00.000Z', timeoutMs: 1000 })
      const approved = authority.issueApprovalAfterTrustedUserConfirmation(cliProposal)
      await expect(bridge.executeCoreConformance(approved)).rejects.toThrow(/desktop-originated/)
    })
  })

  it('reports an unstarted cancellation without pretending Bench ran', async () => {
    const fx = await makeRoot()
    const proposal = action({ actionId: 'act-cancel-before-run-001' })
    await recordCoreConformanceProposal(proposal, { actionsDir: fx.actionsDir })
    const cancellation = await cancelCoreConformanceBenchAction(proposal.actionId, { actionsDir: fx.actionsDir })
    expect(cancellation.status).toBe('cancelled')
    if (cancellation.status === 'cancelled') {
      expect(cancellation.record.operation.startedAt).toBeNull()
      expect(cancellation.record.operation.progress).toEqual({ planned: 6, completed: 0 })
      expect(cancellation.record.operation.result).toBeNull()
    }
  })

  it('does not silently reinterpret old file-mutation records', async () => {
    const fx = await makeRoot()
    const file = join(fx.root, 'legacy.txt')
    await writeFile(file, 'before')
    const oldRecord = await runAction({
      kind: 'model-default',
      description: 'old file action',
      changes: [{ op: 'edit', path: file, content: 'after' }],
    }, fx.actionsDir)
    expect(oldRecord.status).toBe('applied')
    await undoAction({ id: oldRecord.id }, { actionsDir: fx.actionsDir })
    expect(await readFile(file, 'utf8')).toBe('before')
    await recordCoreConformanceProposal(action({ actionId: 'new-action-001' }), { actionsDir: fx.actionsDir })
    const raw = await readFile(journalPath(fx.actionsDir), 'utf8')
    expect(raw).toContain('new-action-001')
    expect(raw).toContain('model-default')
  })

  it('does not let the legacy file-mutation path execute the controlled Bench kind', async () => {
    const fx = await makeRoot()
    const target = join(fx.root, 'must-not-write.txt')
    await expect(runAction({
      kind: 'run-core-conformance-bench',
      description: 'invalid file-mutation plan',
      changes: [{ op: 'create', path: target, content: 'nope' }],
    } as never, fx.actionsDir)).rejects.toThrow(/controlled operation/)
    await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
