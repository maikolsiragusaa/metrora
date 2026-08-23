import { describe, expect, it } from 'vitest'

import { hasProviderQuotaFacts, sanitizeQuotaProvider } from './types'
import type { QuotaProvider } from './types'

function quota(overrides: Partial<QuotaProvider> = {}): QuotaProvider {
  return {
    schemaVersion: 1,
    provider: 'codex',
    authority: 'provider-reported',
    availability: 'available',
    connection: 'connected',
    freshness: 'fresh',
    observedAt: '2026-07-12T00:00:00.000Z',
    planLabel: null,
    windows: [],
    credits: null,
    rateLimit: { state: 'clear', retryAt: null },
    ...overrides,
  }
}

describe('provider quota contract', () => {
  it('recognizes independent provider facts, including explicit zero credits', () => {
    expect(hasProviderQuotaFacts(quota())).toBe(false)
    expect(hasProviderQuotaFacts(quota({ planLabel: 'Pro' }))).toBe(true)
    expect(hasProviderQuotaFacts(quota({ credits: { balance: 0, currency: 'USD' } }))).toBe(true)
    expect(hasProviderQuotaFacts(quota({ windows: [{ id: 'primary', label: '5-hour', usedFraction: 0, resetsAt: null, windowSeconds: null }] }))).toBe(true)
  })

  it('fails closed when connected fresh input has no factual provider data', () => {
    const safe = sanitizeQuotaProvider(quota({ observedAt: '2026-07-12T00:00:00.000Z' }))!
    expect(safe).toMatchObject({
      connection: 'connected',
      availability: 'unavailable',
      freshness: 'unavailable',
      observedAt: null,
      windows: [],
      credits: null,
      planLabel: null,
    })
  })

  it('does not preserve fresh when factual data has no valid observation time', () => {
    const safe = sanitizeQuotaProvider(quota({
      observedAt: null,
      windows: [{ id: 'primary', label: '5-hour', usedFraction: 0.25, resetsAt: null, windowSeconds: null }],
      credits: { balance: 3.5, currency: 'USD' },
      planLabel: 'Plus',
    }))!
    expect(safe).toMatchObject({
      availability: 'unavailable',
      freshness: 'unavailable',
      observedAt: null,
      windows: [],
      credits: null,
      planLabel: null,
    })
  })

  it('clears credits and plan facts when the observation time is invalid', () => {
    const credits = sanitizeQuotaProvider(quota({ observedAt: 'not-a-date', credits: { balance: 3.5, currency: 'USD' } }))!
    const plan = sanitizeQuotaProvider(quota({ observedAt: 'not-a-date', planLabel: 'Plus' }))!

    expect(credits).toMatchObject({ availability: 'unavailable', freshness: 'unavailable', observedAt: null, credits: null, planLabel: null, windows: [] })
    expect(plan).toMatchObject({ availability: 'unavailable', freshness: 'unavailable', observedAt: null, credits: null, planLabel: null, windows: [] })
  })

  it('preserves valid fresh credits-only facts, including explicit zero', () => {
    for (const balance of [3.5, 0]) {
      const input = quota({ credits: { balance, currency: 'USD' } })
      expect(sanitizeQuotaProvider(input)).toEqual(input)
    }
  })

  it('preserves a valid fresh factual snapshot semantically', () => {
    const input = quota({
      planLabel: 'Plus',
      windows: [{ id: 'primary', label: '5-hour', usedFraction: 0.25, resetsAt: null, windowSeconds: 18_000 }],
      credits: { balance: 0, currency: 'USD' },
    })
    expect(sanitizeQuotaProvider(input)).toEqual(input)
  })

  it('retains factual data as stale only with the original valid observation time', () => {
    const input = quota({
      availability: 'unavailable',
      connection: 'transientFailure',
      freshness: 'stale',
      planLabel: 'Plus',
      windows: [],
      credits: { balance: 3.5, currency: 'USD' },
    })
    expect(sanitizeQuotaProvider(input)).toEqual(input)

    const invalid = sanitizeQuotaProvider({ ...input, observedAt: 'not-a-date' })!
    expect(invalid).toMatchObject({ availability: 'unavailable', freshness: 'unavailable', observedAt: null, windows: [], credits: null, planLabel: null })
  })

  it('fails closed when stale facts do not carry a transient connection', () => {
    const safe = sanitizeQuotaProvider(quota({ freshness: 'stale', availability: 'unavailable', connection: 'connected', credits: { balance: 3.5, currency: 'USD' } }))!
    expect(safe).toMatchObject({ availability: 'unavailable', freshness: 'unavailable', observedAt: null, windows: [], credits: null, planLabel: null })
  })
})
