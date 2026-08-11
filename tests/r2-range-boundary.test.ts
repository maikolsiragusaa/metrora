import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DateRange } from '../src/types.js'
import type { ParsedProviderCall, SessionSource } from '../src/providers/types.js'

let sources: SessionSource[] = []
let calls: ParsedProviderCall[] = []
let onFirstYield: (() => Promise<void>) | undefined

vi.mock('../src/providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/index.js')>()
  return {
    ...actual,
    async discoverAllSessions(filter?: string) {
      if (filter === 'r2-range') return sources
      return actual.discoverAllSessions(filter)
    },
    async getProvider(name: string) {
      if (name === 'r2-range') {
        return {
          name,
          displayName: 'R2 Range Fixture',
          durableSources: false,
          modelDisplayName: (model: string) => model,
          toolDisplayName: (tool: string) => tool,
          async discoverSessions() { return sources },
          createSessionParser(_source: SessionSource, seenKeys: Set<string>) {
            return {
              async *parse() {
                let first = true
                for (const call of calls) {
                  if (first) {
                    first = false
                    await onFirstYield?.()
                  }
                  if (seenKeys.has(call.deduplicationKey)) continue
                  seenKeys.add(call.deduplicationKey)
                  yield call
                }
              },
            }
          },
        }
      }
      return actual.getProvider(name)
    },
  }
})

const { clearSessionCache, filterProjectsByDateRange, filterProjectsByName, parseAllSessions } = await import('../src/parser.js')

let root = ''
let sourcePath = ''
const start = new Date('2026-08-11T12:00:00.000Z')
const end = new Date('2026-08-11T12:00:02.000Z')

function makeCall(key: string, timestamp: string, overrides: Partial<ParsedProviderCall> = {}): ParsedProviderCall {
  return {
    provider: 'r2-range',
    model: 'model-a',
    inputTokens: 10,
    outputTokens: 5,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    webSearchRequests: 0,
    costUSD: 1,
    tools: [],
    bashCommands: [],
    timestamp,
    speed: 'standard',
    deduplicationKey: key,
    turnId: 'turn-1',
    userMessage: 'work https://github.com/example/repo/pull/7',
    sessionId: 'session-1',
    project: 'range-project',
    projectPath: '/range-project',
    ...overrides,
  }
}

function range(startDate = start, endDate = end): DateRange {
  return { start: startDate, end: endDate }
}

function allCalls(projects: Awaited<ReturnType<typeof parseAllSessions>>) {
  return projects.flatMap(project => project.sessions).flatMap(session => session.turns).flatMap(turn => turn.assistantCalls)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'metrora-r2-range-'))
  sourcePath = join(root, 'fixture.source')
  await writeFile(sourcePath, 'fixture-1\n', 'utf8')
  vi.stubEnv('METRORA_CACHE_DIR', join(root, 'cache'))
  sources = [{ path: sourcePath, project: 'range-project', provider: 'r2-range' }]
  calls = []
  onFirstYield = undefined
  clearSessionCache()
})

afterEach(async () => {
  clearSessionCache()
  vi.unstubAllEnvs()
  sources = []
  calls = []
  onFirstYield = undefined
  await rm(root, { recursive: true, force: true })
})

describe('R2 exact call-range boundaries', () => {
  it('includes start/end exactly and excludes calls outside both boundaries', async () => {
    calls = [
      makeCall('before-start', '2026-08-11T11:59:59.999Z'),
      makeCall('at-start', '2026-08-11T12:00:00.000Z'),
      makeCall('at-end', '2026-08-11T12:00:02.000Z'),
      makeCall('after-end', '2026-08-11T12:00:02.001Z'),
    ]

    const result = await parseAllSessions(range(), 'r2-range')
    const selected = allCalls(result)
    expect(selected.map(call => call.deduplicationKey)).toEqual(['at-start', 'at-end'])
    expect(selected.reduce((sum, call) => sum + call.usage.inputTokens, 0)).toBe(20)
    expect(selected.reduce((sum, call) => sum + call.usage.outputTokens, 0)).toBe(10)
  })

  it('does not lose a later in-range call when the first call is before range.start', async () => {
    calls = [
      makeCall('before-start', '2026-08-11T11:59:59.999Z'),
      makeCall('after-start', '2026-08-11T12:00:00.001Z'),
    ]
    const result = await parseAllSessions(range(), 'r2-range')
    expect(allCalls(result).map(call => call.deduplicationKey)).toEqual(['after-start'])
  })

  it('rebuilds categories, model, tools, reasoning and cache totals from the sliced calls', async () => {
    calls = [
      makeCall('inside', '2026-08-11T12:00:01.000Z', {
        model: 'model-b', outputTokens: 9, reasoningTokens: 7, cacheReadInputTokens: 11,
        tools: ['Agent'],
      }),
      makeCall('outside', '2026-08-11T12:00:03.000Z', {
        model: 'model-c', outputTokens: 900, reasoningTokens: 800, cacheReadInputTokens: 700,
        tools: ['Bash'],
      }),
    ]
    const result = await parseAllSessions(range(), 'r2-range')
    const project = result[0]!
    const session = project.sessions[0]!
    const turn = session.turns[0]!
    expect(session.apiCalls).toBe(1)
    expect(session.totalOutputTokens).toBe(9)
    expect(session.totalReasoningTokens).toBe(7)
    expect(session.totalCacheReadTokens).toBe(11)
    expect(session.modelBreakdown['model-b']?.calls).toBe(1)
    expect(session.modelBreakdown['model-c']).toBeUndefined()
    expect(turn.assistantCalls[0]?.hasAgentSpawn).toBe(true)
    expect(turn.prRefs).toEqual(['https://github.com/example/repo/pull/7'])
    expect(project.totalApiCalls).toBe(1)
  })

  it('keeps entirely-inside and entirely-outside turns correct', async () => {
    calls = [
      makeCall('inside-a', '2026-08-11T12:00:00.100Z', { turnId: 'inside' }),
      makeCall('inside-b', '2026-08-11T12:00:01.100Z', { turnId: 'inside' }),
      makeCall('outside-a', '2026-08-11T12:00:03.100Z', { turnId: 'outside' }),
      makeCall('outside-b', '2026-08-11T12:00:04.100Z', { turnId: 'outside' }),
    ]
    const result = await parseAllSessions(range(), 'r2-range')
    expect(allCalls(result).map(call => call.deduplicationKey)).toEqual(['inside-a', 'inside-b'])
  })

  it('is deterministic across warm repeats and source appends after the cutoff', async () => {
    calls = [makeCall('inside', '2026-08-11T12:00:01.000Z')]
    const first = allCalls(await parseAllSessions(range(), 'r2-range'))
    clearSessionCache()
    calls = [...calls, makeCall('appended-after-cutoff', '2026-08-11T12:00:03.000Z')]
    await writeFile(sourcePath, 'fixture-2\n', 'utf8')
    const afterAppend = allCalls(await parseAllSessions(range(), 'r2-range'))
    clearSessionCache()
    const restart = allCalls(await parseAllSessions(range(), 'r2-range'))
    expect(afterAppend.map(call => call.deduplicationKey)).toEqual(['inside'])
    expect(restart.map(call => call.deduplicationKey)).toEqual(first.map(call => call.deduplicationKey))
  })

  it('isolates a source append that occurs while the range parse is in flight', async () => {
    calls = [makeCall('inside', '2026-08-11T12:00:01.000Z')]
    let appended = false
    onFirstYield = async () => {
      if (appended) return
      appended = true
      calls.push(makeCall('live-after-cutoff', '2026-08-11T12:00:03.000Z'))
      await writeFile(sourcePath, 'fixture-live-2\n', 'utf8')
    }

    const inFlight = allCalls(await parseAllSessions(range(), 'r2-range'))
    expect(inFlight.map(call => call.deduplicationKey)).toEqual(['inside'])

    clearSessionCache()
    const warm = allCalls(await parseAllSessions(range(), 'r2-range'))
    expect(warm.map(call => call.deduplicationKey)).toEqual(['inside'])

    clearSessionCache()
    const allTime = allCalls(await parseAllSessions(undefined, 'r2-range'))
    expect(allTime.map(call => call.deduplicationKey)).toEqual(['inside', 'live-after-cutoff'])
  })

  it('clips the already-materialized wide projection without stale turn aggregates', async () => {
    calls = [
      makeCall('before', '2026-08-11T11:59:59.000Z'),
      makeCall('inside', '2026-08-11T12:00:01.000Z'),
      makeCall('after', '2026-08-11T12:00:03.000Z'),
    ]
    const wide = await parseAllSessions(undefined, 'r2-range')
    const filtered = filterProjectsByDateRange(wide, range())
    expect(allCalls(filtered).map(call => call.deduplicationKey)).toEqual(['inside'])
    expect(filtered[0]!.totalApiCalls).toBe(1)
    expect(filterProjectsByName(filtered, ['range-project'], ['other'])).toHaveLength(1)
  })

  it('handles a local-midnight crossing by exact call time while retaining the turn context', async () => {
    const midnightStart = new Date('2026-08-11T00:00:00.000Z')
    const midnightEnd = new Date('2026-08-11T00:00:01.000Z')
    calls = [
      makeCall('previous-day', '2026-08-10T23:59:59.999Z'),
      makeCall('new-day', '2026-08-11T00:00:00.000Z'),
    ]
    const result = await parseAllSessions(range(midnightStart, midnightEnd), 'r2-range')
    expect(allCalls(result).map(call => call.deduplicationKey)).toEqual(['new-day'])
  })
})
