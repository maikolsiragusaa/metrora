import { describe, expect, it } from 'vitest'

import { aggregateAudit } from '../src/audit-report.js'
import { aggregateModelStats } from '../src/compare-stats.js'
import { aggregateProjectsIntoDays, buildPeriodDataFromDays } from '../src/day-aggregator.js'
import { aggregateModelPerformanceByRoute } from '../src/model-performance.js'
import { buildModelAccounting } from '../src/model-accounting.js'
import { buildModelPresentation } from '../src/model-presentation.js'
import { aggregateModels } from '../src/models-report.js'
import { aggregateSessions } from '../src/session-projection.js'
import { billableOutputTokens, generatedTokensForReasoningMix } from '../src/token-semantics.js'
import { calculateCost } from '../src/models.js'
import type { ClassifiedTurn, ParsedApiCall, ProjectSummary, SessionSummary, TokenUsage } from '../src/types.js'

const TIMESTAMP = '2026-08-20T10:00:00.000Z'

function usage(inputTokens: number, outputTokens: number, reasoningTokens: number): TokenUsage {
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens,
    webSearchRequests: 0,
  }
}

function call(
  provider: string,
  reasoningSemantics: 'aggregate-output' | 'separate',
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  costUSD: number,
): ParsedApiCall {
  return {
    provider,
    model: 'mixed-model',
    usage: usage(inputTokens, outputTokens, reasoningTokens),
    reasoningSemantics,
    costUSD,
    tools: [],
    mcpTools: [],
    skills: [],
    subagentTypes: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: TIMESTAMP,
    bashCommands: [],
    deduplicationKey: `${provider}-mixed-call`,
    activeDurationMs: 10,
  }
}

function projectWithCalls(calls: ParsedApiCall[]): ProjectSummary {
  const turn: ClassifiedTurn = {
    userMessage: 'synthetic mixed reasoning fixture',
    assistantCalls: calls,
    timestamp: TIMESTAMP,
    sessionId: 'mixed-session',
    category: 'coding',
    retries: 0,
    hasEdits: false,
  }
  const session: SessionSummary = {
    sessionId: 'mixed-session',
    project: 'synthetic-project',
    firstTimestamp: TIMESTAMP,
    lastTimestamp: TIMESTAMP,
    totalCostUSD: calls.reduce((sum, item) => sum + item.costUSD, 0),
    totalSavingsUSD: 0,
    totalInputTokens: calls.reduce((sum, item) => sum + item.usage.inputTokens, 0),
    totalOutputTokens: calls.reduce((sum, item) => sum + item.usage.outputTokens, 0),
    totalReasoningTokens: calls.reduce((sum, item) => sum + item.usage.reasoningTokens, 0),
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    apiCalls: calls.length,
    turns: [turn],
    modelBreakdown: {},
    toolBreakdown: {},
    mcpBreakdown: {},
    bashBreakdown: {},
    categoryBreakdown: {},
    skillBreakdown: {},
    subagentBreakdown: {},
  }
  return {
    project: 'synthetic-project',
    projectPath: '/synthetic-project',
    sessions: [session],
    totalCostUSD: session.totalCostUSD,
    totalSavingsUSD: 0,
    totalApiCalls: calls.length,
    totalProxiedCostUSD: 0,
  }
}

describe('mixed reasoning aggregation', () => {
  const copilotCall = call('copilot', 'aggregate-output', 10, 100, 20, calculateCost('gpt-4.1', 10, 100, 0, 0, 0))
  const separateCall = call('codex', 'separate', 20, 100, 30, calculateCost('gpt-4.1', 20, 130, 0, 0, 0))
  const project = projectWithCalls([copilotCall, separateCall])

  it('keeps the true generated total at 230 across live, session, and daily model views', async () => {
    const modelRows = await aggregateModels([project])
    expect(modelRows.reduce((sum, row) => sum + row.outputTokens + (row.reasoningTokens ?? 0), 0)).toBe(230)
    expect(modelRows.find(row => row.provider === 'copilot')).toMatchObject({ outputTokens: 100, reasoningTokens: 0, reasoningSemantics: 'aggregate-output' })
    expect(modelRows.find(row => row.provider === 'codex')).toMatchObject({ outputTokens: 100, reasoningTokens: 30, reasoningSemantics: 'separate' })

    const compare = aggregateModelStats([project])[0]!
    expect(compare).toMatchObject({ outputTokens: 200, reasoningTokens: 30, reasoningSemantics: 'mixed' })
    expect(compare.outputTokens + compare.reasoningTokens).toBe(230)

    const session = aggregateSessions([project])[0]!
    expect(session).toMatchObject({ outputTokens: 200, reasoningTokens: 30, reasoningSemantics: 'mixed' })
    expect(session.outputTokens + (session.reasoningTokens ?? 0)).toBe(230)

    const day = aggregateProjectsIntoDays([project])[0]!
    expect(day.outputTokens).toBe(200)
    expect(day.reasoningTokens).toBe(30)
    expect(day.models['mixed-model']).toMatchObject({ outputTokens: 200, reasoningTokens: 30, reasoningSemantics: 'mixed' })
    const period = buildPeriodDataFromDays([day], 'synthetic')
    expect(period.models[0]).toMatchObject({ outputTokens: 200, reasoningTokens: 30, reasoningSemantics: 'mixed' })
    expect(period.models[0]!.outputTokens! + period.models[0]!.reasoningTokens!).toBe(230)

    const accounting = buildModelAccounting(period.models, period.cost, period.calls)
    expect(accounting.rows[0]).toMatchObject({ outputTokens: 200, reasoningTokens: 30, reasoningSemantics: 'mixed' })
    expect(accounting.rows[0]!.outputTokens + (accounting.rows[0]!.reasoningTokens ?? 0)).toBe(230)
    const presentation = buildModelPresentation(accounting)
    expect(presentation.rows[0]).toMatchObject({ outputTokens: 200, reasoningTokens: 30, reasoningSemantics: 'mixed' })
    expect(presentation.rows[0]!.outputTokens + (presentation.rows[0]!.reasoningTokens ?? 0)).toBe(230)
  })

  it('keeps raw audit evidence while displaying only separately additive reasoning', async () => {
    const rows = await aggregateAudit([project])
    expect(rows).toHaveLength(2)
    expect(rows.reduce((sum, row) => sum + row.raw.reasoningTokens, 0)).toBe(50)
    expect(rows.reduce((sum, row) => sum + row.displayed.outputTokens, 0)).toBe(230)
    expect(rows.find(row => row.provider === 'copilot')!.displayed.outputTokens).toBe(100)
    expect(rows.find(row => row.provider === 'codex')!.displayed.outputTokens).toBe(130)
  })

  it('uses the same 230 generated-token denominator for observed performance', () => {
    const routes = aggregateModelPerformanceByRoute([project]).get('mixed-model')!
    expect(routes.get('collector:copilot')?.activeGeneratedTokens).toBe(100)
    expect(routes.get('collector:codex')?.activeGeneratedTokens).toBe(130)
    expect([...routes.values()].reduce((sum, value) => sum + value.activeGeneratedTokens, 0)).toBe(230)
  })

  it('prices Copilot OTel output once and never treats reasoning as a second output bucket', () => {
    const aggregateOutput = billableOutputTokens('copilot', 100, 20, 'aggregate-output')
    const separateOutput = billableOutputTokens('codex', 100, 30, 'separate')
    expect(aggregateOutput).toBe(100)
    expect(separateOutput).toBe(130)
    expect(calculateCost('gpt-4.1', 10, aggregateOutput, 0, 0, 0)).toBe(calculateCost('gpt-4.1', 10, 100, 0, 0, 0))
    expect(generatedTokensForReasoningMix(100, 20, 'aggregate-output')).toBe(100)
    expect(generatedTokensForReasoningMix(100, 30, 'separate')).toBe(130)
  })
})
