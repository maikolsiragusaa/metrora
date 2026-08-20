import { describe, expect, it } from 'vitest'

import { optimizeResultCacheKey } from '../src/optimize-cache-key.js'
import type { DateRange, ProjectSummary } from '../src/types.js'

function range(day = 1): DateRange {
  const padded = String(day).padStart(2, '0')
  return {
    start: new Date(`2026-07-${padded}T00:00:00Z`),
    end: new Date(`2026-07-${padded}T23:59:59Z`),
  }
}

function project(
  name: string,
  overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
  const session = {
    sessionId: `${name}-session`,
    project: name,
    firstTimestamp: '2026-07-01T10:00:00Z',
    lastTimestamp: '2026-07-01T10:30:00Z',
    totalCostUSD: 2,
    totalSavingsUSD: 0.5,
    totalInputTokens: 1_000,
    totalOutputTokens: 200,
    totalReasoningTokens: 50,
    totalCacheReadTokens: 100,
    totalCacheWriteTokens: 25,
    apiCalls: 2,
    turns: [],
    modelBreakdown: {},
    toolBreakdown: { Read: { calls: 1 } },
    mcpBreakdown: {},
    bashBreakdown: {},
    categoryBreakdown: {},
    skillBreakdown: {},
    subagentBreakdown: {},
  } as ProjectSummary['sessions'][number]

  return {
    project: name,
    projectPath: `/private/${name}`,
    sessions: [session],
    totalCostUSD: 2,
    totalSavingsUSD: 0.5,
    totalApiCalls: 2,
    totalProxiedCostUSD: 0,
    ...overrides,
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

describe('Optimize content-addressed result cache key', () => {
  it('is stable for an identical deep-equal dataset and scope', () => {
    const input = [project('alpha')]
    expect(optimizeResultCacheKey(input, range())).toBe(
      optimizeResultCacheKey(clone(input), range()),
    )
  })

  it('separates date scopes and the unbounded scope', () => {
    const input = [project('alpha')]
    expect(optimizeResultCacheKey(input, range(1))).not.toBe(
      optimizeResultCacheKey(input, range(2)),
    )
    expect(optimizeResultCacheKey(input, range(1))).not.toBe(
      optimizeResultCacheKey(input, undefined),
    )
  })

  it('separates same-shape datasets and repricing with unchanged call counts', () => {
    const before = [project('alpha')]
    const repriced = [project('alpha', { totalCostUSD: 9 })]
    expect(before[0]!.totalApiCalls).toBe(repriced[0]!.totalApiCalls)
    expect(optimizeResultCacheKey(before, range())).not.toBe(
      optimizeResultCacheKey(repriced, range()),
    )
  })

  it('separates savings and proxied-cost changes with unchanged calls', () => {
    const baseline = [project('alpha')]
    const savingsChanged = [project('alpha', { totalSavingsUSD: 3 })]
    const proxiedChanged = [project('alpha', { totalProxiedCostUSD: 1 })]
    expect(optimizeResultCacheKey(baseline, range())).not.toBe(
      optimizeResultCacheKey(savingsChanged, range()),
    )
    expect(optimizeResultCacheKey(baseline, range())).not.toBe(
      optimizeResultCacheKey(proxiedChanged, range()),
    )
  })

  it('separates token changes even when project totals and calls are unchanged', () => {
    const before = [project('alpha')]
    const after = clone(before)
    after[0]!.sessions[0]!.totalInputTokens += 1
    expect(optimizeResultCacheKey(before, range())).not.toBe(
      optimizeResultCacheKey(after, range()),
    )
  })

  it('separates breakdown changes even when aggregate totals are unchanged', () => {
    const reads = [project('alpha')]
    const edits = clone(reads)
    edits[0]!.sessions[0]!.toolBreakdown = { Edit: { calls: 1 } }
    expect(optimizeResultCacheKey(reads, range())).not.toBe(
      optimizeResultCacheKey(edits, range()),
    )
  })

  it('preserves project order as part of the result identity', () => {
    const first = project('alpha')
    const second = project('beta')
    expect(optimizeResultCacheKey([first, second], range())).not.toBe(
      optimizeResultCacheKey([second, first], range()),
    )
  })

  it('isolates provider scopes and normalizes the provider authority', () => {
    const input = [project('alpha')]
    expect(optimizeResultCacheKey(input, range(), 'claude')).not.toBe(
      optimizeResultCacheKey(input, range(), 'codex'),
    )
    expect(optimizeResultCacheKey(input, range(), 'all')).not.toBe(
      optimizeResultCacheKey(input, range(), 'codex'),
    )
    expect(optimizeResultCacheKey(input, range())).toBe(
      optimizeResultCacheKey(input, range(), ' ALL '),
    )
    expect(optimizeResultCacheKey(input, range(), ' CoDeX ')).toBe(
      optimizeResultCacheKey(input, range(), 'codex'),
    )
  })

  it('returns only version, scope, and digest without raw project content', () => {
    const key = optimizeResultCacheKey([project('secret-project')], range())
    expect(key).toMatch(/^optimize-project-summary-v2:all:\d+-\d+:[A-Za-z0-9_-]{43}$/)
    expect(key).not.toContain('secret-project')
    expect(key).not.toContain('/private/')
  })
})
