import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  buildDurablePeriod,
  getDailyCacheConfigHash,
} from '../src/usage-aggregator.js'
import { clearSessionCache } from '../src/parser.js'
import { emptyCache, ensureCacheHydrated, saveDailyCache, type DailyEntry } from '../src/daily-cache.js'

let homeDir: string
let cacheDir: string
let workspaceStorageDir: string
let alternateWorkspaceStorageDir: string | undefined

const historicalTimestamp = 1_784_000_000_000

function request(requestId: string, inputTokens: number, outputTokens: number, model = 'gpt-5.4'): Record<string, unknown> {
  return {
    requestId,
    timestamp: historicalTimestamp,
    modelId: `copilot/${model}`,
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    result: { metadata: { resolvedModel: model } },
  }
}

function journal(requests: Array<Record<string, unknown>>, sessionId = 'late-journal-session'): string {
  return `${JSON.stringify({
    kind: 0,
    v: {
      sessionId,
      creationDate: historicalTimestamp,
      requests,
    },
  })}\n`
}

function dayBounds(timestamp: number): { start: Date; end: Date } {
  const date = new Date(timestamp)
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

describe('Copilot late current-journal daily reconciliation', () => {
  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'metrora-copilot-late-home-'))
    cacheDir = await mkdtemp(join(tmpdir(), 'metrora-copilot-late-cache-'))
    workspaceStorageDir = await mkdtemp(join(tmpdir(), 'metrora-copilot-late-ws-'))

    await mkdir(join(workspaceStorageDir, 'workspace-hash', 'chatSessions'), { recursive: true })

    process.env['HOME'] = homeDir
    process.env['METRORA_CACHE_DIR'] = cacheDir
    process.env['METRORA_COPILOT_DISABLE_OTEL'] = '1'
    process.env['METRORA_COPILOT_SESSION_STATE_DIR'] = join(homeDir, 'no-session-state')
    process.env['METRORA_COPILOT_GLOBAL_STORAGE_DIR'] = join(homeDir, 'no-global-storage')
    process.env['METRORA_COPILOT_JETBRAINS_DIR'] = join(homeDir, 'no-jetbrains')
    process.env['METRORA_COPILOT_WS_STORAGE_DIR'] = workspaceStorageDir
  })

  afterEach(async () => {
    clearSessionCache()
    await rm(homeDir, { recursive: true, force: true })
    await rm(cacheDir, { recursive: true, force: true })
    await rm(workspaceStorageDir, { recursive: true, force: true })
    if (alternateWorkspaceStorageDir) await rm(alternateWorkspaceStorageDir, { recursive: true, force: true })
    alternateWorkspaceStorageDir = undefined
  })

  it('reconciles daily history after a late mutation of the same journal path', async () => {
    const journalPath = join(workspaceStorageDir, 'workspace-hash', 'chatSessions', 'late.jsonl')
    const requestA = request('request-a', 100, 10)
    const requestB = request('request-b', 200, 20)
    await writeFile(journalPath, journal([requestA, requestB]), 'utf-8')

    const bounds = dayBounds(historicalTimestamp)
    const range = { start: bounds.start, end: bounds.end }
    const first = await buildDurablePeriod({ range, label: 'historical' })
    const firstDay = first.cache.days.find(day => day.date === first.cache.days[0]?.date)
    expect(firstDay?.providers.copilot?.calls).toBe(2)

    const before = await stat(journalPath)
    await writeFile(journalPath, journal([requestA]), 'utf-8')
    await utimes(journalPath, new Date(), new Date(Date.now() + 2_000))
    const after = await stat(journalPath)
    expect(after.mtimeMs).not.toBe(before.mtimeMs)

    // A new lifecycle sees the changed source and the session snapshot converges.
    clearSessionCache()
    const second = await buildDurablePeriod({ range, label: 'historical' })
    const secondDay = second.cache.days.find(day => day.date === firstDay?.date)

    expect(second.liveProjects.flatMap(project => project.sessions).flatMap(session => session.turns).flatMap(turn => turn.assistantCalls)).toHaveLength(1)
    expect(secondDay?.providers.copilot?.calls).toBe(1)
    expect(second.data.calls).toBe(1)
  })

  it('preserves unrelated sourceless durable provider slices on the affected day', async () => {
    const date = '2026-07-14'
    const baseline: DailyEntry = {
      date,
      cost: 0.004,
      savingsUSD: 0,
      calls: 5,
      sessions: 2,
      inputTokens: 300,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      editTurns: 0,
      oneShotTurns: 0,
      models: {},
      categories: {},
      providers: {
        copilot: { calls: 2, cost: 0.002, savingsUSD: 0, sessions: 1 },
        otel: { calls: 3, cost: 0.002, savingsUSD: 0, sessions: 1 },
      },
    }
    const fresh: DailyEntry = {
      ...baseline,
      cost: 0.001,
      calls: 1,
      sessions: 1,
      inputTokens: 100,
      outputTokens: 10,
      providers: {
        copilot: { calls: 1, cost: 0.001, savingsUSD: 0, sessions: 1 },
      },
    }
    const seeded = emptyCache('cfg')
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    seeded.lastComputedDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    seeded.complete = true
    seeded.watermarkTrusted = true
    seeded.days = [baseline]
    await saveDailyCache(seeded)

    const reconciled = await ensureCacheHydrated(
      async () => [],
      () => [fresh],
      'cfg',
      () => true,
      undefined,
      { reconcileProviderDays: { copilot: [date] } },
    )
    const day = reconciled.days.find(entry => entry.date === date)

    expect(day?.providers.copilot?.calls).toBe(1)
    expect(day?.providers.otel?.calls).toBe(3)
    expect(day?.calls).toBe(4)
    expect(day?.cost).toBeCloseTo(0.003)
  })

  it('characterizes an explicit workspace-root switch as a separate source identity', async () => {
    const rootAPath = join(workspaceStorageDir, 'workspace-a', 'chatSessions', 'a.jsonl')
    await mkdir(join(workspaceStorageDir, 'workspace-a', 'chatSessions'), { recursive: true })
    await writeFile(rootAPath, journal([request('request-a', 100, 10)], 'root-a-session'), 'utf-8')

    const bounds = dayBounds(historicalTimestamp)
    const range = { start: bounds.start, end: bounds.end }
    await buildDurablePeriod({ range, label: 'historical' })
    const sourceHash = getDailyCacheConfigHash()

    alternateWorkspaceStorageDir = await mkdtemp(join(tmpdir(), 'metrora-copilot-switch-ws-'))
    const rootBDir = join(alternateWorkspaceStorageDir, 'workspace-b', 'chatSessions')
    await mkdir(rootBDir, { recursive: true })
    await writeFile(join(rootBDir, 'b.jsonl'), journal([request('request-b', 100, 20, 'gpt-4.1')], 'root-b-session'), 'utf-8')
    process.env['METRORA_COPILOT_WS_STORAGE_DIR'] = alternateWorkspaceStorageDir
    expect(getDailyCacheConfigHash()).toBe(sourceHash)

    clearSessionCache()
    const switched = await buildDurablePeriod({ range, label: 'historical' })
    const liveCalls = switched.liveProjects.flatMap(project => project.sessions).flatMap(session => session.turns).flatMap(turn => turn.assistantCalls)
    const day = switched.cache.days.find(entry => entry.date === switched.cache.days[0]?.date)

    expect(liveCalls).toHaveLength(1)
    expect(liveCalls[0]?.model).toBe('gpt-4.1')
    expect(day?.models['gpt-5.4']?.calls).toBe(1)
    expect(day?.models['gpt-4.1']).toBeUndefined()
  })
})
