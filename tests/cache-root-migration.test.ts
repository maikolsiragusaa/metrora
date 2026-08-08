import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import type { ProjectSummary } from '../src/types.js'
import {
  DAILY_CACHE_VERSION,
  currentTzKey,
  dailyCachePath,
  ensureCacheHydrated,
  loadDailyCache,
  type DailyEntry,
  type DailyCache,
  type ProviderDaySlice,
} from '../src/daily-cache.js'
import {
  CACHE_VERSION,
  loadCache,
  sessionCachePath,
  type CachedFile,
  type SessionCache,
} from '../src/session-cache.js'
import { cacheMigrationMarkerPath } from '../src/cache-migration.js'

let root: string
let canonical: string
let legacy: string

function slice(cost: number, calls: number, extra: Partial<ProviderDaySlice> = {}): ProviderDaySlice {
  return { cost, calls, savingsUSD: 0, ...extra }
}

function day(date: string, providers: Record<string, ProviderDaySlice>, overrides: Partial<DailyEntry> = {}): DailyEntry {
  const cost = Object.values(providers).reduce((sum, provider) => sum + provider.cost, 0)
  const calls = Object.values(providers).reduce((sum, provider) => sum + provider.calls, 0)
  return {
    date,
    cost,
    savingsUSD: 0,
    calls,
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: {},
    categories: {},
    providers,
    ...overrides,
  }
}

function envelope(days: DailyEntry[], overrides: Partial<DailyCache> = {}): DailyCache {
  return {
    version: DAILY_CACHE_VERSION,
    savingsConfigHash: 'cfg-A',
    tzKey: currentTzKey(),
    lastComputedDate: '2026-08-07',
    days,
    complete: true,
    ...overrides,
  }
}

async function writeLegacyDaily(cache: DailyCache, name = `daily-cache.v${DAILY_CACHE_VERSION}.json`): Promise<string> {
  const path = join(legacy, name)
  await writeFile(path, JSON.stringify(cache), 'utf-8')
  return path
}

async function writeCanonicalDaily(cache: DailyCache): Promise<void> {
  await mkdir(canonical, { recursive: true })
  await writeFile(dailyCachePath(), JSON.stringify(cache), 'utf-8')
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'))
  root = await mkdtemp(join(tmpdir(), 'metrora-cache-root-migration-'))
  canonical = join(root, 'metrora')
  legacy = join(root, 'previous-cache')
  await mkdir(legacy, { recursive: true })
  process.env['METRORA_CACHE_DIR'] = canonical
  process.env['CODEBURN_CACHE_DIR'] = legacy
})

afterEach(async () => {
  vi.useRealTimers()
  delete process.env['CODEBURN_CACHE_DIR']
  delete process.env['METRORA_CACHE_DIR']
  if (existsSync(root)) await rm(root, { recursive: true, force: true })
})

describe('read-only legacy usage-root migration', () => {
  it('fresh install stays Metrora-only and does not mint a migration marker', async () => {
    const loaded = await loadDailyCache()
    expect(loaded.days).toEqual([])
    expect(existsSync(canonical)).toBe(false)
    expect(existsSync(cacheMigrationMarkerPath(canonical, 'daily-cache'))).toBe(false)
  })

  it('imports a previous-root-only durable history into canonical storage', async () => {
    const saved = envelope([day('2026-07-01', { codex: slice(12, 4) })])
    const sourcePath = await writeLegacyDaily(saved)
    const before = await readFile(sourcePath, 'utf-8')

    const loaded = await loadDailyCache()

    expect(loaded.days[0]).toMatchObject({ date: '2026-07-01', cost: 12, calls: 4, carried: true })
    expect(loaded.complete).toBe(false)
    expect(existsSync(dailyCachePath())).toBe(true)
    expect(existsSync(cacheMigrationMarkerPath(canonical, 'daily-cache'))).toBe(true)
    expect(await readFile(sourcePath, 'utf-8')).toBe(before)
  })

  it('leaves canonical-only history untouched when no previous source is present', async () => {
    const saved = envelope([day('2026-08-01', { codex: slice(8, 2) })], { watermarkTrusted: true })
    await writeCanonicalDaily(saved)

    const loaded = await loadDailyCache()

    expect(loaded.days).toHaveLength(1)
    expect(loaded.days[0]).toMatchObject({ date: '2026-08-01', cost: 8, calls: 2 })
    expect(loaded.days[0]!.carried).toBeUndefined()
    expect(existsSync(cacheMigrationMarkerPath(canonical, 'daily-cache'))).toBe(false)
  })

  it('unions disjoint canonical and previous-root days without losing either side', async () => {
    await writeCanonicalDaily(envelope([day('2026-08-01', { codex: slice(8, 2) })]))
    await writeLegacyDaily(envelope([day('2026-08-02', { antigravity: slice(5, 1) })]))

    const loaded = await loadDailyCache()

    expect(loaded.days.map(entry => entry.date)).toEqual(['2026-08-01', '2026-08-02'])
    expect(loaded.days[0]!.providers.codex).toMatchObject({ cost: 8, calls: 2 })
    expect(loaded.days[1]!.providers.antigravity).toMatchObject({ cost: 5, calls: 1 })
    expect(loaded.days[1]!.carried).toBe(true)
  })

  it('uses canonical data on overlap and adds only legacy-only provider slices', async () => {
    await writeCanonicalDaily(envelope([day('2026-08-01', { codex: slice(8, 2) })]))
    const source = envelope([day('2026-08-01', { codex: slice(80, 20), claude: slice(3, 1) })])
    const sourcePath = await writeLegacyDaily(source)

    const loaded = await loadDailyCache()
    const merged = loaded.days[0]!

    expect(merged.providers.codex).toMatchObject({ cost: 8, calls: 2 })
    expect(merged.providers.claude).toMatchObject({ cost: 3, calls: 1 })
    expect(merged.cost).toBe(11)
    expect(merged.calls).toBe(3)
    expect(JSON.parse(await readFile(sourcePath, 'utf-8'))).toEqual(source)
  })

  it('keeps a carried legacy slice when no raw source can reproduce it', async () => {
    await writeLegacyDaily(envelope([day('2026-07-20', { copilot: slice(17, 7) })]))

    const loaded = await ensureCacheHydrated(
      async (): Promise<ProjectSummary[]> => [],
      () => [],
      'cfg-A',
      () => true,
    )

    expect(loaded.days).toHaveLength(1)
    expect(loaded.days[0]).toMatchObject({ date: '2026-07-20', cost: 17, calls: 7, carried: true })
  })

  it('lets a complete raw re-derivation replace an imported carried slice', async () => {
    await writeLegacyDaily(envelope([day('2026-08-05', { codex: slice(99, 9) })]))

    const loaded = await ensureCacheHydrated(
      async (): Promise<ProjectSummary[]> => [],
      () => [day('2026-08-05', { codex: slice(10, 1) })],
      'cfg-A',
      () => true,
    )

    expect(loaded.days[0]!.providers.codex).toMatchObject({ cost: 10, calls: 1 })
    expect(loaded.days[0]!.cost).toBe(10)
    expect(loaded.days[0]!.carried).toBeUndefined()
  })

  it('does not let an incomplete canonical slice shadow a more complete previous baseline', async () => {
    await writeCanonicalDaily(envelope([day('2026-08-04', { codex: slice(2, 1) })], { complete: false }))
    await writeLegacyDaily(envelope([day('2026-08-04', { codex: slice(20, 10) })]))

    const loaded = await loadDailyCache()

    expect(loaded.days[0]!.providers.codex).toMatchObject({ cost: 20, calls: 10 })
    expect(loaded.days[0]!.cost).toBe(20)
    expect(loaded.complete).toBe(false)
  })

  it('is idempotent and stops reading a changed previous root after success', async () => {
    const source = envelope([day('2026-07-30', { codex: slice(4, 2) })])
    await writeLegacyDaily(source)
    const first = await loadDailyCache()
    await writeLegacyDaily(envelope([day('2000-01-01', { codex: slice(999, 999) })]))

    const second = await loadDailyCache()

    expect(second.days).toEqual(first.days)
    expect(second.days.some(entry => entry.date === '2000-01-01')).toBe(false)
  })

  it('repeats safely after an interruption between canonical publish and marker publish', async () => {
    await writeLegacyDaily(envelope([day('2026-07-29', { codex: slice(6, 3) })]))
    const first = await loadDailyCache()
    await rm(cacheMigrationMarkerPath(canonical, 'daily-cache'))

    const second = await loadDailyCache()

    expect(second.days).toEqual(first.days)
    expect(second.days[0]!.cost).toBe(6)
    expect(second.days[0]!.calls).toBe(3)
    expect(existsSync(cacheMigrationMarkerPath(canonical, 'daily-cache'))).toBe(true)
  })

  it('ignores a malformed previous cache without damaging a valid canonical cache', async () => {
    const saved = envelope([day('2026-08-03', { codex: slice(13, 5) })])
    await writeCanonicalDaily(saved)
    const before = await readFile(dailyCachePath(), 'utf-8')
    await writeFile(join(legacy, `daily-cache.v${DAILY_CACHE_VERSION}.json`), '{not-json', 'utf-8')

    const loaded = await loadDailyCache()

    expect(loaded.days[0]).toMatchObject({ date: '2026-08-03', cost: 13, calls: 5 })
    expect(await readFile(dailyCachePath(), 'utf-8')).toBe(before)
    expect(existsSync(cacheMigrationMarkerPath(canonical, 'daily-cache'))).toBe(false)
  })
})

describe('safe durable session-cache adoption', () => {
  function cachedFile(pathSeed: string): CachedFile {
    return {
      fingerprint: { dev: 1, ino: pathSeed.length, mtimeMs: 100, sizeBytes: 20 },
      mcpInventory: [],
      turns: [],
    }
  }

  it('adopts only durable Copilot files, keeps canonical collisions authoritative, and never copies derived caches', async () => {
    await mkdir(canonical, { recursive: true })
    const canonicalFile = cachedFile('canonical')
    const legacyOnlyFile = cachedFile('legacy-only')
    const canonicalSession: SessionCache = {
      version: CACHE_VERSION,
      providers: {
        copilot: {
          envFingerprint: 'canonical',
          durable: true,
          files: { 'C:\\source\\same.db': canonicalFile },
        },
      },
      complete: true,
    }
    const legacySession: SessionCache = {
      version: CACHE_VERSION,
      providers: {
        copilot: {
          envFingerprint: 'legacy',
          durable: true,
          files: {
            'C:\\source\\same.db': cachedFile('legacy-same'),
            'C:\\source\\old.db': legacyOnlyFile,
          },
        },
        codex: {
          envFingerprint: 'legacy-codex',
          files: {},
        },
      },
      complete: true,
    }
    await writeFile(sessionCachePath(), JSON.stringify(canonicalSession), 'utf-8')
    const sourcePath = join(legacy, `session-cache.v${CACHE_VERSION}.json`)
    await writeFile(sourcePath, JSON.stringify(legacySession), 'utf-8')
    await writeFile(join(legacy, 'codex-results.json'), JSON.stringify({ version: 10, files: { old: {} } }), 'utf-8')
    await writeFile(join(legacy, 'antigravity-results.json'), JSON.stringify({ version: 5, cascades: { old: {} } }), 'utf-8')
    const before = await readFile(sourcePath, 'utf-8')

    const loaded = await loadCache()

    const files = loaded.providers.copilot!.files
    expect(files['C:\\source\\same.db']).toEqual(canonicalFile)
    expect(files['C:\\source\\old.db']).toEqual(legacyOnlyFile)
    expect(loaded.providers.codex).toBeUndefined()
    expect(existsSync(join(canonical, 'codex-results.json'))).toBe(false)
    expect(existsSync(join(canonical, 'antigravity-results.json'))).toBe(false)
    expect(await readFile(sourcePath, 'utf-8')).toBe(before)
    expect(existsSync(cacheMigrationMarkerPath(canonical, 'session-cache'))).toBe(true)
  })
})
