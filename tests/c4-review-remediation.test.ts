import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DAILY_CACHE_VERSION,
  currentTzKey,
  loadDailyCache,
  saveDailyCache,
  type DailyCache,
  type DailyEntry,
  type ProjectDayStats,
} from '../src/daily-cache.js'
import { getDateRange } from '../src/cli-date.js'
import { loadPricing } from '../src/models.js'
import { renderOverview } from '../src/overview.js'
import { clearSessionCache } from '../src/parser.js'
import {
  buildDurablePeriod,
  getDailyCacheConfigHash,
} from '../src/usage-aggregator.js'

const ROOT = join(tmpdir(), `metrora-c4-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const ENV_KEYS = ['HOME', 'CODEBURN_CACHE_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIRS', 'CODEX_HOME'] as const
let savedEnv: Record<string, string | undefined>

function daysAgoStr(days: number): string {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function ownProjects(entries: Array<[string, ProjectDayStats]>): Record<string, ProjectDayStats> {
  const record = Object.create(null) as Record<string, ProjectDayStats>
  for (const [name, stats] of entries) {
    Object.defineProperty(record, name, {
      configurable: true,
      enumerable: true,
      value: stats,
      writable: true,
    })
  }
  return record
}

function durableDay(date: string): DailyEntry {
  return {
    date,
    cost: 100,
    savingsUSD: 0,
    calls: 10,
    sessions: 3,
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: {},
    categories: {},
    providers: {
      claude: {
        calls: 10,
        cost: 100,
        savingsUSD: 0,
        sessions: 3,
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        editTurns: 0,
        oneShotTurns: 0,
        models: {},
        categories: {},
        projects: {
          alpha: { cost: 60, calls: 6, savingsUSD: 0, sessions: 2, path: '/repo/alpha' },
          beta: { cost: 30, calls: 3, savingsUSD: 0, sessions: 1, path: '/repo/beta' },
        },
      },
    },
    projects: {
      alpha: { cost: 60, calls: 6, savingsUSD: 0, sessions: 2, path: '/repo/alpha' },
      beta: { cost: 30, calls: 3, savingsUSD: 0, sessions: 1, path: '/repo/beta' },
    },
    carried: true,
  }
}

beforeAll(async () => {
  await loadPricing()
})

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
  await mkdir(join(ROOT, 'home', '.claude'), { recursive: true })
  await mkdir(join(ROOT, 'cache'), { recursive: true })
  process.env.HOME = join(ROOT, 'home')
  process.env.CODEBURN_CACHE_DIR = join(ROOT, 'cache')
  process.env.CLAUDE_CONFIG_DIR = join(ROOT, 'home', '.claude')
  delete process.env.CLAUDE_CONFIG_DIRS
  delete process.env.CODEX_HOME
  clearSessionCache()
})

afterEach(async () => {
  clearSessionCache()
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  if (existsSync(ROOT)) await rm(ROOT, { recursive: true, force: true })
})

describe('C4 independent-review remediation', () => {
  it('preserves prototype-property project names through cache persistence and reload', async () => {
    const names = ['__proto__', 'constructor', 'toString']
    const projects = ownProjects(names.map((name, index) => [
      name,
      { cost: index + 1, calls: 1, savingsUSD: 0, sessions: 1, path: `/repo/${name}` },
    ]))
    const day: DailyEntry = {
      ...durableDay(daysAgoStr(10)),
      cost: 6,
      calls: 3,
      sessions: 3,
      providers: {
        claude: {
          calls: 3,
          cost: 6,
          savingsUSD: 0,
          sessions: 3,
          projects: ownProjects(names.map((name, index) => [
            name,
            { cost: index + 1, calls: 1, savingsUSD: 0, sessions: 1, path: `/repo/${name}` },
          ])),
        },
      },
      projects,
    }
    const cache: DailyCache = {
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: '',
      tzKey: currentTzKey(),
      lastComputedDate: day.date,
      days: [day],
      complete: true,
      watermarkTrusted: true,
    }

    await saveDailyCache(cache)
    const loaded = await loadDailyCache()
    const loadedDay = loaded.days[0]!
    for (const name of names) {
      expect(Object.hasOwn(loadedDay.projects ?? {}, name)).toBe(true)
      expect(Object.hasOwn(loadedDay.providers.claude?.projects ?? {}, name)).toBe(true)
    }
    expect(loadedDay.projects?.constructor?.cost).toBe(2)
    expect(loadedDay.projects?.toString?.cost).toBe(3)
  })

  it('renders carried-only project and provider breakdowns from the filtered durable projection', async () => {
    const day = durableDay(daysAgoStr(10))
    const cache: DailyCache = {
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: getDailyCacheConfigHash(),
      tzKey: currentTzKey(),
      lastComputedDate: daysAgoStr(1),
      days: [day],
      complete: true,
      watermarkTrusted: true,
    }
    await saveDailyCache(cache)

    const durable = await buildDurablePeriod(getDateRange('all'), {
      provider: 'all',
      project: ['alpha'],
    })
    expect(durable.data.cost).toBe(60)
    expect(durable.liveProjects).toEqual([])

    const output = renderOverview(durable.liveProjects, {
      label: 'All time',
      color: false,
      durable: {
        cost: durable.data.cost,
        savingsUSD: durable.data.savingsUSD,
        calls: durable.data.calls,
        sessions: durable.data.sessions,
        inputTokens: durable.data.inputTokens,
        outputTokens: durable.data.outputTokens,
        cacheReadTokens: durable.data.cacheReadTokens,
        cacheWriteTokens: durable.data.cacheWriteTokens,
        days: durable.days,
        carriedCostUSD: durable.carriedCostUSD,
      },
    })

    expect(output).toContain('By tool')
    expect(output).toContain('claude')
    expect(output).toContain('Top projects')
    expect(output).toContain('alpha')
    expect(output).not.toContain('beta')
    expect(output).not.toContain('Unattributed')
  })
})
