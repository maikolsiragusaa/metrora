import { describe, expect, it } from 'vitest'

import { DAILY_CACHE_VERSION, type DailyCache } from '../daily-cache.js'
import { CACHE_VERSION, type CachedCall, type CachedFile, type SessionCache } from '../session-cache.js'
import {
  COPILOT_CHAT_JOURNAL_PROVIDER,
  COPILOT_CLI_RESUME_PROVIDER,
} from '../provider-parse-authorities.js'
import {
  CanonicalHistoryReadProjectionIntegrityError,
  projectCanonicalHistoryReadV1,
} from './canonical-history-read-projection.js'

const ENDPOINT_ID = 'ep_11111111-2222-4333-8444-555555555555'

function call(overrides: Partial<CachedCall> = {}): CachedCall {
  return {
    provider: 'copilot',
    model: 'gpt-5.6-luna',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      webSearchRequests: 0,
      cacheCreationOneHourTokens: 0,
    },
    costUSD: 0,
    costAssignment: {
      version: 1,
      kind: 'explicit-zero',
      amountMicrosUsd: 0,
      reason: 'free-route',
    },
    speed: 'standard',
    timestamp: '2026-08-01T21:00:01.000Z',
    tools: [],
    bashCommands: [],
    skills: [],
    subagentTypes: [],
    deduplicationKey: 'copilot:source-1',
    ...overrides,
  }
}

function file(calls: CachedCall[], sessionId = 'session-1', timestamp = '2026-08-01T21:00:00.000Z'): CachedFile {
  return {
    fingerprint: { dev: 1, ino: 2, mtimeMs: 3, sizeBytes: 4 },
    mcpInventory: [],
    turns: [{ timestamp, sessionId, userMessage: 'private', calls }],
  }
}

function sessionCache(sections: Record<string, CachedCall[]>): SessionCache {
  return {
    version: CACHE_VERSION,
    complete: true,
    providers: Object.fromEntries(Object.entries(sections).map(([namespace, calls], index) => [namespace, {
      envFingerprint: `test-${index}`,
      files: { [`/private/${index}`]: file(calls) },
    }])),
  }
}

function dailyCache(): DailyCache {
  return {
    version: DAILY_CACHE_VERSION,
    savingsConfigHash: 'test',
    tzKey: 'UTC',
    lastComputedDate: null,
    days: [],
    complete: true,
    watermarkTrusted: true,
  }
}

function project(sections: Record<string, CachedCall[]>): ReturnType<typeof projectCanonicalHistoryReadV1> {
  return projectCanonicalHistoryReadV1({
    endpointId: ENDPOINT_ID,
    sessionCache: sessionCache(sections),
    dailyCache: dailyCache(),
  })
}

const internalLanes = [
  ['copilot', COPILOT_CHAT_JOURNAL_PROVIDER],
  ['copilot', COPILOT_CLI_RESUME_PROVIDER],
  [COPILOT_CHAT_JOURNAL_PROVIDER, COPILOT_CLI_RESUME_PROVIDER],
] as const

describe('canonical history Copilot namespace collision matrix', () => {
  it.each(internalLanes)('canonicalizes %s + %s as one collector', (left, right) => {
    const result = project({
      [left]: [call()],
      [right]: [call()],
    })
    expect(result.observations).toHaveLength(1)
    expect(result.activities).toHaveLength(1)
    expect(result.observations[0]!.collector).toBe('copilot')
    expect(result.activities[0]!.collector).toBe('copilot')
  })

  it('preserves all three independent valid lanes when their source identities differ', () => {
    const result = project({
      copilot: [call({ deduplicationKey: 'copilot:normal' })],
      [COPILOT_CHAT_JOURNAL_PROVIDER]: [call({ deduplicationKey: 'copilot:journal' })],
      [COPILOT_CLI_RESUME_PROVIDER]: [call({ deduplicationKey: 'copilot:resume' })],
    })
    expect(result.observations).toHaveLength(3)
    expect(result.activities).toHaveLength(3)
    expect(new Set(result.observations.map(value => value.collector))).toEqual(new Set(['copilot']))
  })

  it('fails closed for the same source identity with a conflicting payload', () => {
    expect(() => project({
      copilot: [call()],
      [COPILOT_CHAT_JOURNAL_PROVIDER]: [call({ model: 'different-model' })],
    })).toThrow(CanonicalHistoryReadProjectionIntegrityError)
  })

  it('fails closed when the same source identity is attached to different turn/session identities', () => {
    const first = file([call()], 'session-1', '2026-08-01T21:00:00.000Z')
    const second = file([call()], 'session-2', '2026-08-01T21:00:00.000Z')
    expect(() => projectCanonicalHistoryReadV1({
      endpointId: ENDPOINT_ID,
      sessionCache: {
        version: CACHE_VERSION,
        complete: true,
        providers: {
          copilot: { envFingerprint: 'a', files: { '/private/a': first } },
          [COPILOT_CHAT_JOURNAL_PROVIDER]: { envFingerprint: 'b', files: { '/private/b': second } },
        },
      },
      dailyCache: dailyCache(),
    })).toThrow(CanonicalHistoryReadProjectionIntegrityError)
  })

  it('preserves different source identities with equal turn timestamps and different sessions', () => {
    const result = project({
      copilot: [call({ deduplicationKey: 'copilot:one' })],
      [COPILOT_CHAT_JOURNAL_PROVIDER]: [call({ deduplicationKey: 'copilot:two' })],
    })
    expect(result.observations).toHaveLength(2)
    expect(result.activities).toHaveLength(2)
  })

  it('fails closed for an artificial storage alias even when its call says copilot', () => {
    expect(() => project({
      'copilot-artificial-alias': [call()],
    })).toThrow(CanonicalHistoryReadProjectionIntegrityError)
  })
})
