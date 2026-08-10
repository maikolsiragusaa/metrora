import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  DAILY_CACHE_VERSION,
  currentTzKey,
  dailyCachePath,
  emptyCache,
  loadDailyCache,
  type DailyCache,
} from '../src/daily-cache.js'

let root: string

function envelope(overrides: Partial<DailyCache> = {}): DailyCache {
  return {
    version: DAILY_CACHE_VERSION,
    savingsConfigHash: 'cfg',
    tzKey: currentTzKey(),
    lastComputedDate: '2026-08-02',
    days: [],
    complete: true,
    watermarkTrusted: true,
    ...overrides,
  }
}

async function persistedTrust(): Promise<unknown> {
  return (JSON.parse(await readFile(dailyCachePath(), 'utf-8')) as { watermarkTrusted?: unknown }).watermarkTrusted
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
  root = join(tmpdir(), `metrora-daily-adoption-${Math.random().toString(36).slice(2)}`)
  process.env['METRORA_CACHE_DIR'] = root
  await mkdir(root, { recursive: true })
})

afterEach(async () => {
  vi.useRealTimers()
  if (existsSync(root)) await rm(root, { recursive: true, force: true })
})

describe('trusted watermark envelope propagation', () => {
  it('adopts and durably persists a trusted same-version legacy envelope', async () => {
    await writeFile(join(root, 'daily-cache.json'), JSON.stringify(envelope()), 'utf-8')

    const loaded = await loadDailyCache()
    expect(loaded.watermarkTrusted).toBe(true)
    expect(loaded.complete).toBe(true)
    expect(existsSync(dailyCachePath())).toBe(true)
    expect(await persistedTrust()).toBe(true)
    expect((await loadDailyCache()).watermarkTrusted).toBe(true)
  })

  it('durably preserves a trusted stamp while migrating a supported active envelope', async () => {
    await writeFile(dailyCachePath(), JSON.stringify(envelope({ version: DAILY_CACHE_VERSION - 1 })), 'utf-8')

    const loaded = await loadDailyCache()
    expect(loaded.version).toBe(DAILY_CACHE_VERSION)
    expect(loaded.watermarkTrusted).toBe(true)
    expect(await persistedTrust()).toBe(true)
    expect((await loadDailyCache()).watermarkTrusted).toBe(true)
  })

  it('never transfers trust from an unsupported active envelope to an adopted cache', async () => {
    await writeFile(dailyCachePath(), JSON.stringify(envelope({ version: DAILY_CACHE_VERSION - 2 })), 'utf-8')
    await writeFile(join(root, 'daily-cache.json'), JSON.stringify(envelope({ watermarkTrusted: false })), 'utf-8')

    const loaded = await loadDailyCache()
    expect(loaded.version).toBe(DAILY_CACHE_VERSION)
    expect(loaded.watermarkTrusted).toBe(false)
  })

  it('keeps an empty new cache explicitly untrusted until a complete parse finalizes it', () => {
    expect(emptyCache().watermarkTrusted).toBe(false)
  })
})
