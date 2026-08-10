import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
const ENV_KEYS = [
  'HOME', 'USERPROFILE', 'HOMEPATH', 'HOMEDRIVE', 'APPDATA', 'LOCALAPPDATA',
  'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'METRORA_CACHE_DIR',
  'METRORA_CONFIG_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIRS', 'CODEX_HOME',
  'OPENCODE_DATA_DIR',
] as const
let savedEnv: Record<string, string | undefined>

const { ORIGINAL_ENV } = vi.hoisted(() => {
  const envKeys = [
    'HOME', 'USERPROFILE', 'HOMEPATH', 'HOMEDRIVE', 'APPDATA', 'LOCALAPPDATA',
    'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'METRORA_CACHE_DIR',
    'METRORA_CONFIG_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIRS', 'CODEX_HOME',
    'OPENCODE_DATA_DIR',
  ] as const
  const original = Object.fromEntries(envKeys.map(key => [key, process.env[key]])) as Record<string, string | undefined>
  const separator = process.platform === 'win32' ? '\\' : '/'
  const base = process.env['TMPDIR'] ?? process.env['TMP'] ?? process.env['TEMP'] ?? '.'
  const root = `${base}${base.endsWith(separator) ? '' : separator}metrora-c4-review-isolated-home`
  const home = `${root}${separator}home`
  const isolated: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    HOMEPATH: home,
    HOMEDRIVE: '',
    APPDATA: `${home}${separator}AppData${separator}Roaming`,
    LOCALAPPDATA: `${home}${separator}AppData${separator}Local`,
    XDG_DATA_HOME: `${home}${separator}.local${separator}share`,
    XDG_CONFIG_HOME: `${home}${separator}.config`,
    XDG_CACHE_HOME: `${home}${separator}.cache`,
    METRORA_CACHE_DIR: `${root}${separator}cache`,
    METRORA_CONFIG_DIR: `${home}${separator}.config${separator}metrora`,
    CLAUDE_CONFIG_DIR: `${home}${separator}.claude`,
    CODEX_HOME: `${home}${separator}.codex`,
    OPENCODE_DATA_DIR: `${home}${separator}.local${separator}share${separator}opencode`,
  }
  for (const [key, value] of Object.entries(isolated)) process.env[key] = value
  delete process.env['CLAUDE_CONFIG_DIRS']
  return { ORIGINAL_ENV: original }
})

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

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

beforeAll(async () => {
  await loadPricing()
})

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
  await mkdir(join(ROOT, 'home', '.claude'), { recursive: true })
  await mkdir(join(ROOT, 'cache'), { recursive: true })
  process.env.HOME = join(ROOT, 'home')
  process.env.USERPROFILE = join(ROOT, 'home')
  process.env.HOMEPATH = join(ROOT, 'home')
  process.env.HOMEDRIVE = ''
  process.env.APPDATA = join(ROOT, 'home', 'AppData', 'Roaming')
  process.env.LOCALAPPDATA = join(ROOT, 'home', 'AppData', 'Local')
  process.env.XDG_DATA_HOME = join(ROOT, 'home', '.local', 'share')
  process.env.XDG_CONFIG_HOME = join(ROOT, 'home', '.config')
  process.env.XDG_CACHE_HOME = join(ROOT, 'home', '.cache')
  process.env.METRORA_CACHE_DIR = join(ROOT, 'cache')
  process.env.METRORA_CONFIG_DIR = join(ROOT, 'home', '.config', 'metrora')
  process.env.CLAUDE_CONFIG_DIR = join(ROOT, 'home', '.claude')
  process.env.CODEX_HOME = join(ROOT, 'home', '.codex')
  process.env.OPENCODE_DATA_DIR = join(ROOT, 'home', '.local', 'share', 'opencode')
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
