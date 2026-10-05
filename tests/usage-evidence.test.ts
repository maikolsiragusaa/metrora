import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { combineUsageEvidence } from '../src/token-semantics.js'
import { aggregateProjectsIntoDays, buildPeriodDataFromDays } from '../src/day-aggregator.js'
import { buildPeriodData } from '../src/period-data.js'
import { aggregateModels } from '../src/models-report.js'
import { emptyCache, loadDailyCache, saveDailyCache } from '../src/daily-cache.js'
import type { ProjectSummary } from '../src/types.js'
import type { UsageTokenEvidence } from '../src/token-semantics.js'

// ── fixtures (same shape as day-aggregator.test.ts) ────────────────────

function makeProject(sessions: ProjectSummary['sessions']): ProjectSummary {
  return {
    project: 'p',
    projectPath: '/p',
    totalCostUSD: sessions.reduce((s, sess) => s + sess.totalCostUSD, 0),
    totalApiCalls: sessions.reduce((s, sess) => s + sess.apiCalls, 0),
    sessions,
  }
}

function makeCall(
  timestamp: string,
  opts: { model?: string; provider?: string; usageEvidence?: UsageTokenEvidence; inputTokens?: number } = {},
) {
  return {
    provider: opts.provider ?? 'claude',
    model: opts.model ?? 'Opus 4.7',
    usage: {
      inputTokens: opts.inputTokens ?? 100,
      outputTokens: 200,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 50,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      webSearchRequests: 0,
    },
    costUSD: 0.5,
    tools: [],
    mcpTools: [],
    skills: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard' as const,
    timestamp,
    bashCommands: [],
    deduplicationKey: `dk-${timestamp}-${opts.usageEvidence ?? 'legacy'}`,
    ...(opts.usageEvidence ? { usageEvidence: opts.usageEvidence } : {}),
  }
}

function makeSingleTurnProject(assistantCalls: ReturnType<typeof makeCall>[]): ProjectSummary {
  const timestamp = assistantCalls[0]!.timestamp
  const totalCostUSD = assistantCalls.reduce((sum, call) => sum + call.costUSD, 0)
  return makeProject([{
    sessionId: 'session-1',
    project: 'p',
    firstTimestamp: timestamp,
    lastTimestamp: assistantCalls.at(-1)!.timestamp,
    totalCostUSD,
    totalInputTokens: assistantCalls.reduce((sum, call) => sum + call.usage.inputTokens, 0),
    totalOutputTokens: assistantCalls.reduce((sum, call) => sum + call.usage.outputTokens, 0),
    totalCacheReadTokens: assistantCalls.reduce((sum, call) => sum + call.usage.cacheReadInputTokens, 0),
    totalCacheWriteTokens: assistantCalls.reduce((sum, call) => sum + call.usage.cacheCreationInputTokens, 0),
    apiCalls: assistantCalls.length,
    turns: [{
      userMessage: 'usage evidence fixture',
      timestamp,
      sessionId: 'session-1',
      category: 'coding' as const,
      retries: 0,
      hasEdits: true,
      assistantCalls,
    }],
    modelBreakdown: {}, toolBreakdown: {}, mcpBreakdown: {}, bashBreakdown: {},
    categoryBreakdown: {} as never,
    skillBreakdown: {} as never,
  }])
}

// ── combine rule ───────────────────────────────────────────────────────

describe('combineUsageEvidence', () => {
  it('leaves an all-legacy set unmarked', () => {
    expect(combineUsageEvidence([undefined, undefined])).toBeUndefined()
    expect(combineUsageEvidence([])).toBeUndefined()
  })

  it('keeps a set complete when every evidenced record is complete', () => {
    expect(combineUsageEvidence(['complete', undefined, 'complete'])).toBe('complete')
  })

  it('degrades to the worst present class', () => {
    expect(combineUsageEvidence(['complete', 'partial'])).toBe('partial')
    expect(combineUsageEvidence(['complete', 'partial', 'unavailable'])).toBe('unavailable')
    expect(combineUsageEvidence(['complete', 'inconsistent'])).toBe('inconsistent')
  })
})

// ── aggregation surfaces ───────────────────────────────────────────────

describe('usage evidence across aggregations', () => {
  const T0 = '2026-10-04T10:00:00.000Z'
  const T1 = '2026-10-04T11:00:00.000Z'

  it('marks a mixed day partial and leaves an all-legacy day unmarked', () => {
    const mixed = makeSingleTurnProject([
      makeCall(T0),
      makeCall(T1, { provider: 'dsh', usageEvidence: 'partial' }),
    ])
    const legacy = makeSingleTurnProject([makeCall(T0), makeCall(T1)])
    const [mixedDay] = aggregateProjectsIntoDays([mixed])
    const [legacyDay] = aggregateProjectsIntoDays([legacy])
    expect(mixedDay.usageEvidence).toBe('partial')
    expect(legacyDay.usageEvidence).toBeUndefined()
  })

  it('never degrades a day for an explicitly reported zero', () => {
    // A DSH record with a reported zero input is complete evidence of zero.
    const zeroed = makeSingleTurnProject([
      makeCall(T0, { provider: 'dsh', usageEvidence: 'complete', inputTokens: 0 }),
      makeCall(T1),
    ])
    const [day] = aggregateProjectsIntoDays([zeroed])
    expect(day.usageEvidence).toBe('complete')
  })

  it('marks the durable period totals from mixed days', () => {
    const partial = makeSingleTurnProject([makeCall(T0, { provider: 'dsh', usageEvidence: 'partial' })])
    const clean = makeSingleTurnProject([makeCall(T1)])
    const days = aggregateProjectsIntoDays([partial, clean])
    const period = buildPeriodDataFromDays(days, 'Today')
    expect(period.usageEvidence).toBe('partial')

    const unavailable = makeSingleTurnProject([makeCall(T0, { provider: 'dsh', usageEvidence: 'unavailable' })])
    const periodWithGap = buildPeriodDataFromDays(aggregateProjectsIntoDays([unavailable, clean]), 'Today')
    expect(periodWithGap.usageEvidence).toBe('unavailable')
  })

  it('marks the live period totals and keeps legacy periods unmarked', () => {
    const mixed = makeSingleTurnProject([
      makeCall(T0),
      makeCall(T1, { provider: 'dsh', usageEvidence: 'partial' }),
    ])
    const period = buildPeriodData('Today', [mixed])
    expect(period.usageEvidence).toBe('partial')

    const legacy = buildPeriodData('Today', [makeSingleTurnProject([makeCall(T0), makeCall(T1)])])
    expect(usageEvidenceOf(legacy)).toBeUndefined()
  })

  it('marks a models report row from a mixed bucket', async () => {
    const mixed = makeSingleTurnProject([
      makeCall(T0, { model: 'Opus 4.7' }),
      makeCall(T1, { model: 'Opus 4.7', provider: 'dsh', usageEvidence: 'partial' }),
    ])
    const rows = await aggregateModels([mixed])
    // Buckets are keyed by (provider, model): the DSH call lands in its own row.
    const dshRow = rows.find(r => r.provider === 'dsh')
    const legacyRow = rows.find(r => r.provider === 'claude')
    expect(dshRow?.usageEvidence).toBe('partial')
    expect(legacyRow?.usageEvidence).toBeUndefined()
  })
})

function usageEvidenceOf(period: { usageEvidence?: UsageTokenEvidence }): UsageTokenEvidence | undefined {
  return period.usageEvidence
}

// ── real daily-cache round trip ────────────────────────────────────────

describe('usage evidence after a daily cache round trip', () => {
  let configDir: string

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'usage-evidence-cache-'))
    process.env['METRORA_CONFIG_DIR'] = configDir
  })

  afterEach(async () => {
    delete process.env['METRORA_CONFIG_DIR']
    await rm(configDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('survives save and load with a mixed complete/incomplete set', async () => {
    // Distinct calendar dates: two same-date days would collide in the cache.
    const partialDay = aggregateProjectsIntoDays([makeSingleTurnProject([
      makeCall('2026-10-02T10:00:00.000Z'),
      makeCall('2026-10-02T11:00:00.000Z', { provider: 'dsh', usageEvidence: 'partial' }),
    ])])[0]!
    const completeDay = aggregateProjectsIntoDays([makeSingleTurnProject([
      makeCall('2026-10-03T10:00:00.000Z', { usageEvidence: 'complete' }),
      makeCall('2026-10-03T11:00:00.000Z'),
    ])])[0]!

    const cache = emptyCache()
    cache.days = [partialDay, completeDay]
    await saveDailyCache(cache)

    // A reported zero stays complete after the round trip; the incomplete day
    // keeps its partial marker; the totals rebuilt from the loaded days stay
    // honest about the mixed set.
    const reloaded = await loadDailyCache()
    const loadedPartial = reloaded.days.find(d => d.date === partialDay.date)
    const loadedComplete = reloaded.days.find(d => d.date === completeDay.date)
    expect(loadedPartial?.usageEvidence).toBe('partial')
    expect(loadedComplete?.usageEvidence).toBe('complete')
    const rebuilt = buildPeriodDataFromDays(reloaded.days, 'Today')
    expect(rebuilt.usageEvidence).toBe('partial')
  })
})
