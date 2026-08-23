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
function transportFor(events: string[], calls: Array<Record<string, unknown>[]>, finalContent = 'The observed pattern is worth investigating further.', finalDelta = finalContent): OllamaTransport {
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
      listener?.({ requestId, text: finalDelta })
      events.push(JSON.stringify({ model: payload.model, tools: payload.tools, stream: payload.stream }))
      return { streamed: true, message: { content: finalContent } }
    },
  }
}
function noToolTransport(content: string): OllamaTransport {
  return {
    probe: async () => ({ available: true, models: ['llama3.2'], detail: 'ready' }),
    cancel: async () => true,
    onDelta: () => () => {},
    chat: async () => ({ streamed: false, message: { content, tool_calls: [] } }),
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

  it.each(['Spend rose by 12.', 'The scope contains 12 calls.'])(
    'suppresses the entire model narrative when it contains an unverified numeric token: %s',
    async narrative => {
      const transport = transportFor([], [[{ function: { name: 'get_spend_snapshot', arguments: '{}' } }]], narrative, narrative)
      const answer = await new OllamaAdvisorRuntime({ model: 'llama3.2', transport }).generate({
        question: 'What changed in spend?',
        evidence: spendEvidence,
        tools: [{ type: 'function', function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }],
        executeTool: async () => ({ content: 'spend', evidence: spendEvidence }),
      })
      expect(answer.conclusion).not.toContain('Local model context')
      expect(answer.conclusion).not.toContain(narrative)
    },
  )

  it('suppresses qualitative no-tool context even when recognized evidence was prefetched', async () => {
    const narrative = 'The observed pattern deserves a closer look.'
    const answer = await new OllamaAdvisorRuntime({ model: 'llama3.2', transport: noToolTransport(narrative) }).generate({
      question: 'What changed in spend?', evidence: spendEvidence, tools: [],
    })
    expect(answer.conclusion).not.toContain(narrative)
    expect(answer.conclusion).not.toContain('Local model context')
  })

  it('does not expose numeric streamed deltas before final narrative validation', async () => {
    const deltas: string[] = []
    const transport = transportFor([], [[{ function: { name: 'get_spend_snapshot', arguments: '{}' } }]], 'A qualitative observation.', 'Planning found 99 calls.')
    await new OllamaAdvisorRuntime({ model: 'llama3.2', transport }).generate({
      question: 'What changed in spend?', evidence: spendEvidence,
      tools: [{ type: 'function', function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }],
      executeTool: async () => ({ content: 'spend', evidence: spendEvidence }),
      onDelta: text => deltas.push(text),
    })
    expect(deltas).toEqual([])
  })

  it('suppresses no-tool model narrative when the question has no valid mapped evidence', async () => {
    const unknown: AdvisorEvidence = {
      ...spendEvidence,
      intent: 'unknown',
      refs: [],
      coverage: { level: 'unavailable', label: 'Unavailable', detail: 'No mapped evidence.' },
      spend: undefined,
    }
    const narrative = 'Trust me, this is definitely the cause.'
    const answer = await new OllamaAdvisorRuntime({ model: 'llama3.2', transport: noToolTransport(narrative) }).generate({
      question: 'Tell me a joke', evidence: unknown, tools: [],
    })
    expect(answer.conclusion).not.toContain(narrative)
    expect(answer.conclusion).not.toContain('Local model context')
  })

  it.each([
    ['claude', 'codex'],
    ['codex', 'claude'],
  ])('rejects mixed-scope tool evidence without cross-scope contamination (%s then %s)', async (first, second) => {
    const finalRequests: string[] = []
    const transport = transportFor(finalRequests, [[
      { function: { name: 'get_spend_snapshot', arguments: { provider: first } } },
      { function: { name: 'get_spend_snapshot', arguments: { provider: second } } },
    ]])
    const answer = await new OllamaAdvisorRuntime({ model: 'llama3.2', transport }).generate({
      question: 'Compare spend',
      evidence: spendEvidence,
      tools: [{ type: 'function', function: { name: 'get_spend_snapshot', description: 'spend', parameters: { type: 'object' } } }],
      executeTool: async (_name, args) => {
        const provider = String(args.provider)
        const evidence: AdvisorEvidence = {
          ...spendEvidence,
          scope: { ...scope, provider },
          refs: [{ id: 'spend-' + provider, label: provider + ' spend', source: 'overview' }],
          spend: { ...spendEvidence.spend!, measuredCostUSD: provider === 'claude' ? 41 : 73 },
        }
        return { content: provider, evidence }
      },
    })

    expect(answer.coverage).toMatchObject({ level: 'unavailable', label: 'Conflicting evidence scopes' })
    expect(answer.evidence).toEqual([])
    expect(answer.scopeLabel).toContain('All providers')
    expect(answer.conclusion).not.toMatch(/41|73|claude spend|codex spend/i)
    expect(answer.details.join(' ')).not.toMatch(/41|73|claude spend|codex spend/i)
    expect(finalRequests).toEqual([])
  })
})
