import { describe, expect, it, vi } from 'vitest'

import type { AdvisorEvidence, AdvisorScope } from '../advisor/types'
import { classifyMetroraProvenance } from './provenance'
import { runMetroraAgentLoop } from './loop'
import type { MetroraAgentLoopBounds, MetroraAgentModelStep, MetroraAgentToolCall, MetroraAgentToolResult } from './contracts'

const scope: AdvisorScope = {
  period: 'lifetime',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

const spendEvidence: AdvisorEvidence = {
  intent: 'spend-change',
  question: 'How much did I spend over $4,000?',
  scope,
  refs: [{ id: 'overview.current', label: 'Measured spend and call totals', source: 'overview' }],
  coverage: { level: 'high', label: 'High coverage', detail: 'Measured spend is available.' },
  assumptions: [],
  unknown: [],
  nextInvestigations: [],
  spend: {
    measuredCostUSD: 4_120.46,
    calls: 42,
    sessions: 3,
    models: [{ name: 'GPT-5.6', costUSD: 4_120.46, calls: 42 }],
    projects: [],
    sessionsByCost: [],
    trend: null,
    pricingCoverage: 1,
    history: [],
    modelHistory: [],
  },
}

const bounds: MetroraAgentLoopBounds = {
  maxSteps: 4,
  maxCallsPerStep: 4,
  maxCallsPerTurn: 4,
  maxToolRounds: 3,
  maxParallelToolCalls: 1,
  turnTimeoutMs: 1_000,
  maxContentBytes: 32 * 1024,
  maxLedgerMessages: 32,
}

const spendTool = { type: 'function', function: { name: 'get_spend_snapshot', description: 'read spend', parameters: { type: 'object' } } }

function step(content: string): MetroraAgentModelStep {
  return { kind: 'final-text', content, calls: [] }
}

function toolStep(...calls: MetroraAgentToolCall[]): MetroraAgentModelStep {
  return { kind: 'tool-calls', content: '', calls }
}

function result(evidence: AdvisorEvidence = spendEvidence): MetroraAgentToolResult {
  return { content: JSON.stringify({ measured: true }), evidence, evidenceStatus: 'usable' }
}

function call(id: string, name = 'get_spend_snapshot'): MetroraAgentToolCall {
  return { id, name, arguments: {} }
}

function run(options: Partial<Parameters<typeof runMetroraAgentLoop>[0]> & { complete: Parameters<typeof runMetroraAgentLoop>[0]['complete'] }) {
  return runMetroraAgentLoop({
    bounds,
    ledger: [{ role: 'user', content: 'How much did I spend?' }],
    tools: [spendTool],
    executeTool: async () => result(),
    ...options,
  })
}

describe('MetroraAgentLoop', () => {
  it('returns a direct no-Tool answer and records the assistant step', async () => {
    const output = await run({ complete: async () => step('A bounded direct answer.') })
    expect(output.status).toBe('completed')
    expect(output.toolCalls).toBe(0)
    expect(output.finalText).toBe('A bounded direct answer.')
    expect(output.ledger.at(-1)).toMatchObject({ role: 'assistant', content: 'A bounded direct answer.' })
  })

  it('executes one Tool, appends its result, and continues naturally', async () => {
    const ledgers: string[][] = []
    let count = 0
    const output = await run({
      complete: async context => {
        ledgers.push(context.ledger.map(message => message.role + ':' + message.content))
        count += 1
        return count === 1 ? toolStep(call('spend-1')) : step('The measured spend is available for a natural explanation.')
      },
    })
    expect(output.status).toBe('completed')
    expect(output.toolCalls).toBe(1)
    expect(ledgers[1]?.some(entry => entry.startsWith('tool:{"measured":true}'))).toBe(true)
    expect(output.finalText).toContain('natural explanation')
  })

  it('supports a bounded two-step Tool chain', async () => {
    const calls: string[] = []
    let stepNumber = 0
    const output = await run({
      tools: [spendTool, { type: 'function', function: { name: 'get_quota_snapshot', description: 'read quota', parameters: { type: 'object' } } }],
      complete: async () => {
        stepNumber += 1
        if (stepNumber === 1) return toolStep(call('spend-1'))
        if (stepNumber === 2) return toolStep(call('quota-1', 'get_quota_snapshot'))
        return step('Spend and quota were reviewed in the same bounded turn.')
      },
      executeTool: async current => {
        calls.push(current.name)
        return result()
      },
    })
    expect(output.status).toBe('completed')
    expect(calls).toEqual(['get_spend_snapshot', 'get_quota_snapshot'])
    expect(output.toolRounds).toBe(2)
  })

  it('executes a required baseline read when the model answers prematurely', async () => {
    const seen: string[][] = []
    const output = await run({
      requiredToolCalls: [call('required-spend')],
      requiredEvidenceReady: false,
      complete: async context => {
        seen.push(context.ledger.map(message => message.role + ':' + message.content))
        return seen.length === 1 ? step('I can answer before reading.') : step('The canonical spend result supports the final answer.')
      },
    })
    expect(output.status).toBe('completed')
    expect(output.toolCalls).toBe(1)
    expect(seen[1]?.some(value => value.includes('{"measured":true}'))).toBe(true)
    expect(output.finalText).toContain('canonical spend')
  })

  it('never executes a Tool outside the allowlist', async () => {
    const execute = vi.fn(async () => result())
    const output = await run({
      complete: async context => context.step === 1 ? toolStep(call('bad-1', 'delete_everything')) : step('The requested operation was unavailable.'),
      executeTool: execute,
    })
    expect(execute).not.toHaveBeenCalled()
    expect(output.diagnostics).toContain('tool_not_allowlisted')
    expect(output.ledger.some(message => message.role === 'tool' && message.content.includes('unavailable'))).toBe(true)
  })

  it('enforces per-step and per-turn Tool limits', async () => {
    const execute = vi.fn(async () => result())
    const output = await run({
      bounds: { ...bounds, maxCallsPerStep: 1, maxCallsPerTurn: 1 },
      complete: async () => toolStep(call('one'), call('two')),
      executeTool: execute,
    })
    expect(output.status).toBe('limit')
    expect(execute).toHaveBeenCalledOnce()
    expect(output.diagnostics).toContain('tool_limit')
  })

  it('preserves exact call IDs and deterministic result order', async () => {
    const output = await run({
      tools: [spendTool, { type: 'function', function: { name: 'get_quota_snapshot', description: 'read quota', parameters: { type: 'object' } } }],
      complete: async context => context.step === 1 ? toolStep(call('first'), call('second', 'get_quota_snapshot')) : step('Both reads completed.'),
      executeTool: async current => result(current.name === 'get_spend_snapshot' ? spendEvidence : { ...spendEvidence, refs: [{ id: 'quota', label: 'Quota', source: 'quota' }], quota: { providers: [], measuredSpendUSD: null, measuredCalls: null } }),
    })
    const toolMessages = output.ledger.filter(message => message.role === 'tool')
    expect(toolMessages.map(message => message.toolCallId)).toEqual(['first', 'second'])
  })

  it('returns a truthful model-visible Tool failure and can finish', async () => {
    const output = await run({
      complete: async context => context.step === 1 ? toolStep(call('failed')) : step('The canonical read was unavailable, so no factual conclusion is asserted.'),
      executeTool: async () => { throw new Error('canonical source unavailable') },
    })
    expect(output.status).toBe('completed')
    expect(output.diagnostics).toContain('tool_execution_failed')
    expect(output.ledger.at(-1)?.content).toContain('no factual conclusion')
  })

  it('terminates on a turn timeout and consumes a late model settlement', async () => {
    vi.useFakeTimers()
    try {
      let resolve: (() => void) | undefined
      const outputPromise = run({
        bounds: { ...bounds, turnTimeoutMs: 10 },
        complete: async () => new Promise<MetroraAgentModelStep>(finish => { resolve = () => finish(step('late')) }),
      })
      await vi.advanceTimersByTimeAsync(10)
      const output = await outputPromise
      expect(output.status).toBe('timeout')
      resolve?.()
      expect(output.finalText).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels without publishing a late Tool or model result', async () => {
    const controller = new AbortController()
    let resolve: ((value: MetroraAgentModelStep) => void) | undefined
    const promise = run({
      signal: controller.signal,
      complete: async () => new Promise<MetroraAgentModelStep>(finish => { resolve = finish }),
    })
    controller.abort()
    const output = await promise
    resolve?.(step('late result'))
    expect(output.status).toBe('cancelled')
    expect(output.finalText).toBe('')
    expect(output.ledger.some(message => message.content === 'late result')).toBe(false)
  })
})

describe('Metrora provenance classification', () => {
  it('accepts canonical facts combined with a user-provided threshold', () => {
    const result = classifyMetroraProvenance('Metrora measured $4,120.46, which exceeds your $4,000 threshold.', 'Did I spend more than $4,000?', [spendEvidence])
    expect(result.accepted).toBe(true)
    expect(result.usedCanonicalFact).toBe(true)
    expect(result.usedUserFact).toBe(true)
  })

  it('accepts a deterministic derived difference', () => {
    const result = classifyMetroraProvenance('That is $120.46 above your threshold.', 'Did I spend more than $4,000?', [spendEvidence])
    expect(result.accepted).toBe(true)
    expect(result.usedDerivation).toBe(true)
  })

  it('accepts grounded interpretation and recommendation', () => {
    const result = classifyMetroraProvenance('I consider this a significant amount; I would inspect model concentration.', 'Did I spend more than $4,000?', [spendEvidence])
    expect(result.accepted).toBe(true)
    expect(result.usedInterpretation).toBe(true)
  })

  it('removes an invented number while retaining useful supported prose', () => {
    const result = classifyMetroraProvenance('The total was $9,999. I consider this a significant amount.', 'How much did I spend?', [spendEvidence])
    expect(result.accepted).toBe(true)
    expect(result.removedClauses).toBe(1)
    expect(result.text).not.toContain('9,999')
    expect(result.text).toContain('significant amount')
    expect(result.diagnostics).toContain('unsupported_numeric_claim')
  })

  it('rejects unsupported causality even when the number itself is canonical', () => {
    const result = classifyMetroraProvenance('GPT-5.6 caused the $4,120.46 spend.', 'How much did I spend?', [spendEvidence])
    expect(result.accepted).toBe(false)
    expect(result.diagnostics).toContain('unsupported_causality')
  })
})
