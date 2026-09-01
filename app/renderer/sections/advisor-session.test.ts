import { describe, expect, it } from 'vitest'

import type { SwarmRunResultV1 } from '../../../src/swarm/contract-v1'
import { createAdvisorConformanceFixture } from '../advisor/conformance'
import { answerFromSwarmResult } from './advisor-session'

function swarmResult(): SwarmRunResultV1 {
  const worker = {
    contractVersion: 'metrora.swarm.v1' as const,
    schemaVersion: 1 as const,
    runId: 'run-session',
    workerId: 'run-session-worker-1',
    role: 'investigator' as const,
    profile: 'fixed-investigator-v1' as const,
    status: 'completed' as const,
    runtime: { id: 'opencode-zen', label: 'OpenCode Zen' },
    model: { id: 'model-a', label: 'model-a' },
    startedAt: '2026-08-31T00:00:00.000Z',
    endedAt: '2026-08-31T00:00:01.000Z',
    toolActivity: [],
    evidenceRefs: [],
    evidenceSummary: 'Canonical spend evidence is available.',
    answer: 'The measured total was $12.',
    artifactSummary: null,
    errors: [],
    usage: null,
    resultDigest: '',
  }
  return {
    contractVersion: 'metrora.swarm.v1',
    schemaVersion: 1,
    runId: 'run-session',
    task: 'What changed in spend?',
    status: 'completed',
    workers: [worker],
    synthesis: { status: 'completed', answer: 'The measured total was $999.', evidenceSummary: 'Unsafe synthesis fixture.', errors: [] },
    evidence: {
      schema: 'metrora.swarm-evidence.v1',
      schemaVersion: 1,
      runId: 'run-session',
      taskDigest: '',
      scopeDigest: '',
      workerCount: 1,
      workers: [{
        workerId: worker.workerId,
        role: worker.role,
        runtime: worker.runtime,
        model: worker.model,
        status: worker.status,
        allowedToolNames: ['get_spend_snapshot'],
        toolNamesUsed: [],
        startedAt: worker.startedAt,
        endedAt: worker.endedAt,
        resultDigest: '',
        answerDigest: '',
        usage: null,
      }],
      finalStatus: 'completed',
      cancellation: false,
      timeout: false,
      synthesis: { status: 'completed', answerDigest: null, evidenceDigest: null },
      methodology: {
        coordinator: 'metrora-harness-public-baseline-v1',
        assignments: 'fixed-transparent-roles-v1',
        runtimeSelection: 'manual-current-runtime-v1',
      },
      evidenceDigest: '',
    },
  }
}

describe('Swarm answer boundary', () => {
  it('keeps verified worker facts when synthesis invents a numeric value', () => {
    const fixture = createAdvisorConformanceFixture()
    const answer = answerFromSwarmResult(swarmResult(), fixture.scope, { id: 'opencode-zen', label: 'OpenCode Zen', mode: 'hosted-byok' })

    expect(answer.conclusion).toContain('$12')
    expect(answer.conclusion).not.toContain('$999')
    expect(answer.coverage.label).toBe('Worker completion: High')
    expect(answer.generatedByModel).toBe(false)
  })
})
