import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadPersistedOptimizeResult, optimizeScanCacheKey, persistOptimizeResult } from './optimize-scan-cache.js'
import type { OptimizeResult } from './optimize.js'
import type { DateRange } from './types.js'

const range: DateRange = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 13) }
const scopeId = 'all'

function key(provider: string, scope = scopeId): string {
  return optimizeScanCacheKey(provider, range, scope)
}

function fakeResult(findingCount = 2): OptimizeResult {
  return {
    findings: Array.from({ length: findingCount }, (_, i) => ({ id: `f${i}` })),
    costRate: 1,
    healthScore: 90,
    healthGrade: 'A',
    modelRecommendations: [],
  } as unknown as OptimizeResult
}

let cacheDir: string

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'metrora-optimize-scan-'))
})

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true })
})

describe('persisted optimize scan cache', () => {
  it('serves the persisted result for the same key and fingerprint only', async () => {
    await persistOptimizeResult(cacheDir, key('all'), 'fp1', fakeResult(3))

    expect((await loadPersistedOptimizeResult(cacheDir, key('all'), 'fp1'))?.findings).toHaveLength(3)
    expect(await loadPersistedOptimizeResult(cacheDir, key('all'), 'fp2')).toBeNull()
    expect(await loadPersistedOptimizeResult(cacheDir, key('claude'), 'fp1')).toBeNull()
  })

  it('recovers when the cache file is corrupt or foreign', async () => {
    await writeFile(join(cacheDir, 'optimize-scan-cache.json'), 'not json at all')
    expect(await loadPersistedOptimizeResult(cacheDir, key('all'), 'fp1')).toBeNull()

    await persistOptimizeResult(cacheDir, key('all'), 'fp1', fakeResult(1))
    expect((await loadPersistedOptimizeResult(cacheDir, key('all'), 'fp1'))?.findings).toHaveLength(1)
  })

  it('drops entries whose payload no longer passes the shape gate', async () => {
    await persistOptimizeResult(cacheDir, key('all'), 'fp1', fakeResult(1))
    const raw = JSON.parse(await readFile(join(cacheDir, 'optimize-scan-cache.json'), 'utf-8')) as { entries: Record<string, { ts: number; result: unknown }> }
    raw.entries[key('all')]!.result = { findings: 'not-an-array' }
    await writeFile(join(cacheDir, 'optimize-scan-cache.json'), JSON.stringify(raw))

    expect(await loadPersistedOptimizeResult(cacheDir, key('all'), 'fp1')).toBeNull()
  })

  it('expires stale entries and caps the file by recency', async () => {
    for (let i = 0; i < 25; i++) {
      await persistOptimizeResult(cacheDir, key(`p${i}`), `fp${i}`, fakeResult(1))
    }

    const raw = JSON.parse(await readFile(join(cacheDir, 'optimize-scan-cache.json'), 'utf-8')) as { entries: Record<string, { ts: number }> }
    const entryKeys = Object.keys(raw.entries)
    expect(entryKeys.length).toBe(20)
    // The newest write must survive the cap.
    expect(entryKeys).toContain(key('p24'))

    raw.entries[key('p24')].ts = Date.now() - 31 * 24 * 60 * 60 * 1000
    await writeFile(join(cacheDir, 'optimize-scan-cache.json'), JSON.stringify(raw))
    expect(await loadPersistedOptimizeResult(cacheDir, key('p24'), 'fp24')).toBeNull()
  })
})
