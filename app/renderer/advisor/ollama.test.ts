// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { OllamaAdvisorRuntime, type OllamaTransport } from './ollama'
import type { AdvisorEvidence, AdvisorScope } from './types'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}
const spendEvidence: AdvisorEvidence = {
  intent: 'spend-change',
  question: 'spend',
  scope,
  refs: [{ id: 'spend', label: 'Measured spend and call totals', source: 'overview' }],
  coverage: { level: 'high', label: 'High coverage', detail: 'Measured.' },
  assumptions: [],
  unknown: [],
  nextInvestigations: [],
  spend: {
    measuredCostUSD: 12,
    calls: 3,
    sessions: 2,
    models: [{ name: 'GPT-5.6', costUSD: 12, calls: 3 }],
    projects: [],
    sessionsByCost: [],
    trend: null,
    pricingCoverage: 1,
  },
}
const quotaEvidence: AdvisorEvidence = {
  intent: 'quota-capacity',
  question: 'quota',
  scope,
  refs: [{ id: 'quota', label: 'Provider-reported quota snapshot', source: 'quota' }],
  coverage: { level: 'high', label: 'High coverage', detail: 'Provider reported.' },
  assumptions: [],
  unknown: [],
  nextInvestigations: [],
  quota: {
    providers: [{
      provider: 'claude',
      planLabel: 'Pro',
      availability: 'available',
      connection: 'connected',
      freshness: 'fresh',
      observedAt: '2026-08-23T12:00:00Z',
      windows: [{ id: 'w1', label: '5-hour window', usedPercent: 20, remainingPercent: 80, resetsAt: '2026-08-23T15:00:00Z' }],
      creditsUSD: 0,
    }],
    measuredSpendUSD: 12,
    measuredCalls: 3,
  },
}
function transportFor(events: string[], calls: Array<Record<string, unknown>[]>): OllamaTransport {
  let listener: ((event: { requestId: string; text: string }) => void) | null = null
  let index = 0
  return {
    probe: async () => ({ available: true, models: ['llama3.2'], detail: 'Local Ollama is reachable.' }),
    cancel: async () => true,
    onDelta: callback => {
      listener = callback
      return () => { listener = null }
    },
    chat: async (requestId, payload) => {
      const current = index++
      if (current === 0) {
        listener?.({ requestId, text: 'Planning 99 calls' })
        return { streamed: false, message: { content: '', tool_calls: calls[0] } }
      }
      listener?.({ requestId, text: 'The observed pattern is worth investigating further.' })
      events.push(JSON.stringify({ model: payload.model, tools: payload.tools, stream: payload.stream }))
      return { streamed: true, message: { content: 'The observed pattern is worth investigating further.' } }
    },
  }
}
describe('Ollama Advisor renderer state machine', () => {
  it('runs one tool-planning request, one streamed final request, and retains all evidence domains', async () => {
    const events: string[] = []
    const transport = transportFor(events, [[
      { function: { name: 'get_spend_snapshot', arguments: '{}' } },
      { function: { name: 'get_quota_snapshot', arguments: '{}' } },
    ]])
    const runtime = new OllamaAdvisorRuntime({ model: 'llama3.2', transport })
    const deltas: string[] = []
    const answer = await runtime.generate({
      question: 'What changed and what quota remains?',
      evidence: spendEvidence,
      tools: [{
        type: 'function',
        function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } },
      }, {
        type: 'function',
        function: { name: 'get_quota_snapshot', description: 'quota', parameters: { type: 'object' } },
      }],
      executeTool: async name => ({ content: name === 'get_spend_snapshot' ? 'spend' : 'quota', evidence: name === 'get_spend_snapshot' ? spendEvidence : quotaEvidence }),
      onDelta: text => deltas.push(text),
    })

    expect(JSON.parse(events[0]!).stream).toBe(true)
    expect(JSON.parse(events[0]!).tools).toEqual([])
    expect(answer.generatedByModel).toBe(true)
    expect(answer.streamed).toBe(true)
    expect(answer.evidence.map(ref => ref.id)).toEqual(['spend', 'quota'])
    expect(answer.details.some(detail => detail.includes('provider credits remaining'))).toBe(true)
    expect(answer.conclusion).toContain('Metrora measured')
    expect(answer.conclusion).not.toContain('99 calls')
    expect(answer.conclusion).toContain('Local model context')
    expect(deltas).toEqual(['The observed pattern is worth investigating further.'])
  })

  it('keeps model identifiers while rejecting an unverified numeric model claim', async () => {
    const transport = transportFor([], [[]])
    const answer = await new OllamaAdvisorRuntime({ model: 'llama3.2', transport }).generate({
      question: 'Which model should I inspect?',
      evidence: spendEvidence,
      tools: [],
      onDelta: () => {},
    })
    expect(answer.conclusion).toContain('GPT-5.6')
  })
})
