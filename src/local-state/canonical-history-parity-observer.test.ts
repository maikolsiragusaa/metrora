import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import type { DailyCache, DailyEntry } from '../daily-cache.js'
import type { CachedCall, CachedFile, SessionCache } from '../session-cache.js'
import { projectCanonicalHistoryReadV1 } from './canonical-history-read-projection.js'
import {
  CanonicalHistoryParityMismatchError,
  observeCanonicalHistoryParityV1,
} from './canonical-history-parity-observer.js'

const ENDPOINT_ID = 'ep_11111111-2222-4333-8444-555555555555'

function sourceFingerprint(input: {
  endpointId: string
  provider: string
  privateDeduplicationKey: string
}): string {
  return createHash('sha256')
    .update('metrora-canonical-source-record-v1\0')
    .update(input.endpointId)
    .update('\0')
    .update(input.provider)
    .update('\0')
    .update(input.privateDeduplicationKey)
    .digest('hex')
}

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
    costUSD: 0,
    costAssignment: {
      version: 1,
      kind: 'explicit-zero',
      amountMicrosUsd: 0,
      reason: 'free-route',
    },
    speed: 'standard',
    timestamp: '2026-08-01T21:00:00.000Z',
    tools: [],
    bashCommands: [],
    skills: [],
    subagentTypes: [],
    deduplicationKey: 'zed:thread-1:request-1',
    ...overrides,
  }
}

function cachedFile(calls: CachedCall[], sessionId = 'session-1'): CachedFile {
  return {
    fingerprint: { dev: 1, ino: 2, mtimeMs: 3, sizeBytes: 4 },
    mcpInventory: [],
    turns: [{
      timestamp: '2026-08-01T21:00:00.000Z',
      sessionId,
      userMessage: 'private prompt',
      calls,
    }],
  }
}

function sessionCache(files: Record<string, CachedFile>): SessionCache {
  return {
    version: 8,
    complete: true,
    providers: {
      zed: { envFingerprint: 'zed-test', files },
    },
  }
}

function day(): DailyEntry {
  return {
    date: '2026-08-01',
    cost: 0,
    savingsUSD: 0,
    calls: 1,
    sessions: 1,
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 25,
    cacheWriteTokens: 0,
    editTurns: 0,
    oneShotTurns: 0,
    models: {
      'gpt-5.6-luna': {
        calls: 1,
        cost: 0,
        savingsUSD: 0,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 25,
        cacheWriteTokens: 0,
      },
    },
    categories: {
      other: { turns: 1, cost: 0, savingsUSD: 0, editTurns: 0, oneShotTurns: 0 },
    },
    providers: {
      zed: {
        calls: 1,
        cost: 0,
        savingsUSD: 0,
        sessions: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 25,
        cacheWriteTokens: 0,
        editTurns: 0,
        oneShotTurns: 0,
      },
    },
  }
}

function dailyCache(days: DailyEntry[] = [day()]): DailyCache {
  return {
    version: 17,
    savingsConfigHash: 'test',
    tzKey: 'UTC',
    lastComputedDate: '2026-08-01',
    days,
    complete: true,
    watermarkTrusted: true,
  }
}

function persisted() {
  return {
    status: 'initialized' as const,
    projectionSha256: 'a'.repeat(64),
    reconciliation: {
      observations: { added: 1, unchanged: 0, retainedOnly: 0 },
      activities: { added: 1, unchanged: 0, retainedOnly: 0 },
      dailySnapshots: { added: 1, unchanged: 0, retainedOnly: 0 },
    },
  }
}

describe('canonical history parity observer v1', () => {
  it('persists only after source, activity and daily authority match', async () => {
    const persist = vi.fn(async () => persisted())
    const result = await observeCanonicalHistoryParityV1({
      endpointId: ENDPOINT_ID,
      sessionCache: sessionCache({ '/private/zed.sqlite': cachedFile([call()]) }),
      dailyCache: dailyCache(),
    }, { sourceFingerprint, persist })

    expect(persist).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      outcome: 'matched',
      shadowStatus: 'initialized',
      counts: { observations: 1, activities: 1, dailySnapshots: 1 },
      additiveAcrossAuthorities: false,
    })
  })

  it('deduplicates one exact source observation without losing activity parity', async () => {
    const duplicate = call()
    const persist = vi.fn(async () => persisted())
    const result = await observeCanonicalHistoryParityV1({
      endpointId: ENDPOINT_ID,
      sessionCache: sessionCache({
        '/private/a.sqlite': cachedFile([call()]),
        '/private/b.sqlite': cachedFile([duplicate]),
      }),
      dailyCache: dailyCache(),
    }, { sourceFingerprint, persist })

    expect(result.counts).toEqual({ observations: 1, activities: 1, dailySnapshots: 1 })
  })

  it('rejects a projection that drops a source observation before persistence', async () => {
    const persist = vi.fn(async () => persisted())
    await expect(observeCanonicalHistoryParityV1({
      endpointId: ENDPOINT_ID,
      sessionCache: sessionCache({ '/private/zed.sqlite': cachedFile([call()]) }),
      dailyCache: dailyCache(),
    }, {
      sourceFingerprint,
      persist,
      project: input => {
        const projection = structuredClone(projectCanonicalHistoryReadV1(input))
        projection.observations = []
        projection.activities = []
        return projection
      },
    })).rejects.toBeInstanceOf(CanonicalHistoryParityMismatchError)
    expect(persist).not.toHaveBeenCalled()
  })

  it('rejects a daily snapshot that differs from trusted daily-cache authority', async () => {
    const persist = vi.fn(async () => persisted())
    await expect(observeCanonicalHistoryParityV1({
      endpointId: ENDPOINT_ID,
      sessionCache: sessionCache({ '/private/zed.sqlite': cachedFile([call()]) }),
      dailyCache: dailyCache(),
    }, {
      sourceFingerprint,
      persist,
      project: input => {
        const projection = structuredClone(projectCanonicalHistoryReadV1(input))
        projection.dailySnapshots[0]!.calls += 1
        return projection
      },
    })).rejects.toThrow('daily snapshot projection does not match trusted daily-cache authority')
    expect(persist).not.toHaveBeenCalled()
  })

  it('fails closed before projection when either canonical cache is untrusted', async () => {
    const persist = vi.fn(async () => persisted())
    const untrusted = dailyCache()
    untrusted.watermarkTrusted = false

    await expect(observeCanonicalHistoryParityV1({
      endpointId: ENDPOINT_ID,
      sessionCache: sessionCache({ '/private/zed.sqlite': cachedFile([call()]) }),
      dailyCache: untrusted,
    }, { sourceFingerprint, persist })).rejects.toBeInstanceOf(CanonicalHistoryParityMismatchError)
    expect(persist).not.toHaveBeenCalled()
  })
})
