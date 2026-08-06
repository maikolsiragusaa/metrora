import { describe, expect, it, vi } from 'vitest'

import type { CachedCall, CachedFile, SessionCache } from '../session-cache.js'
import {
  scanCanonicalReviewedProductionCandidatesV1,
  type CanonicalReviewedProductionScannerDependenciesV1,
} from './canonical-reviewed-production-scanner.js'

const ENDPOINT_ID = 'ep_11111111-2222-4333-8444-555555555555'
const SOURCE_PATH = '/private/zed/db/threads.sqlite'

function call(): CachedCall {
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
  }
}

function file(): CachedFile {
  return {
    fingerprint: { dev: 1, ino: 2, mtimeMs: 3, sizeBytes: 4 },
    mcpInventory: [],
    turns: [{
      timestamp: '2026-08-01T21:00:00.000Z',
      sessionId: 'private-session-id',
      userMessage: 'private prompt',
      calls: [call()],
    }],
  }
}

function cache(): SessionCache {
  return {
    version: 8,
    complete: true,
    providers: {
      zed: { envFingerprint: 'zed-test', files: { [SOURCE_PATH]: file() } },
    },
  }
}

function dependencies(overrides: Partial<CanonicalReviewedProductionScannerDependenciesV1> = {}) {
  const value = cache()
  return {
    refreshCanonicalCache: vi.fn(async () => undefined),
    loadCanonicalCache: vi.fn(async () => value),
    sourceExists: vi.fn(() => true),
    providerDisplayName: vi.fn(async () => 'Zed'),
    ...overrides,
  } satisfies CanonicalReviewedProductionScannerDependenciesV1
}

function input() {
  return {
    endpointId: ENDPOINT_ID,
    adapterVersion: '1.0.0-rc.7',
    notBefore: '2026-08-01T20:00:00.000Z',
  }
}

describe('canonical reviewed-production parity hook', () => {
  it('observes the complete cache before returning reviewed candidates', async () => {
    const observe = vi.fn(async () => undefined)
    const deps = dependencies({ observeCanonicalHistoryParity: observe })

    const result = await scanCanonicalReviewedProductionCandidatesV1(input(), deps)

    expect(observe).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledWith({ endpointId: ENDPOINT_ID, sessionCache: await deps.loadCanonicalCache() })
    expect(result.candidates).toHaveLength(1)
  })

  it('reports a parity failure without changing reviewed-production output', async () => {
    const failure = new Error('synthetic parity failure')
    const report = vi.fn()
    const deps = dependencies({
      observeCanonicalHistoryParity: vi.fn(async () => { throw failure }),
      reportCanonicalHistoryParityFailure: report,
    })

    const result = await scanCanonicalReviewedProductionCandidatesV1(input(), deps)

    expect(report).toHaveBeenCalledWith(failure)
    expect(result).toMatchObject({
      withheldCount: 0,
      failedCount: 0,
    })
    expect(result.candidates).toHaveLength(1)
  })

  it('does not let a diagnostic reporter become a production gate', async () => {
    const deps = dependencies({
      observeCanonicalHistoryParity: vi.fn(async () => { throw new Error('parity') }),
      reportCanonicalHistoryParityFailure: vi.fn(() => { throw new Error('reporter') }),
    })

    await expect(scanCanonicalReviewedProductionCandidatesV1(input(), deps))
      .resolves.toMatchObject({ withheldCount: 0, failedCount: 0 })
  })
})
