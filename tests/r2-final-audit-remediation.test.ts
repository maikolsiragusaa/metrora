import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  BACKFILL_DAYS,
  DAILY_CACHE_RETENTION_DAYS,
  DURABLE_HISTORY_AUTHORITY,
  ensureCacheHydrated,
  type DailyEntry,
} from '../src/daily-cache.js'
import { aggregateProjectsIntoDays } from '../src/day-aggregator.js'
import type { ProjectSummary } from '../src/types.js'

let cacheDir: string
let previousCacheDir: string | undefined
let previousTz: string | undefined

const NOW = new Date('2026-08-12T12:00:00.000Z')

function daysAgo(days: number): string {
  const date = new Date(NOW)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function syntheticAntigravityProject(daysAgoCount: number, id: string, tokens: { input: number; output: number; reasoning: number }): ProjectSummary {
  const timestamp = daysAgo(daysAgoCount)
  const call = {
    provider: 'antigravity',
    model: 'gemini-3.6-flash',
    modelProvider: 'google',
    usage: {
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      reasoningTokens: tokens.reasoning,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cachedInputTokens: 0,
      webSearchRequests: 0,
    },
    costUSD: 1,
    savingsUSD: 0,
    tools: [],
    mcpTools: [],
    skills: [],
    subagentTypes: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp,
    bashCommands: [],
    deduplicationKey: `antigravity:${id}`,
  }
  const turn = {
    userMessage: '',
    assistantCalls: [call],
    timestamp,
    sessionId: id,
    category: 'coding' as const,
    retries: 0,
    hasEdits: false,
  }
  const session = {
    sessionId: id,
    project: 'antigravity-remediation-fixture',
    firstTimestamp: timestamp,
    lastTimestamp: timestamp,
    totalCostUSD: 1,
    totalSavingsUSD: 0,
    totalInputTokens: tokens.input,
    totalOutputTokens: tokens.output,
    totalReasoningTokens: tokens.reasoning,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    apiCalls: 1,
    turns: [turn],
  }
  return {
    project: 'antigravity-remediation-fixture',
    projectPath: 'C:/metrora/r2-fixture',
    sessions: [session],
    totalCostUSD: 1,
    totalSavingsUSD: 0,
    totalApiCalls: 1,
    totalProxiedCostUSD: 0,
  } as unknown as ProjectSummary
}

function total(dayEntries: DailyEntry[]): { calls: number; input: number; output: number; reasoning: number } {
  return dayEntries.reduce((sum, day) => ({
    calls: sum.calls + day.calls,
    input: sum.input + day.inputTokens,
    output: sum.output + day.outputTokens,
    reasoning: sum.reasoning + (day.reasoningTokens ?? 0),
  }), { calls: 0, input: 0, output: 0, reasoning: 0 })
}

function parseWithin(projects: ProjectSummary[], ranges: { start: Date; end: Date }[]) {
  return async (range: { start: Date; end: Date }): Promise<ProjectSummary[]> => {
    ranges.push(range)
    return projects.filter(project => project.sessions.some(session => {
      const timestamp = new Date(session.firstTimestamp)
      return timestamp >= range.start && timestamp <= range.end
    }))
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  cacheDir = ''
  previousCacheDir = process.env['METRORA_CACHE_DIR']
  previousTz = process.env['TZ']
  process.env['METRORA_CACHE_DIR'] = ''
  process.env['TZ'] = 'Europe/Rome'
})

afterEach(async () => {
  vi.useRealTimers()
  if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = previousCacheDir
  if (previousTz === undefined) delete process.env['TZ']
  else process.env['TZ'] = previousTz
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true })
})

describe('R2 durable cold-bootstrap remediation', () => {
  it('reconciles physical durable responses through the full retention horizon once, then stays incremental', async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'metrora-r2-remediation-'))
    process.env['METRORA_CACHE_DIR'] = cacheDir

    const physicalProjects = [
      syntheticAntigravityProject(91, 'response-91d', { input: 11, output: 7, reasoning: 3 }),
      syntheticAntigravityProject(366, 'response-366d', { input: 13, output: 8, reasoning: 4 }),
      syntheticAntigravityProject(3649, 'response-3649d', { input: 17, output: 9, reasoning: 5 }),
    ]
    const physical = total(aggregateProjectsIntoDays(physicalProjects))
    const ranges: { start: Date; end: Date }[] = []

    const cold = await ensureCacheHydrated(
      parseWithin(physicalProjects, ranges),
      aggregateProjectsIntoDays,
      'cfg-A',
      () => true,
      undefined,
      { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY },
    )

    expect(ranges).toHaveLength(1)
    expect(ranges[0]!.start.getTime()).toBeLessThan(NOW.getTime() - (BACKFILL_DAYS + 1) * 24 * 60 * 60 * 1000)
    expect(ranges[0]!.start.getTime()).toBeGreaterThan(NOW.getTime() - (DAILY_CACHE_RETENTION_DAYS + 2) * 24 * 60 * 60 * 1000)
    expect(cold.durableHistoryAuthority).toBe(DURABLE_HISTORY_AUTHORITY)
    expect(total(cold.days)).toEqual(physical)
    expect(cold.days.map(day => day.date)).toHaveLength(3)

    // A warm run has no gap and must not re-add any response.
    const warm = await ensureCacheHydrated(
      parseWithin(physicalProjects, ranges),
      aggregateProjectsIntoDays,
      'cfg-A',
      () => true,
      undefined,
      { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY },
    )
    expect(ranges).toHaveLength(1)
    expect(total(warm.days)).toEqual(physical)

    // A changed accounting authority uses the ordinary 365-day backfill, but
    // must carry the already-materialized sourceless days without loss.
    const orphanRanges: { start: Date; end: Date }[] = []
    const orphaned = await ensureCacheHydrated(
      async range => { orphanRanges.push(range); return [] },
      aggregateProjectsIntoDays,
      'cfg-B',
      () => true,
      undefined,
      { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY },
    )
    expect(orphanRanges).toHaveLength(1)
    expect(orphanRanges[0]!.start.getTime()).toBeGreaterThan(NOW.getTime() - (BACKFILL_DAYS + 1) * 24 * 60 * 60 * 1000)
    expect(total(orphaned.days)).toEqual(physical)
    expect(orphaned.days.every(day => day.carried === true)).toBe(true)

    // If the durable source returns, surviving native evidence may re-derive
    // its recent slice, while older sourceless slices remain carried exactly
    // once. No response is added a second time.
    const returned = await ensureCacheHydrated(
      parseWithin(physicalProjects, []),
      aggregateProjectsIntoDays,
      'cfg-C',
      () => true,
      undefined,
      { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY },
    )
    expect(total(returned.days)).toEqual(physical)
  })

  it('keeps direct Antigravity response accounting equal to cold durable daily materialization', async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'metrora-r2-antigravity-cold-'))
    process.env['METRORA_CACHE_DIR'] = cacheDir

    const directProjects = [
      syntheticAntigravityProject(91, 'native-response-1', { input: 100, output: 30, reasoning: 12 }),
      syntheticAntigravityProject(366, 'native-response-2', { input: 200, output: 40, reasoning: 18 }),
    ]
    const direct = total(aggregateProjectsIntoDays(directProjects))
    const durable = await ensureCacheHydrated(
      async () => directProjects,
      aggregateProjectsIntoDays,
      'cfg-A',
      () => true,
      undefined,
      { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY },
    )

    expect(total(durable.days)).toEqual(direct)
    expect(durable.days.reduce((sum, day) => sum + day.providers.antigravity!.calls, 0)).toBe(2)
  })
})
