import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { aggregateProjectsIntoDays, buildPeriodDataFromDays } from '../src/day-aggregator.js'
import {
  DAILY_CACHE_VERSION,
  DURABLE_HISTORY_AUTHORITY,
  MIN_SUPPORTED_VERSION,
  currentTzKey,
  dailyCachePath,
  ensureCacheHydrated,
  type DailyEntry,
} from '../src/daily-cache.js'
import { migrateDays } from '../src/daily-cache-core.js'
import { mergeDayEntries } from '../src/daily-cache-merge.js'
import { buildModelAccounting } from '../src/model-accounting.js'
import { filterDailyEntryByMetroraScope, sourceProjectIdForSummary } from '../src/project-scope.js'
import { withProjectDetailCoverage } from '../src/project-coverage.js'
import { toCompanionUsageV1 } from '../src/sharing/companion-contract.js'
import type { ProjectRegistry } from '../src/project-registry.js'
import type { ProjectSummary } from '../src/types.js'
import type { ReasoningTokenSemantics } from '../src/token-semantics.js'

const ROOT = join(tmpdir(), `metrora-project-authority-v20-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
let previousCacheDir: string | undefined

type CallInput = {
  timestamp: string
  costUSD: number
  provider: string
  model?: string
  modelProvider?: string
  category?: ProjectSummary['sessions'][number]['turns'][number]['category']
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  reasoningSemantics?: ReasoningTokenSemantics
}

function call(input: CallInput): any {
  const cacheReadTokens = input.cacheReadTokens ?? 0
  const cacheWriteTokens = input.cacheWriteTokens ?? 0
  return {
    provider: input.provider,
    model: input.model ?? 'synthetic-model',
    ...(input.modelProvider ? { modelProvider: input.modelProvider } : {}),
    ...(input.reasoningSemantics ? { reasoningSemantics: input.reasoningSemantics } : {}),
    usage: {
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      cacheCreationInputTokens: cacheWriteTokens,
      cacheReadInputTokens: cacheReadTokens,
      cachedInputTokens: cacheReadTokens,
      reasoningTokens: input.reasoningTokens ?? 0,
      webSearchRequests: 0,
    },
    costUSD: input.costUSD,
    savingsUSD: 0,
    tools: [],
    mcpTools: [],
    skills: [],
    subagentTypes: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: input.timestamp,
    bashCommands: [],
    deduplicationKey: `${input.provider}-${input.timestamp}-${input.model ?? 'synthetic-model'}`,
  }
}

function projectSummary(name: string, path: string, calls: any[], categories?: string[]): ProjectSummary {
  const grouped = new Map<string, any[]>()
  for (const [index, apiCall] of calls.entries()) {
    const category = categories?.[index] ?? 'coding'
    const bucket = grouped.get(category) ?? []
    bucket.push(apiCall)
    grouped.set(category, bucket)
  }
  const total = (selector: (apiCall: any) => number) => calls.reduce((sum, apiCall) => sum + selector(apiCall), 0)
  const firstTimestamp = calls[0]?.timestamp ?? '2026-08-01T10:00:00.000Z'
  const lastTimestamp = calls.at(-1)?.timestamp ?? firstTimestamp
  const turns = [...grouped.entries()].flatMap(([category, categoryCalls]) => categoryCalls.map((apiCall, index) => ({
    userMessage: `${category}-${index}`,
    assistantCalls: [apiCall],
    timestamp: apiCall.timestamp,
    sessionId: `${name}-session`,
    category,
    retries: 0,
    hasEdits: false,
  })))
  return {
    project: name,
    projectPath: path,
    totalCostUSD: total(apiCall => apiCall.costUSD),
    totalSavingsUSD: 0,
    totalApiCalls: calls.length,
    totalProxiedCostUSD: 0,
    sessions: [{
      sessionId: `${name}-session`,
      project: name,
      firstTimestamp,
      lastTimestamp,
      totalCostUSD: total(apiCall => apiCall.costUSD),
      totalSavingsUSD: 0,
      totalInputTokens: total(apiCall => apiCall.usage.inputTokens),
      totalOutputTokens: total(apiCall => apiCall.usage.outputTokens),
      totalReasoningTokens: total(apiCall => apiCall.usage.reasoningTokens),
      totalCacheReadTokens: total(apiCall => apiCall.usage.cacheReadInputTokens),
      totalCacheWriteTokens: total(apiCall => apiCall.usage.cacheCreationInputTokens),
      apiCalls: calls.length,
      turns,
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

function legacyV19Day(date: string, cost = 5, calls = 2): DailyEntry {
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
    providers: { claude: { calls, cost, savingsUSD: 0, sessions: 1, inputTokens: cost * 100, outputTokens: cost * 50, cacheReadTokens: cost * 10, cacheWriteTokens: cost * 2, projects: { A: project } } },
    projects: { A: project },
    carried: true,
  }
}

function v19Envelope(days: DailyEntry[], authority = 'materialize-before-evict-v1') {
  return {
    version: 19,
    savingsConfigHash: 'cfg',
    tzKey: currentTzKey(),
    durableHistoryAuthority: authority,
    lastComputedDate: '2026-08-02',
    complete: true,
    days,
  }
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

describe('v20 durable Source Project model/category authority', () => {
  it('materializes complete model/category detail and serves it after source deletion', async () => {
    const source = projectSummary('A', '/source/a', [
      call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 2, provider: 'claude', model: 'model-a', inputTokens: 10, outputTokens: 20 }),
      call({ timestamp: '2026-08-02T11:00:00.000Z', costUSD: 3, provider: 'codex', model: 'model-b', inputTokens: 30, outputTokens: 40 }),
    ], ['coding', 'testing'])
    const first = await ensureCacheHydrated(async () => [source], aggregateProjectsIntoDays, 'cfg', () => true, undefined, { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY })
    const firstDay = first.days.find(day => day.date === '2026-08-02')!
    const sourceId = sourceProjectIdForSummary(source)
    const scoped = filterDailyEntryByMetroraScope(firstDay, registry({ mp_a: [sourceId] }), 'mp_a')
    const coverage = withProjectDetailCoverage(buildPeriodDataFromDays([scoped], 'Lifetime'), [scoped], true, '2026-08-03')

    expect(first.version).toBe(20)
    expect(firstDay.projects?.A?.modelDetail).toMatchObject({ coverage: 'complete' })
    expect(Object.keys(firstDay.projects?.A?.modelDetail?.rows ?? {})).toHaveLength(2)
    expect(firstDay.projects?.A?.categoryDetail).toMatchObject({ coverage: 'complete' })
    expect(Object.keys(firstDay.projects?.A?.categoryDetail?.rows ?? {})).toEqual(expect.arrayContaining(['coding', 'testing']))
    expect(scoped.models).toEqual(firstDay.projects?.A?.modelDetail?.rows)
    expect(scoped.categories).toEqual(firstDay.projects?.A?.categoryDetail?.rows)
    expect(coverage.projectDetailCoverage).toEqual({ models: 'complete', tokens: 'complete', categories: 'complete', historical: true })

    const warm = await ensureCacheHydrated(async () => [], aggregateProjectsIntoDays, 'cfg', () => true, undefined, { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY })
    const warmDay = warm.days.find(day => day.date === '2026-08-02')!
    expect(warmDay.projects?.A?.modelDetail).toEqual(firstDay.projects?.A?.modelDetail)
    expect(warmDay.projects?.A?.categoryDetail).toEqual(firstDay.projects?.A?.categoryDetail)
  })

  it('keeps same-display-name model routes distinct in durable project rows and scoped projection', () => {
    const source = projectSummary('A', '/source/a', [
      call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 2, provider: 'claude', model: 'same-name', modelProvider: 'route-a', inputTokens: 10, outputTokens: 20 }),
      call({ timestamp: '2026-08-02T11:00:00.000Z', costUSD: 3, provider: 'claude', model: 'same-name', modelProvider: 'route-b', inputTokens: 30, outputTokens: 40 }),
    ])
    const day = aggregateProjectsIntoDays([source])[0]!
    const sourceId = sourceProjectIdForSummary(source)
    const scoped = filterDailyEntryByMetroraScope(day, registry({ mp_a: [sourceId] }), 'mp_a')
    const rows = buildPeriodDataFromDays([scoped], 'Lifetime').models

    expect(Object.keys(day.projects?.A?.modelDetail?.rows ?? {})).toHaveLength(2)
    expect(rows.map(row => row.modelProvider).sort()).toEqual(['route-a', 'route-b'])
    expect(rows.map(row => row.cost).sort((a, b) => a - b)).toEqual([2, 3])
  })

  it('moves only the current projection when Source Project membership is regrouped', () => {
    const source = projectSummary('A', '/source/a', [call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 4, provider: 'claude', model: 'model-a' })])
    const day = aggregateProjectsIntoDays([source])[0]!
    const sourceId = sourceProjectIdForSummary(source)
    const before = filterDailyEntryByMetroraScope(day, registry({ mp_a: [sourceId], mp_b: [] }), 'mp_a')
    const afterA = filterDailyEntryByMetroraScope(day, registry({ mp_a: [], mp_b: [sourceId] }), 'mp_a')
    const afterB = filterDailyEntryByMetroraScope(day, registry({ mp_a: [], mp_b: [sourceId] }), 'mp_b')

    expect(day.projects?.A?.modelDetail?.coverage).toBe('complete')
    expect(before.models).toHaveProperty('model-a')
    expect(afterA.cost).toBe(0)
    expect(afterA.models).toEqual({})
    expect(afterB.models).toHaveProperty('model-a')
    expect(afterB.categories).toHaveProperty('coding')
  })

  it('adopts v19 with retained source evidence and leaves the v19 file untouched', async () => {
    const oldPath = join(ROOT, 'daily-cache.v19.json')
    const oldBytes = JSON.stringify(v19Envelope([legacyV19Day('2026-07-20')]))
    await writeFile(oldPath, oldBytes, 'utf8')
    const source = projectSummary('A', '/source/a', [call({ timestamp: '2026-07-20T10:00:00.000Z', costUSD: 5, provider: 'claude', model: 'rehydrated-model' })])

    const migrated = await ensureCacheHydrated(async () => [source], aggregateProjectsIntoDays, 'cfg', () => true, undefined, { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY })
    const rehydrated = migrated.days.find(day => day.date === '2026-07-20')!

    expect(DAILY_CACHE_VERSION).toBe(20)
    expect(MIN_SUPPORTED_VERSION).toBe(15)
    expect(rehydrated.projects?.A?.modelDetail?.coverage).toBe('complete')
    expect(rehydrated.projects?.A?.categoryDetail?.coverage).toBe('complete')
    expect(await readFile(oldPath, 'utf8')).toBe(oldBytes)
    expect(JSON.parse(await readFile(dailyCachePath(), 'utf8')).version).toBe(20)
  })

  it('adopts v19 sourceless project facts exactly without fabricating detail', async () => {
    const oldPath = join(ROOT, 'daily-cache.v19.json')
    const old = legacyV19Day('2026-07-21', 6, 3)
    await writeFile(oldPath, JSON.stringify(v19Envelope([old])), 'utf8')

    const migrated = await ensureCacheHydrated(async () => [], aggregateProjectsIntoDays, 'cfg', () => true, undefined, { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY })
    const carried = migrated.days.find(day => day.date === '2026-07-21')!

    expect(carried.cost).toBe(old.cost)
    expect(carried.calls).toBe(old.calls)
    expect(carried.inputTokens).toBe(old.inputTokens)
    expect(carried.projects?.A?.modelDetail).toBeUndefined()
    expect(carried.projects?.A?.categoryDetail).toBeUndefined()
    expect(carried.models).toEqual(old.models)
  })

  it('keeps known detail and marks the project partial when a carried provider lacks detail', () => {
    const detailed = aggregateProjectsIntoDays([projectSummary('A', '/source/a', [call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 2, provider: 'claude', model: 'known-model' })])])[0]!
    const carried: DailyEntry = {
      ...legacyV19Day('2026-08-02', 3, 1),
      providers: { legacy: { calls: 1, cost: 3, savingsUSD: 0, sessions: 1, projects: { A: { cost: 3, calls: 1, savingsUSD: 0, sessions: 1, path: '/source/a' } } } },
      projects: { A: { cost: 3, calls: 1, savingsUSD: 0, sessions: 1, path: '/source/a' } },
    }
    const merged = mergeDayEntries([detailed], [carried], true)[0]!
    const project = merged.projects?.A!

    expect(merged.cost).toBe(5)
    expect(project.modelDetail?.coverage).toBe('partial')
    expect(project.categoryDetail?.coverage).toBe('partial')
    expect(project.modelDetail?.rows).toHaveProperty('known-model')
    expect(project.categoryDetail?.rows).toHaveProperty('coding')
  })

  it('keeps Other models as exact cost/call residual without assigning token identity', () => {
    const accounting = buildModelAccounting([
      { name: 'known-model', cost: 6, savingsUSD: 0, calls: 7, inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ], 10, 10)
    expect(accounting.gap).toEqual({ cost: 4, savingsUSD: 0, calls: 3 })
    expect(accounting.rows[0]).toMatchObject({ name: 'known-model', inputTokens: 10, outputTokens: 20 })
    expect(accounting.rows[0]).not.toHaveProperty('tokenDetail', false)
  })

  it('distinguishes explicit complete-empty detail from unavailable detail', () => {
    const base: DailyEntry = {
      date: '2026-08-02', cost: 1, savingsUSD: 0, calls: 1, sessions: 1,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      editTurns: 0, oneShotTurns: 0, models: {}, categories: {}, providers: {},
      projects: { A: { cost: 1, calls: 1, savingsUSD: 0, sessions: 1, path: '/source/a', modelDetail: { coverage: 'complete', rows: {} }, categoryDetail: { coverage: 'complete', rows: {} } } },
    }
    const missing = { ...base, projects: { A: { cost: 1, calls: 1, savingsUSD: 0, sessions: 1, path: '/source/a' } } }
    const scope = registry({ mp_a: [sourceProjectIdForSummary(projectSummary('A', '/source/a', []))] })
    const complete = filterDailyEntryByMetroraScope(base, scope, 'mp_a')
    const unavailable = filterDailyEntryByMetroraScope(missing, scope, 'mp_a')
    const completeCoverage = withProjectDetailCoverage(buildPeriodDataFromDays([complete], 'Lifetime'), [complete], true, '2026-08-03')
    const unavailableCoverage = withProjectDetailCoverage(buildPeriodDataFromDays([unavailable], 'Lifetime'), [unavailable], true, '2026-08-03')

    expect(complete.models).toEqual({})
    expect(completeCoverage.projectDetailCoverage?.models).toBe('complete')
    expect(completeCoverage.projectDetailCoverage?.categories).toBe('complete')
    expect(unavailableCoverage.projectDetailCoverage?.models).toBe('unavailable')
    expect(unavailableCoverage.projectDetailCoverage?.categories).toBe('unavailable')
  })

  it('preserves separate, aggregate-output, and mixed reasoning algebra in project rows', () => {
    const source = projectSummary('A', '/source/a', [
      call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 1, provider: 'codex', model: 'reasoning-model', outputTokens: 100, reasoningTokens: 40, reasoningSemantics: 'separate' }),
      call({ timestamp: '2026-08-02T11:00:00.000Z', costUSD: 1, provider: 'claude', model: 'reasoning-model', outputTokens: 200, reasoningTokens: 50, reasoningSemantics: 'aggregate-output' }),
    ])
    const day = aggregateProjectsIntoDays([source])[0]!
    const row = day.projects?.A?.modelDetail?.rows['reasoning-model']!

    expect(row.reasoningTokens).toBe(90)
    expect(row.additiveReasoningTokens).toBe(40)
    expect(row.reasoningSemantics).toBe('mixed')
    expect(row.outputTokens + row.additiveReasoningTokens!).toBe(340)
  })

  it('keeps Desktop/core and Companion model rows and coverage aligned', () => {
    const source = projectSummary('A', '/source/a', [call({ timestamp: '2026-08-02T10:00:00.000Z', costUSD: 2, provider: 'claude', model: 'model-a', inputTokens: 10, outputTokens: 20 })])
    const day = aggregateProjectsIntoDays([source])[0]!
    const scoped = filterDailyEntryByMetroraScope(day, registry({ mp_a: [sourceProjectIdForSummary(source)] }), 'mp_a')
    const period = withProjectDetailCoverage(buildPeriodDataFromDays([scoped], 'Lifetime'), [scoped], true, '2026-08-03')
    const companion = toCompanionUsageV1({
      generated: '2026-08-03T12:00:00.000Z',
      projectScope: { selectedId: 'mp_a' },
      current: {
        label: period.label,
        cost: period.cost,
        calls: period.calls,
        sessions: period.sessions,
        inputTokens: period.inputTokens,
        outputTokens: period.outputTokens,
        cacheReadTokens: period.cacheReadTokens,
        cacheWriteTokens: period.cacheWriteTokens,
        cacheHitPercent: 0,
        topModels: [],
        modelAccounting: buildModelAccounting(period.models, period.cost, period.calls),
        projectDetailCoverage: period.projectDetailCoverage,
      },
    })
    expect(companion.quality.projectDetailCoverage).toEqual(period.projectDetailCoverage)
    expect(companion.models?.[0]?.name).toBe('model-a')
    expect(companion.totals.tokens.total).toBe(period.inputTokens + period.outputTokens)
  })

  it('sanitizes hostile nested project detail keys without prototype pollution', () => {
    const raw = JSON.parse('{"date":"2026-08-02","cost":1,"calls":1,"projects":{"A":{"cost":1,"calls":1,"savingsUSD":0,"sessions":1,"modelDetail":{"coverage":"complete","rows":{"__proto__":{"polluted":true},"constructor":{"calls":1,"cost":1,"savingsUSD":0,"inputTokens":1,"outputTokens":1,"cacheReadTokens":0,"cacheWriteTokens":0}}},"categoryDetail":{"coverage":"complete","rows":{"__proto__":{"polluted":true},"coding":{"turns":1,"cost":1,"savingsUSD":0,"editTurns":0,"oneShotTurns":0}}}}},"models":{},"categories":{},"providers":{},"inputTokens":0,"outputTokens":0,"cacheReadTokens":0,"cacheWriteTokens":0,"sessions":1,"editTurns":0,"oneShotTurns":0}') as Record<string, unknown>
    const migrated = migrateDays([raw])[0]!

    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(migrated.projects?.A?.modelDetail?.rows).not.toHaveProperty('__proto__')
    expect(migrated.projects?.A?.modelDetail?.rows).not.toHaveProperty('constructor')
    expect(migrated.projects?.A?.categoryDetail?.rows).toHaveProperty('coding')
  })

  it('keeps v19 and v20 files as separate owners', async () => {
    const oldPath = join(ROOT, 'daily-cache.v19.json')
    const oldBytes = JSON.stringify(v19Envelope([legacyV19Day('2026-07-22')]))
    await writeFile(oldPath, oldBytes, 'utf8')
    const source = projectSummary('A', '/source/a', [call({ timestamp: '2026-07-22T10:00:00.000Z', costUSD: 2, provider: 'claude', model: 'model-a' })])
    await ensureCacheHydrated(async () => [source], aggregateProjectsIntoDays, 'cfg', () => true, undefined, { durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY })

    expect(existsSync(oldPath)).toBe(true)
    expect(await readFile(oldPath, 'utf8')).toBe(oldBytes)
    expect(existsSync(dailyCachePath())).toBe(true)
    expect(dailyCachePath()).toContain('daily-cache.v20.json')
  })
})
