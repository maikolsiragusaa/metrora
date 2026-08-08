import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DAILY_CACHE_VERSION,
  currentTzKey,
  type DailyCache,
  type DailyEntry,
} from '../src/daily-cache.js'
import { getDateRange } from '../src/cli-date.js'
import { loadPricing } from '../src/models.js'
import { clearSessionCache } from '../src/parser.js'
import {
  buildMenubarPayloadForRange,
  getDailyCacheConfigHash,
} from '../src/usage-aggregator.js'

const ROOT = join(tmpdir(), `metrora-c4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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
  const root = `${base}${base.endsWith(separator) ? '' : separator}metrora-c4-isolated-home`
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

function modelStats(calls: number, cost: number) {
  return {
    calls,
    cost,
    savingsUSD: 0,
    inputTokens: calls * 100,
    outputTokens: calls * 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

function splitDay(date: string): DailyEntry {
  return {
    date,
    cost: 100,
    savingsUSD: 0,
    calls: 10,
    sessions: 5,
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 4,
    oneShotTurns: 2,
    models: { model: modelStats(10, 100) },
    categories: { coding: { turns: 4, cost: 100, savingsUSD: 0, editTurns: 4, oneShotTurns: 2 } },
    providers: {
      claude: {
        calls: 8,
        cost: 75,
        savingsUSD: 0,
        sessions: 4,
        inputTokens: 800,
        outputTokens: 400,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        editTurns: 3,
        oneShotTurns: 2,
        models: { model: modelStats(8, 75) },
        categories: { coding: { turns: 3, cost: 75, savingsUSD: 0, editTurns: 3, oneShotTurns: 2 } },
        projects: {
          alpha: { cost: 50, calls: 5, savingsUSD: 0, sessions: 2, path: '/repo/alpha' },
          beta: { cost: 20, calls: 2, savingsUSD: 0, sessions: 1, path: '/repo/beta' },
        },
      },
      codex: {
        calls: 2,
        cost: 25,
        savingsUSD: 0,
        sessions: 2,
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        editTurns: 1,
        oneShotTurns: 0,
        models: { model: modelStats(2, 25) },
        categories: { coding: { turns: 1, cost: 25, savingsUSD: 0, editTurns: 1, oneShotTurns: 0 } },
        projects: {
          alpha: { cost: 10, calls: 1, savingsUSD: 0, sessions: 1, path: '/repo/alpha' },
          beta: { cost: 10, calls: 1, savingsUSD: 0, sessions: 1, path: '/repo/beta' },
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

function legacyDay(date: string): DailyEntry {
  return {
    date,
    cost: 40,
    savingsUSD: 0,
    calls: 4,
    sessions: 2,
    inputTokens: 400,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 2,
    oneShotTurns: 1,
    models: { legacy: modelStats(4, 40) },
    categories: { coding: { turns: 2, cost: 40, savingsUSD: 0, editTurns: 2, oneShotTurns: 1 } },
    providers: {
      claude: {
        calls: 4,
        cost: 40,
        savingsUSD: 0,
        sessions: 2,
        inputTokens: 400,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        editTurns: 2,
        oneShotTurns: 1,
        models: { legacy: modelStats(4, 40) },
        categories: { coding: { turns: 2, cost: 40, savingsUSD: 0, editTurns: 2, oneShotTurns: 1 } },
      },
    },
    carried: true,
  }
}

async function seedCache(): Promise<void> {
  const cache: DailyCache = {
    version: DAILY_CACHE_VERSION,
    savingsConfigHash: getDailyCacheConfigHash(),
    tzKey: currentTzKey(),
    lastComputedDate: daysAgoStr(1),
    days: [legacyDay(daysAgoStr(20)), splitDay(daysAgoStr(10))],
    complete: true,
    watermarkTrusted: true,
  }
  await writeFile(
    join(ROOT, 'cache', `daily-cache.v${DAILY_CACHE_VERSION}.json`),
    JSON.stringify(cache),
    'utf-8',
  )
}

async function payload(opts: { provider?: string; project?: string[]; exclude?: string[] } = {}) {
  clearSessionCache()
  return buildMenubarPayloadForRange(getDateRange('all'), {
    provider: opts.provider ?? 'all',
    project: opts.project,
    exclude: opts.exclude,
    optimize: false,
    timeline: false,
  })
}

function dailyCost(result: Awaited<ReturnType<typeof payload>>): number {
  return result.history.daily.reduce((sum, day) => sum + day.cost, 0)
}

function providerCost(result: Awaited<ReturnType<typeof payload>>): number {
  return result.current.providerDetails.reduce((sum, provider) => sum + provider.cost, 0)
}

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function projectCost(result: Awaited<ReturnType<typeof payload>>): number {
  return result.current.topProjects.reduce((sum, project) => sum + project.cost, 0)
}

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
  await seedCache()
})

afterEach(async () => {
  clearSessionCache()
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  if (existsSync(ROOT)) await rm(ROOT, { recursive: true, force: true })
})

describe('C4 project-filter durable reconciliation', () => {
  it('preserves unfiltered durable history and closes the project breakdown with Unattributed', async () => {
    const result = await payload()

    expect(result.current.cost).toBe(140)
    expect(dailyCost(result)).toBe(140)
    expect(providerCost(result)).toBe(140)
    expect(projectCost(result)).toBe(140)
    expect(result.current.topProjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'alpha', cost: 60 }),
      expect.objectContaining({ name: 'beta', cost: 30 }),
      expect.objectContaining({ name: 'Unattributed', cost: 50 }),
    ]))
  })

  it('applies --project to headline, history, providers and projects from the same durable split', async () => {
    const result = await payload({ project: ['alpha'] })

    expect(result.current.cost).toBe(60)
    expect(dailyCost(result)).toBe(60)
    expect(providerCost(result)).toBe(60)
    expect(projectCost(result)).toBe(60)
    expect(result.current.topProjects.map(project => project.name)).toEqual(['alpha'])
    expect(result.current.providerDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'claude', cost: 50 }),
      expect.objectContaining({ id: 'codex', cost: 10 }),
    ]))
  })

  it('applies --exclude while retaining honest unattributed history', async () => {
    const result = await payload({ exclude: ['alpha'] })

    expect(result.current.cost).toBe(80)
    expect(dailyCost(result)).toBe(80)
    expect(providerCost(result)).toBe(80)
    expect(projectCost(result)).toBe(80)
    expect(result.current.topProjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'beta', cost: 30 }),
      expect.objectContaining({ name: 'Unattributed', cost: 50 }),
    ]))
  })

  it('allows explicit selection of unattributed legacy history', async () => {
    const result = await payload({ project: ['unattributed'] })

    expect(result.current.cost).toBe(50)
    expect(dailyCost(result)).toBe(50)
    expect(providerCost(result)).toBe(50)
    expect(projectCost(result)).toBe(50)
    expect(result.current.topProjects).toEqual([
      expect.objectContaining({ name: 'Unattributed', cost: 50 }),
    ])
  })

  it('intersects provider and exclusion scopes without leaking another provider', async () => {
    const result = await payload({ provider: 'claude', exclude: ['alpha'] })

    expect(result.current.cost).toBe(65)
    expect(dailyCost(result)).toBe(65)
    expect(providerCost(result)).toBe(65)
    expect(projectCost(result)).toBe(65)
    expect(result.current.providerDetails).toEqual([
      expect.objectContaining({ id: 'claude', cost: 65 }),
    ])
    expect(result.current.topProjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'beta', cost: 20 }),
      expect.objectContaining({ name: 'Unattributed', cost: 45 }),
    ]))
  })
})
