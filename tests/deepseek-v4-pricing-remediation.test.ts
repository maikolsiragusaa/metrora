import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getDailyCacheConfigHash } from '../src/usage-aggregator.js'
import {
  emptyCache,
  ensureCacheHydrated,
  saveDailyCache,
  type DailyEntry,
  type ProviderDaySlice,
} from '../src/daily-cache.js'
import { settleCachedCallCost } from '../src/session-cache-cost-settlement.js'
import type { CachedCall } from '../src/session-cache.js'

let cacheDir = ''
const originalCacheDir = process.env['METRORA_CACHE_DIR']

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

function legacyDeepSeekCall(): CachedCall {
  return {
    provider: 'claude',
    model: 'deepseek-v4-flash',
    modelProvider: 'deepseek',
    usage: {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      reasoningTokens: 0,
      webSearchRequests: 0,
      cacheCreationOneHourTokens: 0,
    },
    costUSD: 0.5628,
    costAssignment: {
      version: 1,
      kind: 'token-price',
      amountMicrosUsd: 562_800,
      priceRecordId: 'deepseek:deepseek-v4-flash:standard:official-2026-08-07',
      priceOrigin: 'reviewed-book',
      rateSelection: { kind: 'base' },
    },
    speed: 'standard',
    timestamp: '2026-08-17T01:00:00Z',
    tools: [],
    bashCommands: [],
    skills: [],
    subagentTypes: [],
    deduplicationKey: 'synthetic-deepseek-v4-call',
  }
}

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'metrora-deepseek-v4-remediation-'))
  process.env['METRORA_CACHE_DIR'] = cacheDir
})

afterEach(async () => {
  if (originalCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = originalCacheDir
  await rm(cacheDir, { recursive: true, force: true })
})

describe('DeepSeek V4 daily-cache remediation', () => {
  it('re-derives retained source evidence under the new reviewed pricing authority', async () => {
    const date = '2026-08-17'
    const currentAuthority = getDailyCacheConfigHash()
    const priorAuthority = `${currentAuthority}-prior-reviewed-book`
    const cachedCall = legacyDeepSeekCall()
    const settlement = settleCachedCallCost(cachedCall)
    if (settlement.storedCostUSD === undefined || settlement.storedAssignment.kind !== 'token-price') {
      throw new Error('synthetic DeepSeek call did not migrate to a priced successor')
    }

    const baseline = emptyCache(priorAuthority)
    baseline.complete = true
    baseline.watermarkTrusted = true
    baseline.lastComputedDate = '2026-08-20'
    baseline.days = [day(date, 'claude', { calls: 1, cost: 0.5628, savingsUSD: 0 })]
    await saveDailyCache(baseline)

    const fresh = day(date, 'claude', {
      calls: 1,
      cost: settlement.storedCostUSD,
      savingsUSD: 0,
      inputTokens: cachedCall.usage.inputTokens,
      outputTokens: cachedCall.usage.outputTokens,
      cacheReadTokens: cachedCall.usage.cacheReadInputTokens,
      cacheWriteTokens: cachedCall.usage.cacheCreationInputTokens,
    })
    const rederived = await ensureCacheHydrated(
      async () => [],
      () => [fresh],
      currentAuthority,
      () => true,
    )
    const result = rederived.days.find(entry => entry.date === date)

    expect(settlement.storedAssignment).toMatchObject({
      priceRecordId: 'deepseek:deepseek-v4-flash:standard:official-2026-08-16',
      rateSelection: { kind: 'pricing-policy', policyId: 'peak-01-04' },
    })
    expect(result?.cost).toBeCloseTo(2.214, 12)
    expect(result?.providers.claude?.cost).toBeCloseTo(2.214, 12)
    expect(result?.carried).toBeUndefined()
    expect(rederived.savingsConfigHash).toBe(currentAuthority)
  })

  it('carries sourceless daily-only history losslessly instead of inventing a price split', async () => {
    const date = '2026-08-18'
    const currentAuthority = getDailyCacheConfigHash()
    const baseline = emptyCache(`${currentAuthority}-prior-reviewed-book`)
    baseline.complete = true
    baseline.watermarkTrusted = true
    baseline.lastComputedDate = '2026-08-20'
    const sourceless = { calls: 3, cost: 17.25, savingsUSD: 0, sessions: 2 }
    baseline.days = [day(date, 'sourceless-provider', sourceless)]
    await saveDailyCache(baseline)

    const carried = await ensureCacheHydrated(
      async () => [],
      () => [],
      currentAuthority,
      () => true,
    )
    const result = carried.days.find(entry => entry.date === date)

    expect(result?.cost).toBe(17.25)
    expect(result?.calls).toBe(3)
    expect(result?.providers['sourceless-provider']).toEqual(sourceless)
    expect(result?.carried).toBe(true)
  })
})
