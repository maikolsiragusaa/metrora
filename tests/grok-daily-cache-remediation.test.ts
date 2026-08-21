import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { DailyEntry, ProviderDaySlice } from '../src/daily-cache.js'

let root = ''
let previousCacheDir: string | undefined
let previousGrokHome: string | undefined
let sessionCacheApi: typeof import('../src/session-cache.js')

const SESSION_ID = '019edf9c-0000-7000-8000-000000000201'

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-21T12:00:00.000Z'))
  root = await mkdtemp(join(tmpdir(), 'metrora-grok-daily-'))
  previousCacheDir = process.env['METRORA_CACHE_DIR']
  previousGrokHome = process.env['GROK_HOME']
  process.env['METRORA_CACHE_DIR'] = join(root, 'metrora-cache')
  process.env['GROK_HOME'] = join(root, 'grok')
  await writeGrokSession()
  sessionCacheApi = await import('../src/session-cache.js')
})

afterEach(async () => {
  vi.useRealTimers()
  if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = previousCacheDir
  if (previousGrokHome === undefined) delete process.env['GROK_HOME']
  else process.env['GROK_HOME'] = previousGrokHome
  await rm(root, { recursive: true, force: true })
})

async function writeGrokSession(
  completedUsages: Array<{ promptId: string; usage: Record<string, unknown> }> = [{
    promptId: 'daily-prompt',
    usage: {
      inputTokens: 1000,
      outputTokens: 200,
      cachedReadTokens: 500,
      cacheCreationTokens: 100,
      reasoningTokens: 150,
      modelUsage: { 'grok-build': { inputTokens: 1000, outputTokens: 200 } },
    },
  }],
): Promise<void> {
  const sessionDir = join(process.env['GROK_HOME']!, 'sessions', '%2Fworkspace', SESSION_ID)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(join(sessionDir, 'summary.json'), JSON.stringify({
    info: { id: SESSION_ID, cwd: '/workspace/grok-daily' },
    created_at: '2026-08-17T10:00:00.000Z',
    updated_at: '2026-08-17T10:05:00.000Z',
    current_model_id: 'grok-build',
  }))
  await writeFile(join(sessionDir, 'signals.json'), JSON.stringify({ primaryModelId: 'grok-build' }))
  await writeFile(join(sessionDir, 'updates.jsonl'), [
    JSON.stringify({ params: { _meta: { totalTokens: 100, promptId: 'daily-prompt' }, update: { sessionUpdate: 'agent_message_chunk' } } }),
    ...completedUsages.map(completed => JSON.stringify({ params: {
      update: { sessionUpdate: 'turn_completed', prompt_id: completed.promptId, usage: completed.usage },
    } })),
  ].join('\n') + '\n')
}

function day(date: string, provider: string, slice: ProviderDaySlice, carried?: true): DailyEntry {
  return {
    date,
    cost: slice.cost,
    savingsUSD: slice.savingsUSD,
    calls: slice.calls,
    sessions: slice.sessions ?? 0,
    inputTokens: slice.inputTokens ?? 0,
    outputTokens: slice.outputTokens ?? 0,
    cacheReadTokens: slice.cacheReadTokens ?? 0,
    cacheWriteTokens: slice.cacheWriteTokens ?? 0,
    editTurns: slice.editTurns ?? 0,
    oneShotTurns: slice.oneShotTurns ?? 0,
    models: slice.models ?? {},
    categories: slice.categories ?? {},
    providers: { [provider]: slice },
    ...(carried ? { carried: true } : {}),
  }
}

async function authorities() {
  const daily = await import('../src/daily-cache.js')
  const config = await import('../src/daily-cache-config.js')
  const currentAuthority = sessionCacheApi.PROVIDER_PARSE_VERSIONS.grok!
  let oldHash: string
  try {
    sessionCacheApi.PROVIDER_PARSE_VERSIONS.grok = 'estimated-cost-v1'
    oldHash = config.getDailyCacheConfigHash()
  } finally {
    sessionCacheApi.PROVIDER_PARSE_VERSIONS.grok = currentAuthority
  }
  const currentHash = config.getDailyCacheConfigHash()
  return { daily, config, oldHash, currentHash }
}

describe('Grok daily-cache authority', () => {
  it('re-derives retained Grok source evidence without a global daily-version bump', async () => {
    const { daily, currentHash, oldHash } = await authorities()
    expect(daily.DAILY_CACHE_VERSION).toBe(19)
    expect(daily.DURABLE_HISTORY_AUTHORITY).toContain('codex-session-meta-model-v1')
    expect(currentHash).not.toBe(oldHash)
    expect(currentHash).toContain(`grokCollector=${sessionCacheApi.PROVIDER_PARSE_VERSIONS.grok}`)

    const baseline = daily.emptyCache(oldHash)
    baseline.complete = true
    baseline.watermarkTrusted = true
    baseline.durableHistoryAuthority = daily.DURABLE_HISTORY_AUTHORITY
    baseline.lastComputedDate = '2026-08-20'
    baseline.days = [day('2026-08-17', 'grok', {
      calls: 1,
      cost: 999,
      savingsUSD: 0,
      sessions: 1,
      inputTokens: 999,
      outputTokens: 999,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })]
    await daily.saveDailyCache(baseline)

    const { parseAllSessions } = await import('../src/parser.js')
    const { aggregateProjectsIntoDays } = await import('../src/day-aggregator.js')
    let observedStart: Date | undefined
    const migrated = await daily.ensureCacheHydrated(
      async range => {
        observedStart = range.start
        return parseAllSessions(range, 'grok')
      },
      aggregateProjectsIntoDays,
      currentHash,
      () => true,
      undefined,
      { durableHistoryAuthority: daily.DURABLE_HISTORY_AUTHORITY },
    )

    expect(observedStart).toEqual(new Date('2025-08-21T00:00:00.000Z'))
    const migratedDay = migrated.days.find(entry => entry.date === '2026-08-17')
    expect(migratedDay).toMatchObject({ inputTokens: 400, outputTokens: 200, cacheReadTokens: 500, cacheWriteTokens: 100 })
    expect(migratedDay?.providers.grok).toMatchObject({ inputTokens: 400, outputTokens: 200, cacheReadTokens: 500, cacheWriteTokens: 100 })
    expect(migratedDay?.carried).toBeUndefined()
  })

  it('carries sourceless Grok history exactly without inventing token splits', async () => {
    const { daily, currentHash, oldHash } = await authorities()
    const sourcelessSlice: ProviderDaySlice = {
      calls: 3,
      cost: 17.25,
      savingsUSD: 0,
      sessions: 2,
    }
    const baseline = daily.emptyCache(oldHash)
    baseline.complete = true
    baseline.watermarkTrusted = true
    baseline.durableHistoryAuthority = daily.DURABLE_HISTORY_AUTHORITY
    baseline.lastComputedDate = '2026-08-20'
    baseline.days = [day('2026-08-18', 'grok', sourcelessSlice)]
    await daily.saveDailyCache(baseline)
    await rm(process.env['GROK_HOME']!, { recursive: true, force: true })

    const carried = await daily.ensureCacheHydrated(
      async () => [],
      () => [],
      currentHash,
      () => true,
      undefined,
      { durableHistoryAuthority: daily.DURABLE_HISTORY_AUTHORITY },
    )
    const result = carried.days.find(entry => entry.date === '2026-08-18')
    expect(result?.carried).toBe(true)
    expect(result?.providers.grok).toEqual(sourcelessSlice)
    expect(result?.providers.grok).not.toHaveProperty('inputTokens')
    expect(result?.providers.grok).not.toHaveProperty('reasoningTokens')
  })

  it('keeps mixed reasoning non-additive in daily aggregation', async () => {
    await writeGrokSession([
      {
        promptId: 'observed-daily',
        usage: { inputTokens: 1000, outputTokens: 200, cachedReadTokens: 500, cacheCreationTokens: 100, reasoningTokens: 100 },
      },
      {
        promptId: 'unobserved-daily',
        usage: { inputTokens: 1200, outputTokens: 300, cachedReadTokens: 600, cacheCreationTokens: 100 },
      },
    ])
    const { parseAllSessions } = await import('../src/parser.js')
    const { aggregateProjectsIntoDays } = await import('../src/day-aggregator.js')
    const [entry] = aggregateProjectsIntoDays(await parseAllSessions(undefined, 'grok'))
    expect(entry).toMatchObject({ outputTokens: 500, reasoningTokens: 100, additiveReasoningTokens: 0 })
    expect(entry?.models['grok-build']).toMatchObject({ outputTokens: 500, reasoningTokens: 100, additiveReasoningTokens: 0, reasoningSemantics: 'mixed' })
    expect(entry?.providers.grok).toMatchObject({ outputTokens: 500, reasoningTokens: 100, additiveReasoningTokens: 0 })
  })

  it('keeps unavailable reasoning non-additive in daily aggregation', async () => {
    await writeGrokSession([{
      promptId: 'unavailable-daily',
      usage: { inputTokens: 1000, outputTokens: 200, cachedReadTokens: 500, cacheCreationTokens: 100 },
    }])
    const { parseAllSessions } = await import('../src/parser.js')
    const { aggregateProjectsIntoDays } = await import('../src/day-aggregator.js')
    const [entry] = aggregateProjectsIntoDays(await parseAllSessions(undefined, 'grok'))
    expect(entry).toMatchObject({ outputTokens: 200 })
    expect(entry).not.toHaveProperty('reasoningTokens')
    expect(entry?.models['grok-build']).toMatchObject({ outputTokens: 200, reasoningSemantics: 'unavailable' })
    expect(entry?.models['grok-build']).not.toHaveProperty('reasoningTokens')
    expect(entry?.models['grok-build']).not.toHaveProperty('additiveReasoningTokens')
  })
})
