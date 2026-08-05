import { describe, expect, it, vi } from 'vitest'

import type { CachedCall, CachedFile, SessionCache } from '../session-cache.js'
import {
  CanonicalReviewedProductionScannerIntegrityError,
  scanCanonicalReviewedProductionCandidatesV1,
  type CanonicalReviewedProductionScannerDependenciesV1,
} from './canonical-reviewed-production-scanner.js'

const SOURCE_PATH = '/private/codex/rollout.jsonl'
const ENDPOINT_ID = 'ep_11111111-2222-4333-8444-555555555555'
const NOT_BEFORE = '2026-08-01T21:00:00.000Z'

function input() {
  return {
    endpointId: ENDPOINT_ID,
    adapterVersion: '0.9.19',
    notBefore: NOT_BEFORE,
  }
}

function codexCall(overrides: Partial<CachedCall> = {}): CachedCall {
  return {
    provider: 'codex',
    model: 'gpt-5.6-luna',
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
    costAssignment: {
      version: 1,
      kind: 'unavailable',
      reason: 'no-price-record',
    },
    speed: 'standard',
    timestamp: '2026-08-01T22:00:00.000Z',
    tools: [],
    bashCommands: [],
    skills: [],
    subagentTypes: [],
    deduplicationKey: 'codex:call:1',
    ...overrides,
  }
}

function file(calls: CachedCall[]): CachedFile {
  return {
    fingerprint: { dev: 1, ino: 2, mtimeMs: 3, sizeBytes: 4 },
    mcpInventory: [],
    turns: [{
      timestamp: '2026-08-01T22:00:00.000Z',
      sessionId: 'private-session',
      userMessage: '',
      calls,
    }],
  }
}

function cache(calls: CachedCall[]): SessionCache {
  return {
    version: 8,
    complete: true,
    providers: {
      codex: {
        envFingerprint: 'codex-test',
        files: { [SOURCE_PATH]: file(calls) },
      },
    },
  }
}

function deps(
  calls: CachedCall[],
  sourceProvider: string | undefined,
): CanonicalReviewedProductionScannerDependenciesV1 {
  return {
    refreshCanonicalCache: vi.fn(async () => undefined),
    loadCanonicalCache: vi.fn(async () => cache(calls)),
    sourceExists: path => path === SOURCE_PATH,
    providerDisplayName: vi.fn(async provider => provider === 'codex' ? 'Codex' : undefined),
    codexModelProvider: vi.fn(async () => sourceProvider),
  }
}

describe('canonical scanner Codex provider compatibility', () => {
  it('enriches a post-creation cached call from explicit session metadata', async () => {
    const result = await scanCanonicalReviewedProductionCandidatesV1(
      input(),
      deps([codexCall()], 'openai'),
    )

    expect(result).toMatchObject({ withheldCount: 0, failedCount: 0 })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      call: { provider: 'codex', modelProvider: 'openai' },
      context: {
        session: { mode: 'omit' },
        tool: { name: 'Codex' },
        genAi: { providerName: 'openai', operationName: 'other' },
      },
    })
  })

  it('does not read provider metadata for pre-Workspace Codex history', async () => {
    const dependencies = deps([
      codexCall({ timestamp: '2026-08-01T20:59:59.999Z' }),
    ], 'openai')

    await expect(scanCanonicalReviewedProductionCandidatesV1(input(), dependencies)).resolves.toEqual({
      candidates: [],
      withheldCount: 0,
      failedCount: 0,
    })
    expect(dependencies.codexModelProvider).not.toHaveBeenCalled()
  })

  it('withholds legacy in-scope Codex calls when session metadata has no provider', async () => {
    await expect(scanCanonicalReviewedProductionCandidatesV1(
      input(),
      deps([codexCall()], undefined),
    )).resolves.toEqual({
      candidates: [],
      withheldCount: 1,
      failedCount: 0,
    })
  })

  it('fails closed when cached and source-recorded providers disagree', async () => {
    await expect(scanCanonicalReviewedProductionCandidatesV1(
      input(),
      deps([codexCall({ modelProvider: 'anthropic' })], 'openai'),
    )).rejects.toBeInstanceOf(CanonicalReviewedProductionScannerIntegrityError)
  })
})
