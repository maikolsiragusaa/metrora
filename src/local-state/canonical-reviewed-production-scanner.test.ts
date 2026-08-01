import { describe, expect, it, vi } from 'vitest'

import type { CachedCall, CachedFile, SessionCache } from '../session-cache.js'
import {
  canonicalSourceRecordFingerprintSha256V1,
  CanonicalReviewedProductionScannerIntegrityError,
  scanCanonicalReviewedProductionCandidatesV1,
  type CanonicalReviewedProductionScannerDependenciesV1,
} from './canonical-reviewed-production-scanner.js'

const ENDPOINT_ID = 'ep_11111111-2222-4333-8444-555555555555'
const SOURCE_PATH = '/private/zed/db/threads.sqlite'

function zedCall(overrides: Partial<CachedCall> = {}): CachedCall {
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
    costAssignment: { version: 1, kind: 'unavailable' },
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

function cachedFile(calls: CachedCall[], overrides: Partial<CachedFile> = {}): CachedFile {
  return {
    fingerprint: { dev: 1, ino: 2, mtimeMs: 3, sizeBytes: 4 },
    mcpInventory: [],
    turns: [{
      timestamp: '2026-08-01T21:00:00.000Z',
      sessionId: 'private-session-id',
      userMessage: 'private prompt must not cross the scanner',
      calls,
    }],
    ...overrides,
  }
}

function cache(files: Record<string, CachedFile>, complete = true): SessionCache {
  return {
    version: 8,
    complete,
    providers: {
      zed: { envFingerprint: 'zed-test', files },
    },
  }
}

function dependencies(
  value: SessionCache,
  options: {
    existing?: ReadonlySet<string>
    displayNames?: Record<string, string | undefined>
  } = {},
): CanonicalReviewedProductionScannerDependenciesV1 & { refresh: ReturnType<typeof vi.fn> } {
  const refresh = vi.fn(async () => undefined)
  const existing = options.existing ?? new Set([SOURCE_PATH])
  const displayNames = options.displayNames ?? { zed: 'Zed' }
  return {
    refresh,
    refreshCanonicalCache: refresh,
    loadCanonicalCache: vi.fn(async () => value),
    sourceExists: path => existing.has(path),
    providerDisplayName: vi.fn(async provider => displayNames[provider]),
  }
}

describe('canonical reviewed-production scanner v1', () => {
  it('derives one path-free reviewed candidate from a present canonical source', async () => {
    const deps = dependencies(cache({ [SOURCE_PATH]: cachedFile([zedCall()]) }))

    const result = await scanCanonicalReviewedProductionCandidatesV1({
      endpointId: ENDPOINT_ID,
      adapterVersion: '0.9.19',
    }, deps)

    expect(deps.refresh).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ withheldCount: 0, failedCount: 0 })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      call: {
        provider: 'zed',
        model: 'gpt-5.6-luna',
        modelProvider: 'zed.dev',
        deduplicationKey: 'zed:thread-1:request-1',
      },
      context: {
        session: { mode: 'omit' },
        tool: { name: 'Zed' },
        collector: { adapterVersion: '0.9.19' },
        genAi: { operationName: 'other', providerName: 'zed.dev' },
      },
    })

    const serializedContext = JSON.stringify(result.candidates[0]!.context)
    expect(serializedContext).not.toContain(SOURCE_PATH)
    expect(serializedContext).not.toContain('private-session-id')
    expect(serializedContext).not.toContain('private prompt')
    expect(serializedContext).not.toContain('zed:thread-1:request-1')
  })

  it('keeps the source-record fingerprint stable and endpoint-scoped', () => {
    const first = canonicalSourceRecordFingerprintSha256V1({
      endpointId: ENDPOINT_ID,
      provider: 'zed',
      sourcePath: SOURCE_PATH,
      privateDeduplicationKey: 'zed:thread-1:request-1',
    })
    const second = canonicalSourceRecordFingerprintSha256V1({
      endpointId: ENDPOINT_ID,
      provider: 'zed',
      sourcePath: SOURCE_PATH,
      privateDeduplicationKey: 'zed:thread-1:request-1',
    })
    const anotherEndpoint = canonicalSourceRecordFingerprintSha256V1({
      endpointId: 'ep_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      provider: 'zed',
      sourcePath: SOURCE_PATH,
      privateDeduplicationKey: 'zed:thread-1:request-1',
    })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toBe(first)
    expect(anotherEndpoint).not.toBe(first)
  })

  it('withholds source-less durable history instead of promoting cached analytics', async () => {
    const deps = dependencies(
      cache({ [SOURCE_PATH]: cachedFile([zedCall(), zedCall({ deduplicationKey: 'zed:thread-1:request-2' })]) }),
      { existing: new Set() },
    )

    await expect(scanCanonicalReviewedProductionCandidatesV1({
      endpointId: ENDPOINT_ID,
      adapterVersion: '0.9.19',
    }, deps)).resolves.toEqual({
      candidates: [],
      withheldCount: 2,
      failedCount: 0,
    })
  })

  it('withholds calls without explicit provider identity or reviewed provenance', async () => {
    const cursorPath = '/private/cursor/db'
    const value: SessionCache = {
      version: 8,
      complete: true,
      providers: {
        zed: {
          envFingerprint: 'zed-test',
          files: { [SOURCE_PATH]: cachedFile([zedCall({ modelProvider: undefined })]) },
        },
        cursor: {
          envFingerprint: 'cursor-test',
          files: {
            [cursorPath]: cachedFile([
              zedCall({ provider: 'cursor', modelProvider: 'openai', deduplicationKey: 'cursor:call-1' }),
              zedCall({ provider: 'cursor', modelProvider: undefined, deduplicationKey: 'cursor:call-2' }),
            ]),
          },
        },
      },
    }
    const deps = dependencies(value, {
      existing: new Set([SOURCE_PATH, cursorPath]),
      displayNames: { zed: 'Zed', cursor: 'Cursor' },
    })

    await expect(scanCanonicalReviewedProductionCandidatesV1({
      endpointId: ENDPOINT_ID,
      adapterVersion: '0.9.19',
    }, deps)).resolves.toEqual({
      candidates: [],
      withheldCount: 3,
      failedCount: 0,
    })
  })

  it('counts failed source files without reading or inventing calls', async () => {
    const deps = dependencies(cache({
      [SOURCE_PATH]: cachedFile([], { failed: true }),
    }))

    await expect(scanCanonicalReviewedProductionCandidatesV1({
      endpointId: ENDPOINT_ID,
      adapterVersion: '0.9.19',
    }, deps)).resolves.toEqual({
      candidates: [],
      withheldCount: 0,
      failedCount: 1,
    })
  })

  it('fails closed on incomplete cache or provider-section contradictions', async () => {
    const incomplete = dependencies(cache({}, false))
    await expect(scanCanonicalReviewedProductionCandidatesV1({
      endpointId: ENDPOINT_ID,
      adapterVersion: '0.9.19',
    }, incomplete)).rejects.toBeInstanceOf(CanonicalReviewedProductionScannerIntegrityError)

    const contradictory = dependencies(cache({
      [SOURCE_PATH]: cachedFile([zedCall({ provider: 'codex' })]),
    }))
    await expect(scanCanonicalReviewedProductionCandidatesV1({
      endpointId: ENDPOINT_ID,
      adapterVersion: '0.9.19',
    }, contradictory)).rejects.toBeInstanceOf(CanonicalReviewedProductionScannerIntegrityError)
  })

  it('rejects empty private deduplication identities', async () => {
    const deps = dependencies(cache({
      [SOURCE_PATH]: cachedFile([zedCall({ deduplicationKey: '' })]),
    }))
    await expect(scanCanonicalReviewedProductionCandidatesV1({
      endpointId: ENDPOINT_ID,
      adapterVersion: '0.9.19',
    }, deps)).rejects.toBeInstanceOf(CanonicalReviewedProductionScannerIntegrityError)
  })
})
