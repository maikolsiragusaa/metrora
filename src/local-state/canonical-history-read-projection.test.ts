import { describe, expect, it } from 'vitest'

import { DAILY_CACHE_VERSION, type DailyCache, type DailyEntry } from '../daily-cache.js'
import { CACHE_VERSION, type CachedCall, type CachedFile, type SessionCache } from '../session-cache.js'
import {
  CanonicalHistoryReadProjectionIntegrityError,
  projectCanonicalHistoryReadV1,
} from './canonical-history-read-projection.js'

const ENDPOINT_ID = 'ep_11111111-2222-4333-8444-555555555555'

function call(overrides: Partial<CachedCall> = {}): CachedCall {
  return {
    provider: 'zed',
    model: 'gpt-5.6-luna',
    modelProvider: 'zed.dev',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 25,
      cachedInputTokens: 25,
      reasoningTokens: 5,
      webSearchRequests: 0,
      cacheCreationOneHourTokens: 0,
    },
    costUSD: 1.25,
    costAssignment: {
      version: 1,
      kind: 'metered',
      amountMicrosUsd: 1_250_000,
      source: 'provider',
    },
    speed: 'standard',
    timestamp: '2026-08-01T21:00:01.000Z',
    tools: [],
    bashCommands: [],
    skills: [],
    subagentTypes: [],
    deduplicationKey: 'zed:thread-1:request-1',
    ...overrides,
  }
}

function cachedFile(calls: CachedCall[], overrides: Partial<CachedFile> = {}): CachedFile {
  return {
    fingerprint: { dev: 1, ino: 2, mtimeMs: 3, sizeBytes: 4 },
    mcpInventory: [],
    turns: [{
      timestamp: '2026-08-01T21:00:00.000Z',
      sessionId: 'private-session-id',
      userMessage: 'private prompt must not cross the projection',
      calls,
    }],
    ...overrides,
  }
}

function sessionCache(files: Record<string, CachedFile>, complete = true): SessionCache {
  return {
    version: CACHE_VERSION,
    complete,
    providers: {
      zed: { envFingerprint: 'zed-test', files },
    },
  }
}

function day(overrides: Partial<DailyEntry> = {}): DailyEntry {
  return {
    date: '2026-08-01',
    cost: 1.25,
    savingsUSD: 0,
    calls: 1,
    sessions: 1,
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 25,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 1,
    models: {
      'gpt-5.6-luna': {
        calls: 1,
        cost: 1.25,
        savingsUSD: 0,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 25,
        cacheWriteTokens: 0,
      },
    },
    categories: {
      coding: { turns: 1, cost: 1.25, savingsUSD: 0, editTurns: 0, oneShotTurns: 1 },
    },
    providers: {
      zed: {
        calls: 1,
        cost: 1.25,
        savingsUSD: 0,
        sessions: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 25,
        cacheWriteTokens: 0,
        projects: {
          privateProject: { cost: 1.25, calls: 1, savingsUSD: 0, sessions: 1, path: '/private/project/path' },
        },
      },
    },
    projects: {
      privateProject: { cost: 1.25, calls: 1, savingsUSD: 0, sessions: 1, path: '/private/project/path' },
    },
    ...overrides,
  }
}

function dailyCache(days: DailyEntry[], options: { tzKey?: string; complete?: boolean; trusted?: boolean } = {}): DailyCache {
  return {
    version: DAILY_CACHE_VERSION,
    savingsConfigHash: 'test',
    tzKey: options.tzKey ?? 'Europe/Rome',
    lastComputedDate: days.at(-1)?.date ?? null,
    days,
    complete: options.complete ?? true,
    watermarkTrusted: options.trusted ?? true,
  }
}

function project(input: { sessions?: SessionCache; days?: DailyCache } = {}) {
  return projectCanonicalHistoryReadV1({
    endpointId: ENDPOINT_ID,
    sessionCache: input.sessions ?? sessionCache({ '/private/source-a': cachedFile([call()]) }),
    dailyCache: input.days ?? dailyCache([day()]),
  })
}

describe('canonical history read projection v1', () => {
  it('keeps observation and activity identity independent from path, cache order, and timezone buckets', () => {
    const first = project()
    const moved = project({
      sessions: sessionCache({ '/another/private/location': cachedFile([call()]) }),
      days: dailyCache([day({ date: '2026-07-31' })], { tzKey: 'America/New_York' }),
    })

    expect(moved.observations.map(value => value.observationId)).toEqual(first.observations.map(value => value.observationId))
    expect(moved.activities.map(value => value.activityId)).toEqual(first.activities.map(value => value.activityId))
    expect(moved.dailySnapshots[0]!.date).not.toBe(first.dailySnapshots[0]!.date)
    expect(moved.dailySnapshots[0]!.snapshotId).not.toBe(first.dailySnapshots[0]!.snapshotId)
  })

  it('is content-minimal and does not expose path, prompt, session id, or private deduplication material', () => {
    const serialized = JSON.stringify(project())

    expect(serialized).not.toContain('/private/source-a')
    expect(serialized).not.toContain('/private/project/path')
    expect(serialized).not.toContain('private prompt')
    expect(serialized).not.toContain('private-session-id')
    expect(serialized).not.toContain('zed:thread-1:request-1')
    expect(serialized).toContain('privateProject')
  })

  it('deduplicates identical cache materializations and rejects conflicting reuse of one source identity', () => {
    const duplicate = project({
      sessions: sessionCache({
        '/private/source-a': cachedFile([call()]),
        '/private/source-b': cachedFile([call()]),
      }),
    })
    expect(duplicate.observations).toHaveLength(1)
    expect(duplicate.activities).toHaveLength(1)

    expect(() => project({
      sessions: sessionCache({
        '/private/source-a': cachedFile([call()]),
        '/private/source-b': cachedFile([call({ model: 'different-model' })]),
      }),
    })).toThrow(CanonicalHistoryReadProjectionIntegrityError)
  })

  it('preserves source-less carried history without inventing observations or activities', () => {
    const projection = project({
      sessions: {
        version: CACHE_VERSION,
        complete: true,
        providers: {},
      },
      days: dailyCache([day({ carried: true })]),
    })

    expect(projection.observations).toEqual([])
    expect(projection.activities).toEqual([])
    expect(projection.dailySnapshots).toHaveLength(1)
    expect(projection.dailySnapshots[0]).toMatchObject({
      carried: true,
      authority: 'trusted-daily-cache',
    })
    expect(projection.authority.additiveAcrossAuthorities).toBe(false)
  })

  it('keeps metered, explicit-zero, legacy-frozen, and unavailable cost evidence distinct', () => {
    const projection = project({
      sessions: sessionCache({
        '/private/source-a': cachedFile([
          call({ deduplicationKey: 'metered' }),
          call({
            deduplicationKey: 'zero',
            costUSD: 0,
            costAssignment: { version: 1, kind: 'explicit-zero', amountMicrosUsd: 0, reason: 'free-route' },
          }),
          call({
            deduplicationKey: 'legacy',
            costUSD: 1.5,
            costAssignment: { version: 1, kind: 'legacy-frozen', amountMicrosUsd: 1_500_000, reason: 'unknown' },
          }),
          call({
            deduplicationKey: 'unavailable',
            costUSD: undefined,
            costAssignment: { version: 1, kind: 'unavailable', reason: 'no-price-record' },
          }),
        ]),
      }),
    })

    expect(projection.observations.map(value => value.costAssignment.kind).sort()).toEqual([
      'explicit-zero',
      'legacy-frozen',
      'metered',
      'unavailable',
    ])
    const unavailable = projection.observations.find(value => value.costAssignment.kind === 'unavailable')!
    const explicitZero = projection.observations.find(value => value.costAssignment.kind === 'explicit-zero')!
    expect(unavailable.costUSD).toBeNull()
    expect(explicitZero.costUSD).toBe(0)
  })

  it('fails closed for incomplete, untrusted, stale-version, or contradictory cache authority', () => {
    expect(() => project({ sessions: sessionCache({}, false) })).toThrow(CanonicalHistoryReadProjectionIntegrityError)
    expect(() => project({ days: dailyCache([], { trusted: false }) })).toThrow(CanonicalHistoryReadProjectionIntegrityError)
    expect(() => project({
      sessions: sessionCache({ '/private/source-a': cachedFile([call({ provider: 'codex' })]) }),
    })).toThrow(CanonicalHistoryReadProjectionIntegrityError)
    expect(() => project({
      sessions: { ...sessionCache({}), version: CACHE_VERSION - 1 },
    })).toThrow(CanonicalHistoryReadProjectionIntegrityError)
  })

  it('returns deeply immutable, deterministically ordered output', () => {
    const projection = project({
      sessions: sessionCache({
        '/z': cachedFile([call({ deduplicationKey: 'z' })]),
        '/a': cachedFile([call({ deduplicationKey: 'a' })]),
      }),
    })

    expect(projection.observations.map(value => value.observationId)).toEqual(
      [...projection.observations.map(value => value.observationId)].sort(),
    )
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.observations)).toBe(true)
    expect(Object.isFrozen(projection.observations[0]!.usage)).toBe(true)
    expect(Object.isFrozen(projection.dailySnapshots[0]!.providers)).toBe(true)
  })
})
