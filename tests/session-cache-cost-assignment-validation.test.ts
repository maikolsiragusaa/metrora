import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { CostAssignmentV1Schema } from '../src/pricing/cost-assignment.js'
import {
  CACHE_VERSION,
  emptyCache,
  isValidCache,
  loadCache,
  sessionCachePath,
  type CachedCall,
  type SessionCache,
} from '../src/session-cache.js'

const originalCacheDir = process.env.METRORA_CACHE_DIR
let cacheDir = ''

function usage() {
  return {
    inputTokens: 1,
    outputTokens: 2,
    cacheCreationInputTokens: 3,
    cacheReadInputTokens: 4,
    cachedInputTokens: 5,
    reasoningTokens: 6,
    webSearchRequests: 7,
    cacheCreationOneHourTokens: 8,
  }
}

function call(overrides: Partial<CachedCall> & Record<string, unknown> = {}): CachedCall {
  return {
    provider: 'openai',
    model: 'gpt-test',
    modelProvider: 'azure',
    usage: usage(),
    speed: 'standard',
    timestamp: '2026-08-12T12:00:00.000Z',
    tools: [],
    bashCommands: [],
    skills: [],
    subagentTypes: [],
    deduplicationKey: 'call-1',
    ...overrides,
  } as CachedCall
}

function cacheWithCalls(calls: unknown[]): unknown {
  return {
    version: CACHE_VERSION,
    complete: true,
    providers: {
      codex: {
        envFingerprint: 'env',
        files: {
          'C:/fixture/session.jsonl': {
            fingerprint: { dev: 1, ino: 2, mtimeMs: 3, sizeBytes: 4 },
            mcpInventory: [],
            turns: [{ timestamp: '2026-08-12T12:00:00.000Z', sessionId: 's', userMessage: 'u', calls }],
          },
        },
      },
    },
  }
}

async function writeActiveRaw(raw: string): Promise<void> {
  await mkdir(cacheDir, { recursive: true })
  await writeFile(sessionCachePath(), raw)
}

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'metrora-cost-cache-validation-'))
  process.env.METRORA_CACHE_DIR = cacheDir
})

afterEach(async () => {
  vi.restoreAllMocks()
  if (originalCacheDir === undefined) delete process.env.METRORA_CACHE_DIR
  else process.env.METRORA_CACHE_DIR = originalCacheDir
  await rm(cacheDir, { recursive: true, force: true })
})

describe('persisted cost assignment validation', () => {
  const validCases: Array<{ name: string; assignment: CachedCall['costAssignment']; costUSD?: number; estimated?: boolean }> = [
    {
      name: 'provider-metered zero',
      assignment: { version: 1, kind: 'metered', amountMicrosUsd: 0, source: 'provider' },
      costUSD: 0,
    },
    {
      name: 'client-metered',
      assignment: { version: 1, kind: 'metered', amountMicrosUsd: 250_000, source: 'client' },
      costUSD: 0.25,
    },
    {
      name: 'billing-export boundary',
      assignment: { version: 1, kind: 'metered', amountMicrosUsd: Number.MAX_SAFE_INTEGER - 1, source: 'billing-export' },
      costUSD: (Number.MAX_SAFE_INTEGER - 1) / 1_000_000,
    },
    {
      name: 'historical base token price',
      assignment: {
        version: 1,
        kind: 'token-price',
        amountMicrosUsd: 420_000,
        priceRecordId: 'openai:gpt-test:2026-08-01',
        priceOrigin: 'reviewed-book',
        rateSelection: { kind: 'base' },
      },
      costUSD: 0.42,
    },
    {
      name: 'historical long-context token price',
      assignment: {
        version: 1,
        kind: 'token-price',
        amountMicrosUsd: 1,
        priceRecordId: 'local-observation:test',
        priceOrigin: 'local-observation',
        rateSelection: { kind: 'prompt-input-tokens-above', tokens: Number.MAX_SAFE_INTEGER },
      },
      costUSD: 0.000001,
      estimated: true,
    },
    {
      name: 'explicit zero with reviewed metadata',
      assignment: {
        version: 1,
        kind: 'explicit-zero',
        amountMicrosUsd: 0,
        reason: 'free-route',
        priceRecordId: 'free-route-record',
        priceOrigin: 'reviewed-book',
      },
      costUSD: 0,
    },
    {
      name: 'explicit zero local inference',
      assignment: { version: 1, kind: 'explicit-zero', amountMicrosUsd: 0, reason: 'local-inference' },
      costUSD: 0,
      estimated: true,
    },
    {
      name: 'legacy inherited pricing',
      assignment: { version: 1, kind: 'legacy-frozen', amountMicrosUsd: 987_654, reason: 'inherited-token-pricing' },
      costUSD: 0.987654,
    },
    {
      name: 'legacy collector estimate fallback',
      assignment: { version: 1, kind: 'legacy-frozen', amountMicrosUsd: 10, reason: 'collector-estimate' },
      costUSD: 0.00001,
      estimated: true,
    },
    {
      name: 'unavailable pricing',
      assignment: { version: 1, kind: 'unavailable', reason: 'missing-required-rate' },
    },
  ]

  it.each(validCases)('accepts $name', ({ assignment, costUSD, estimated }) => {
    expect(isValidCache(cacheWithCalls([call({ costAssignment: assignment, costUSD, isEstimated: estimated })]))).toBe(true)
  })

  it('accepts a cache mixing every assignment kind without changing call metadata', () => {
    const calls = validCases.map((fixture, index) => call({
      costAssignment: fixture.assignment,
      costUSD: fixture.costUSD,
      isEstimated: fixture.estimated,
      deduplicationKey: `mixed-${index}`,
      provider: index % 2 === 0 ? 'openai' : 'anthropic',
      model: `model-${index}`,
      modelProvider: index % 2 === 0 ? 'azure' : 'bedrock',
    }))
    expect(isValidCache(cacheWithCalls(calls))).toBe(true)
  })

  it.each([
    ['unknown kind', { version: 1, kind: 'future-kind', amountMicrosUsd: 0 }],
    ['missing kind', { version: 1, amountMicrosUsd: 0 }],
    ['null', null],
    ['primitive', 7],
    ['array', []],
    ['missing required field', { version: 1, kind: 'metered', amountMicrosUsd: 1 }],
    ['wrong field type', { version: 1, kind: 'metered', amountMicrosUsd: '1', source: 'provider' }],
    ['unknown field', { version: 1, kind: 'metered', amountMicrosUsd: 1, source: 'provider', extra: true }],
    ['negative micros', { version: 1, kind: 'legacy-frozen', amountMicrosUsd: -1, reason: 'unknown' }],
    ['unsafe micros', { version: 1, kind: 'metered', amountMicrosUsd: Number.MAX_SAFE_INTEGER + 1, source: 'provider' }],
    ['NaN micros', { version: 1, kind: 'metered', amountMicrosUsd: Number.NaN, source: 'provider' }],
    ['infinite micros', { version: 1, kind: 'metered', amountMicrosUsd: Number.POSITIVE_INFINITY, source: 'provider' }],
    ['fractional micros', { version: 1, kind: 'metered', amountMicrosUsd: 0.5, source: 'provider' }],
    ['partial explicit-zero identity', { version: 1, kind: 'explicit-zero', amountMicrosUsd: 0, reason: 'free-model', priceRecordId: 'only-id' }],
    ['nonzero explicit-zero', { version: 1, kind: 'explicit-zero', amountMicrosUsd: 1, reason: 'free-model' }],
    ['invalid rate boundary', { version: 1, kind: 'token-price', amountMicrosUsd: 0, priceRecordId: 'r', priceOrigin: 'reviewed-book', rateSelection: { kind: 'prompt-input-tokens-above', tokens: 0 } }],
  ])('rejects %s', (_name, assignment) => {
    expect(isValidCache(cacheWithCalls([call({ costAssignment: assignment as CachedCall['costAssignment'], costUSD: 0.000001 })]))).toBe(false)
  })

  it.each([
    ['inconsistent micros', 0.25, { version: 1, kind: 'metered', amountMicrosUsd: 250_001, source: 'provider' }],
    ['negative stored USD', -1, { version: 1, kind: 'metered', amountMicrosUsd: 0, source: 'provider' }],
    ['NaN stored USD', Number.NaN, { version: 1, kind: 'metered', amountMicrosUsd: 0, source: 'provider' }],
    ['infinite stored USD', Number.POSITIVE_INFINITY, { version: 1, kind: 'metered', amountMicrosUsd: 0, source: 'provider' }],
    ['unavailable with stored USD', 0, { version: 1, kind: 'unavailable', reason: 'no-price-record' }],
  ])('rejects %s', (_name, costUSD, assignment) => {
    expect(isValidCache(cacheWithCalls([call({ costAssignment: assignment as CachedCall['costAssignment'], costUSD })]))).toBe(false)
  })

  it('validates signed cost corrections as finite numbers', () => {
    expect(isValidCache(cacheWithCalls([call({ costUSD: 0, costCorrectionUSD: -0.2 })]))).toBe(true)
    expect(isValidCache(cacheWithCalls([call({ costUSD: 0, costCorrectionUSD: Number.NaN })]))).toBe(false)
    expect(isValidCache(cacheWithCalls([call({ costUSD: 0, costCorrectionUSD: Number.POSITIVE_INFINITY })]))).toBe(false)
  })

  it('parses each persisted assignment exactly once', () => {
    const assignments = Array.from({ length: 250 }, (_, index) => call({
      deduplicationKey: `single-pass-${index}`,
      costUSD: index / 1_000_000,
      costAssignment: { version: 1, kind: 'metered', amountMicrosUsd: index, source: 'provider' },
    }))
    const safeParse = vi.spyOn(CostAssignmentV1Schema, 'safeParse')
    expect(isValidCache(cacheWithCalls(assignments))).toBe(true)
    expect(safeParse).toHaveBeenCalledTimes(assignments.length)
  })

  it('fails closed for one malformed assignment among valid calls', async () => {
    const raw = cacheWithCalls([
      call({ costUSD: 0.25, costAssignment: { version: 1, kind: 'metered', amountMicrosUsd: 250_000, source: 'provider' } }),
      call({ deduplicationKey: 'bad', costUSD: 0.25, costAssignment: { version: 1, kind: 'metered', amountMicrosUsd: 250_001, source: 'provider' } }),
    ])
    await writeActiveRaw(JSON.stringify(raw))
    expect(await loadCache()).toEqual(emptyCache())
  })

  it('keeps legacy unversioned cache adoption valid', async () => {
    const legacy = cacheWithCalls([call({
      costUSD: 0.42,
      costAssignment: {
        version: 1,
        kind: 'token-price',
        amountMicrosUsd: 420_000,
        priceRecordId: 'legacy-valid',
        priceOrigin: 'reviewed-book',
        rateSelection: { kind: 'base' },
      },
    })]) as SessionCache
    await writeFile(join(cacheDir, 'session-cache.json'), JSON.stringify(legacy))
    expect(await loadCache()).toEqual(legacy)
    expect(JSON.parse(await readFile(sessionCachePath(), 'utf8'))).toEqual(legacy)
  })
})

describe('adversarial cache input', () => {
  it.each([
    ['truncated JSON', '{"version":8,"providers":'],
    ['valid JSON with structural truncation', JSON.stringify({ version: CACHE_VERSION, providers: { codex: { envFingerprint: 'x' } } })],
    ['old schema version', JSON.stringify({ version: CACHE_VERSION - 1, providers: {} })],
    ['future assignment kind', JSON.stringify(cacheWithCalls([call({ costUSD: 0, costAssignment: { version: 1, kind: 'future', amountMicrosUsd: 0 } as never })]))],
  ])('fails closed for %s', async (_name, raw) => {
    await writeActiveRaw(raw)
    expect(await loadCache()).toEqual(emptyCache())
  })

  it('uses JSON last-key semantics but still validates the surviving assignment', async () => {
    const prefix = `{"version":${CACHE_VERSION},"providers":{"codex":{"envFingerprint":"x","files":{"f":{"fingerprint":{"dev":1,"ino":2,"mtimeMs":3,"sizeBytes":4},"mcpInventory":[],"turns":[{"timestamp":"t","sessionId":"s","userMessage":"u","calls":[{`
    const suffix = `"provider":"p","model":"m","usage":{"inputTokens":0,"outputTokens":0,"cacheCreationInputTokens":0,"cacheReadInputTokens":0,"cachedInputTokens":0,"reasoningTokens":0,"webSearchRequests":0,"cacheCreationOneHourTokens":0},"speed":"standard","timestamp":"t","tools":[],"bashCommands":[],"skills":[],"deduplicationKey":"k","costUSD":1,"costUSD":0.25,"costAssignment":{"version":1,"kind":"metered","amountMicrosUsd":250000,"source":"provider"}}]}]}}}}}`
    await writeActiveRaw(prefix + suffix)
    expect((await loadCache()).providers).not.toEqual({})
  })

  it('accepts bounded large strings and a large mixed valid call array', () => {
    const assignments: CachedCall['costAssignment'][] = [
      { version: 1, kind: 'metered', amountMicrosUsd: 1, source: 'provider' },
      { version: 1, kind: 'token-price', amountMicrosUsd: 1, priceRecordId: 'r', priceOrigin: 'reviewed-book', rateSelection: { kind: 'base' } },
      { version: 1, kind: 'explicit-zero', amountMicrosUsd: 0, reason: 'free-route' },
      { version: 1, kind: 'legacy-frozen', amountMicrosUsd: 1, reason: 'collector-estimate' },
      { version: 1, kind: 'unavailable', reason: 'no-price-record' },
    ]
    const calls = Array.from({ length: 5_000 }, (_, index) => {
      const assignment = assignments[index % assignments.length]!
      return call({
        deduplicationKey: `large-${index}`,
        costAssignment: assignment,
        costUSD: assignment.kind === 'unavailable' ? undefined : assignment.amountMicrosUsd / 1_000_000,
      })
    })
    const cache = cacheWithCalls(calls) as SessionCache
    const file = cache.providers['codex']!.files['C:/fixture/session.jsonl']!
    file.turns[0]!.userMessage = 'x'.repeat(512 * 1024)
    expect(isValidCache(cache)).toBe(true)
  })
})
