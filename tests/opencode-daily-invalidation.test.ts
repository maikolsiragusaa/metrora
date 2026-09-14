import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  clearOpenCodeDailyInvalidations,
  flushOpenCodeDailyInvalidations,
  readOpenCodeDailyInvalidatedDays,
  recordOpenCodeSourceChange,
} from '../src/opencode-daily-invalidation.js'

describe('OpenCode daily invalidation manifest', () => {
  let cacheDir: string
  let previousCacheDir: string | undefined

  beforeEach(async () => {
    previousCacheDir = process.env['METRORA_CACHE_DIR']
    cacheDir = await mkdtemp(join(tmpdir(), 'metrora-opencode-daily-'))
    process.env['METRORA_CACHE_DIR'] = cacheDir
  })

  afterEach(async () => {
    if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
    else process.env['METRORA_CACHE_DIR'] = previousCacheDir
    await rm(cacheDir, { recursive: true, force: true })
  })

  it('persists both the previous and current turn days, then clears them', async () => {
    recordOpenCodeSourceChange(
      'opencode',
      [{ timestamp: '2026-09-12T12:00:00.000Z' }],
      [{ timestamp: '2026-09-13T12:05:00.000Z' }],
    )
    recordOpenCodeSourceChange('claude', [{ timestamp: '2026-09-11T00:00:00.000Z' }], [])
    await flushOpenCodeDailyInvalidations()

    expect(await readOpenCodeDailyInvalidatedDays()).toEqual(['2026-09-12', '2026-09-13'])
    const manifest = JSON.parse(await readFile(join(cacheDir, 'opencode-daily-invalidations.v1.json'), 'utf8')) as { version: number; days: string[] }
    expect(manifest).toEqual({ version: 1, days: ['2026-09-12', '2026-09-13'] })

    await clearOpenCodeDailyInvalidations()
    expect(await readOpenCodeDailyInvalidatedDays()).toEqual([])
  })

  it('merges a later source change with an existing manifest', async () => {
    recordOpenCodeSourceChange('opencode', [{ timestamp: '2026-09-01T10:00:00.000Z' }], [])
    await flushOpenCodeDailyInvalidations()
    recordOpenCodeSourceChange('opencode', [{ timestamp: '2026-09-02T10:00:00.000Z' }], [])
    await flushOpenCodeDailyInvalidations()

    expect(await readOpenCodeDailyInvalidatedDays()).toEqual(['2026-09-01', '2026-09-02'])
  })
})
