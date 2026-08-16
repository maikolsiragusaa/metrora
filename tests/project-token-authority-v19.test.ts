import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { aggregateProjectsIntoDays, buildPeriodDataFromDays } from '../src/day-aggregator.js'
import {
  DAILY_CACHE_VERSION,
  DURABLE_HISTORY_AUTHORITY,
  currentTzKey,
  dailyCachePath,
  ensureCacheHydrated,
  type DailyEntry,
} from '../src/daily-cache.js'
import { filterDailyEntryByMetroraScope, sourceProjectIdForSummary } from '../src/project-scope.js'
import { withProjectDetailCoverage } from '../src/project-coverage.js'
import { toCompanionUsageV1 } from '../src/sharing/companion-contract.js'
import type { ProjectRegistry } from '../src/project-registry.js'
import type { ProjectSummary } from '../src/types.js'

const ROOT = join(tmpdir(), `metrora-project-token-v19-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
let previousCacheDir: string | undefined

function call(input: {
  timestamp: string
  costUSD: number
  provider: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens?: number
  model?: string
}): unknown {
  return {
    provider: input.provider,
    model: input.model ?? 'synthetic-model',
    usage: {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheCreationInputTokens: input.cacheWriteTokens,
      cacheReadInputTokens: input.cacheReadTokens,
      cachedInputTokens: input.cacheReadTokens,
      reasoningTokens: input.reasoningTokens ?? 0,
      webSearchRequests: 0,
    },
    costUSD: input.costUSD,
    savingsUSD: 0,
    tools: [],
    mcpTools: [],
    skills: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    timestamp: input.timestamp,
  }
}

function sourceProject(
  name: string,
  path: string,
  calls: Array<ReturnType<typeof call>>,
  sessionId = `${name}-session`,
): ProjectSummary {
  const typedCalls = calls as unknown[]
  const total = (field: 'costUSD' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens'): number =>
    typedCalls.reduce((sum, value) => {
      const record = value as { costUSD?: number; usage?: Record<string, number> }
      if (field === 'costUSD') return sum + (record.costUSD ?? 0)
      const usageField = field === 'cacheReadTokens'
        ? 'cacheReadInputTokens'
        : field === 'cacheWriteTokens'
          ? 'cacheCreationInputTokens'
          : field
      return sum + (record.usage?.[usageField] ?? 0)
    }, 0)
  const firstTimestamp = (typedCalls[0] as { timestamp: string }).timestamp
  const lastTimestamp = (typedCalls.at(-1) as { timestamp: string }).timestamp
  return {
    project: name,
    projectPath: path,
    totalCostUSD: total('costUSD'),
    totalSavingsUSD: 0,
    totalApiCalls: typedCalls.length,
    totalProxiedCostUSD: 0,
    sessions: [{
      sessionId,
      project: name,
      firstTimestamp,
      lastTimestamp,
      totalCostUSD: total('costUSD'),
      totalSavingsUSD: 0,
      totalInputTokens: total('inputTokens'),
      totalOutputTokens: total('outputTokens'),
      totalReasoningTokens: total('reasoningTokens'),
      totalCacheReadTokens: total('cacheReadTokens'),
      totalCacheWriteTokens: total('cacheWriteTokens'),
      apiCalls: typedCalls.length,
      turns: [{
        userMessage: 'synthetic project token fixture',
        timestamp: firstTimestamp,
        sessionId,
        category: 'coding',
        retries: 0,
        hasEdits: false,
        assistantCalls: typedCalls,
      }],
      modelBreakdown: {},
      toolBreakdown: {},
      mcpBreakdown: {},
      bashBreakdown: {},
      categoryBreakdown: {},
      skillBreakdown: {},
      subagentBreakdown: {},
    }],
  } as unknown as ProjectSummary
}

function registry(assignments: Record<string, string[]>): ProjectRegistry {
  return {
    kind: 'metrora.project-registry',
    version: 1,
    projects: Object.entries(assignments).map(([id, sourceProjectMembership]) => ({
      id,
      name: id,
      icon: 'grid',
      color: 'cyan',
      sourceProjectMembership,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
  }
}

function legacyDay(date: string, cost = 5, calls = 2): DailyEntry {
  const project = { cost, calls, savingsUSD: 0, sessions: 1, path: '/source/a' }
  return {
    date,
    cost,
    savingsUSD: 0,
    calls,
    sessions: 1,
    inputTokens: cost * 100,
    outputTokens: cost * 50,
    cacheReadTokens: cost * 10,
    cacheWriteTokens: cost * 2,
    editTurns: 0,
    oneShotTurns: 0,
    models: { legacy: { calls, cost, savingsUSD: 0, inputTokens: cost * 100, outputTokens: cost * 50, cacheReadTokens: cost * 10, cacheWriteTokens: cost * 2 } },
    categories: {},
    providers: {
      claude: {
        calls,
        cost,
        savingsUSD: 0,
        sessions: 1,
        inputTokens: cost * 100,
        outputTokens: cost * 50,
        cacheReadTokens: cost * 10,
        cacheWriteTokens: cost * 2,
        projects: { A: project },
      },
    },
    projects: { A: project },
    carried: true,
  }
}

function tokenTotal(day: DailyEntry): number {
  return day.inputTokens + day.outputTokens + day.cacheReadTokens + day.cacheWriteTokens
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
  previousCacheDir = process.env['METRORA_CACHE_DIR']
  process.env['METRORA_CACHE_DIR'] = ROOT
  await mkdir(ROOT, { recursive: true })
})

afterEach(async () => {
  vi.useRealTimers()
  if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = previousCacheDir
  if (existsSync(ROOT)) await rm(ROOT, { recursive: true, force: true })
})

describe('v19 Source Project token authority', () => {
  it('materializes a fully covered day and reconciles Source Project, provider, and DailyEntry tokens', () => {
    const projects = [
      sourceProject('A', '/source/a', [call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 2, provider: 'claude', inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 5 })]),
      sourceProject('B', '/source/b', [call({ timestamp: '2026-08-02T11:00:00.000Z', costUSD: 3, provider: 'codex', inputTokens: 100, outputTokens: 200, cacheReadTokens: 30, cacheWriteTokens: 40, reasoningTokens: 7 })]),
    ]
    const day = aggregateProjectsIntoDays(projects)[0]!
    const sourceIds = projects.map(sourceProjectIdForSummary)
    const scoped = filterDailyEntryByMetroraScope(day, registry({ mp_x: sourceIds }), 'mp_x')
    const period = buildPeriodDataFromDays([scoped], 'Lifetime')
    const covered = withProjectDetailCoverage(period, [scoped], true, '2026-08-03')

    for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
      expect(Object.values(day.projects ?? {}).reduce((sum, value) => sum + (value[field] ?? 0), 0)).toBe(day[field])
      expect(Object.values(day.providers).reduce((sum, slice) => sum + Object.values(slice.projects ?? {}).reduce((inner, value) => inner + (value[field] ?? 0), 0), 0)).toBe(day[field])
      expect(scoped[field]).toBe(day[field])
      expect(period[field]).toBe(day[field])
    }
    expect(day.reasoningTokens).toBe(12)
    expect(scoped.reasoningTokens).toBe(12)
    expect(covered.projectDetailCoverage?.tokens).toBe('complete')
  })

  it('keeps All projects global totals unchanged and gives Unassigned an exact complete subtotal', () => {
    const projects = [
      sourceProject('A', '/source/a', [call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 2, provider: 'claude', inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4 })]),
      sourceProject('B', '/source/b', [call({ timestamp: '2026-08-02T11:00:00.000Z', costUSD: 3, provider: 'codex', inputTokens: 100, outputTokens: 200, cacheReadTokens: 30, cacheWriteTokens: 40 })]),
    ]
    const day = aggregateProjectsIntoDays(projects)[0]!
    const sourceA = sourceProjectIdForSummary(projects[0]!)
    const all = filterDailyEntryByMetroraScope(day, registry({ mp_x: [sourceA] }), 'all')
    const unassigned = filterDailyEntryByMetroraScope(day, registry({ mp_x: [sourceA] }), 'unassigned')
    const coverage = withProjectDetailCoverage(buildPeriodDataFromDays([unassigned], 'Lifetime'), [unassigned], true, '2026-08-03')

    expect(all).toBe(day)
    expect(tokenTotal(all)).toBe(tokenTotal(day))
    expect(unassigned.cost).toBe(3)
    expect(unassigned.inputTokens).toBe(100)
    expect(unassigned.outputTokens).toBe(200)
    expect(unassigned.cacheReadTokens).toBe(30)
    expect(unassigned.cacheWriteTokens).toBe(40)
    expect(coverage.projectDetailCoverage?.tokens).toBe('complete')
  })

  it('marks mixed and fully unavailable historical project token evidence without presenting a subtotal as complete', () => {
    const source = sourceProject('A', '/source/a', [call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 2, provider: 'claude', inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4 })])
    const sourceId = sourceProjectIdForSummary(source)
    const mixedNew = aggregateProjectsIntoDays([source])[0]!
    const mixedOld = legacyDay('2026-08-01', 5, 2)
    const mixed = [filterDailyEntryByMetroraScope(mixedOld, registry({ mp_x: [sourceId] }), 'mp_x'), filterDailyEntryByMetroraScope(mixedNew, registry({ mp_x: [sourceId] }), 'mp_x')]
    const mixedCoverage = withProjectDetailCoverage(buildPeriodDataFromDays(mixed, 'Lifetime'), mixed, true, '2026-08-03')

    expect(mixedCoverage.cost).toBe(7)
    expect(mixedCoverage.calls).toBe(3)
    expect(mixedCoverage.inputTokens).toBe(10)
    expect(mixedCoverage.projectDetailCoverage?.tokens).toBe('partial')
    expect(mixed[0]!.projects?.A).not.toHaveProperty('inputTokens')

    const unavailableDay = filterDailyEntryByMetroraScope(legacyDay('2026-08-01'), registry({ mp_x: [sourceId] }), 'mp_x')
    const unavailable = withProjectDetailCoverage(buildPeriodDataFromDays([unavailableDay], 'Lifetime'), [unavailableDay], true, '2026-08-03')
    expect(unavailable.projectDetailCoverage?.tokens).toBe('unavailable')
    expect(unavailableDay.projects?.A).not.toHaveProperty('outputTokens')
  })

  it('changes only scoped totals when Source Project membership is regrouped', () => {
    const projects = [
      sourceProject('A', '/source/a', [call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 2, provider: 'claude', inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4 })]),
      sourceProject('B', '/source/b', [call({ timestamp: '2026-08-02T11:00:00.000Z', costUSD: 3, provider: 'codex', inputTokens: 100, outputTokens: 200, cacheReadTokens: 30, cacheWriteTokens: 40 })]),
    ]
    const day = aggregateProjectsIntoDays(projects)[0]!
    const a = sourceProjectIdForSummary(projects[0]!)
    const b = sourceProjectIdForSummary(projects[1]!)
    const before = filterDailyEntryByMetroraScope(day, registry({ mp_x: [a, b], mp_y: [] }), 'mp_x')
    const afterX = filterDailyEntryByMetroraScope(day, registry({ mp_x: [b], mp_y: [a] }), 'mp_x')
    const afterY = filterDailyEntryByMetroraScope(day, registry({ mp_x: [b], mp_y: [a] }), 'mp_y')

    expect(tokenTotal(before)).toBe(tokenTotal(day))
    expect(afterX.inputTokens).toBe(100)
    expect(afterX.outputTokens).toBe(200)
    expect(afterY.inputTokens).toBe(10)
    expect(afterY.outputTokens).toBe(20)
    expect(day.projects?.A?.inputTokens).toBe(10)
    expect(day.projects?.B?.inputTokens).toBe(100)
  })

  it('adopts v18 losslessly, rehydrates surviving source evidence, and carries source-deleted history', async () => {
    const oldPath = join(ROOT, 'daily-cache.v18.json')
    const oldEnvelope = {
      version: 18,
      savingsConfigHash: 'cfg',
      tzKey: currentTzKey(),
      durableHistoryAuthority: 'materialize-before-evict-v1',
      lastComputedDate: '2026-08-02',
      complete: true,
      days: [legacyDay('2026-07-20'), legacyDay('2026-07-21', 6, 3)],
    }
    const oldBytes = JSON.stringify(oldEnvelope)
    await writeFile(oldPath, oldBytes, 'utf8')
    const surviving = sourceProject('A', '/source/a', [call({ timestamp: '2026-07-20T10:00:00.000Z', costUSD: 5, provider: 'claude', inputTokens: 11, outputTokens: 22, cacheReadTokens: 3, cacheWriteTokens: 4 })])

    const migrated = await ensureCacheHydrated(
      async () => [surviving],
      aggregateProjectsIntoDays,
      'cfg',
      () => true,
      undefined,
      { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY },
    )
    const rehydrated = migrated.days.find(day => day.date === '2026-07-20')!
    const carried = migrated.days.find(day => day.date === '2026-07-21')!

    expect(DAILY_CACHE_VERSION).toBe(19)
    expect(migrated.version).toBe(19)
    expect(rehydrated.projects?.A).toMatchObject({ inputTokens: 11, outputTokens: 22, cacheReadTokens: 3, cacheWriteTokens: 4 })
    expect(carried.cost).toBe(6)
    expect(carried.calls).toBe(3)
    expect(carried.sessions).toBe(1)
    expect(carried.projects?.A).not.toHaveProperty('inputTokens')
    expect(carried.carried).toBe(true)
    expect(await readFile(oldPath, 'utf8')).toBe(oldBytes)
    expect(existsSync(dailyCachePath())).toBe(true)
    expect(JSON.parse(await readFile(dailyCachePath(), 'utf8')).version).toBe(19)
  })

  it('keeps Desktop/core numeric projection identical to Companion tokens for complete Project scope', () => {
    const project = sourceProject('A', '/source/a', [call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 2, provider: 'claude', inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheWriteTokens: 4 })])
    const day = aggregateProjectsIntoDays([project])[0]!
    const sourceId = sourceProjectIdForSummary(project)
    const scoped = filterDailyEntryByMetroraScope(day, registry({ mp_x: [sourceId] }), 'mp_x')
    const desktop = buildPeriodDataFromDays([scoped], 'Lifetime')
    const covered = withProjectDetailCoverage(desktop, [scoped], true, '2026-08-03')
    const companion = toCompanionUsageV1({
      generated: '2026-08-03T12:00:00.000Z',
      projectScope: { selectedId: 'mp_x' },
      current: {
        label: covered.label,
        cost: covered.cost,
        calls: covered.calls,
        sessions: covered.sessions,
        inputTokens: covered.inputTokens,
        outputTokens: covered.outputTokens,
        cacheReadTokens: covered.cacheReadTokens,
        cacheWriteTokens: covered.cacheWriteTokens,
        cacheHitPercent: 0,
        topModels: [],
        projectDetailCoverage: covered.projectDetailCoverage,
      },
    })

    expect(covered.projectDetailCoverage?.tokens).toBe('complete')
    expect(companion.scope).toEqual({ projectId: 'mp_x' })
    expect(companion.quality.projectDetailCoverage?.tokens).toBe('complete')
    expect(companion.totals.tokens.total).toBe(tokenTotal(scoped))
  })
})
