import { describe, expect, it } from 'vitest'
import { buildSwarmEvidenceV1, canonicalSwarmJson, createSwarmDigest, sanitizeSwarmText } from '../src/swarm/evidence-v1'
import type { SwarmWorkerResultV1 } from '../src/swarm/contract-v1'

const worker = (status: SwarmWorkerResultV1['status'] = 'completed'): SwarmWorkerResultV1 => ({
  contractVersion: 'metrora.swarm.v1',
  schemaVersion: 1,
  runId: 'run-evidence',
  workerId: 'run-evidence-worker-1',
  role: 'investigator',
  profile: 'fixed-investigator-v1',
  status,
  runtime: { id: 'llama-server', label: 'llama-server local' },
  model: { id: 'model-a', label: 'Model A' },
  startedAt: '2026-08-31T00:00:00.000Z',
  endedAt: '2026-08-31T00:00:01.000Z',
  toolActivity: [{ name: 'get_spend_snapshot', status: 'completed' }],
  evidenceRefs: [{ id: 'spend', label: 'Spend snapshot' }],
  evidenceSummary: 'safe factual summary',
  answer: 'safe bounded answer',
  artifactSummary: null,
  errors: status === 'completed' ? [] : ['unavailable'],
  usage: { inputTokens: 12, outputTokens: 5, costUsd: null },
  resultDigest: '',
})

describe('Swarm evidence v1', () => {
  it('produces a deterministic digest from canonical JSON', async () => {
    expect(canonicalSwarmJson({ b: 2, a: 1 })).toBe(canonicalSwarmJson({ a: 1, b: 2 }))
    expect(await createSwarmDigest({ b: 2, a: 1 })).toBe(await createSwarmDigest({ a: 1, b: 2 }))
  })

  it('keeps evidence bounded and excludes raw task, path, secret, and CoT fields', async () => {
    const evidence = await buildSwarmEvidenceV1({
      request: {
        runId: 'run-evidence',
        task: 'Inspect C:\\Users\\founder\\secret-project with token=super-secret.',
        scope: { period: 'today', project: 'all' },
        allowedToolNames: ['get_spend_snapshot'],
      },
      workers: [worker()],
      finalStatus: 'completed',
      synthesis: { status: 'completed', answer: 'final answer', evidenceSummary: 'summary', errors: [] },
      cancellation: false,
      timeout: false,
    })
    const serialized = JSON.stringify(evidence)
    expect(evidence.schema).toBe('metrora.swarm-evidence.v1')
    expect(serialized).not.toContain('secret-project')
    expect(serialized).not.toContain('super-secret')
    expect(serialized).not.toContain('chainOfThought')
    expect(serialized).not.toContain('rawPrompt')
    expect(evidence.taskDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(evidence.workers[0]?.usage).toEqual({ inputTokens: 12, outputTokens: 5, costUsd: null })
    expect(evidence.workers[0]?.resultDigest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('records partial and cancelled states without retaining worker prose', async () => {
    const evidence = await buildSwarmEvidenceV1({
      request: { runId: 'run-partial', task: 'task', scope: {}, allowedToolNames: [] },
      workers: [worker('partial'), { ...worker('cancelled'), workerId: 'run-partial-worker-2', role: 'verifier' }],
      finalStatus: 'cancelled',
      synthesis: null,
      cancellation: true,
      timeout: false,
    })
    expect(evidence.finalStatus).toBe('cancelled')
    expect(evidence.cancellation).toBe(true)
    expect(evidence.workers.map(item => item.status)).toEqual(['partial', 'cancelled'])
    expect(JSON.stringify(evidence)).not.toContain('safe bounded answer')
  })

  it('sanitizes path and credential-like event text', () => {
    expect(sanitizeSwarmText('read C:\\Users\\founder\\file.txt token=abc')).toBe('read [path] [redacted]')
  })
})
