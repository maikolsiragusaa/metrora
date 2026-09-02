import { describe, expect, it } from 'vitest'

import {
  COMPANION_CAPACITY_SCOPE,
  isCompanionCapacityV1,
  toCompanionCapacityV1,
  unavailableCompanionCapacityV1,
} from './capacity-contract.js'

const OBSERVED_AT = '2026-08-14T10:00:00.000Z'
const DESKTOP_ID = 'ab'.repeat(32)

function quota(provider: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    provider,
    authority: 'provider-reported',
    availability: 'available',
    connection: 'connected',
    freshness: 'fresh',
    observedAt: OBSERVED_AT,
    planLabel: `${provider} plan`,
    windows: [{ id: 'primary', label: 'Primary window', usedFraction: 0.25, resetsAt: '2026-08-15T10:00:00.000Z', windowSeconds: 86_400 }],
    credits: null,
    rateLimit: { state: 'clear', retryAt: null },
    ...overrides,
  }
}

describe('Companion Capacity V1 projection', () => {
  it('projects the closed canonical provider set with factual percentages, resets and credits', () => {
    const snapshot = toCompanionCapacityV1([
      quota('antigravity'),
      quota('claude'),
      quota('codex', { windows: [], planLabel: null, credits: { balance: 0, currency: 'USD' } }),
      quota('copilot'),
      quota('kimi'),
    ], { desktopId: DESKTOP_ID, generatedAt: OBSERVED_AT })

    expect(isCompanionCapacityV1(snapshot)).toBe(true)
    expect(snapshot.scope.id).toBe(COMPANION_CAPACITY_SCOPE)
    expect(snapshot.providers.map(provider => provider.provider)).toEqual([
      'claude', 'codex', 'copilot', 'kimi', 'antigravity',
    ])
    expect(snapshot.providers.map(provider => provider.displayName)).toEqual([
      'Claude', 'Codex', 'GitHub Copilot', 'Kimi Code', 'Antigravity',
    ])
    expect(snapshot.providers[0]).toMatchObject({
      availability: 'available',
      freshness: 'fresh',
      windows: [{ usedPercent: 25, remainingPercent: 75, resetsAt: '2026-08-15T10:00:00.000Z' }],
    })
    expect(snapshot.providers[1]?.credits).toEqual({ balance: 0, currency: 'USD' })
    expect(snapshot.providers[1]?.windows).toEqual([])
  })

  it('keeps explicit zero but never turns an unmetered observation into zero quota', () => {
    const zero = toCompanionCapacityV1([
      quota('codex', { windows: [{ id: 'primary', label: 'Primary window', usedFraction: 0, resetsAt: null }], planLabel: null }),
    ], { desktopId: DESKTOP_ID, generatedAt: OBSERVED_AT })
    expect(zero.providers[0]?.windows[0]).toMatchObject({ usedPercent: 0, remainingPercent: 100 })

    const unmetered = toCompanionCapacityV1([
      quota('claude', { windows: [], credits: null, planLabel: null }),
    ], { desktopId: DESKTOP_ID, generatedAt: OBSERVED_AT })
    expect(unmetered).toMatchObject({ available: false, freshness: 'unavailable' })
    expect(unmetered.providers[0]).toMatchObject({ availability: 'unavailable', freshness: 'unavailable', windows: [], credits: null, planLabel: null })
    expect(JSON.stringify(unmetered)).not.toContain('usedPercent')
    expect(isCompanionCapacityV1(unavailableCompanionCapacityV1())).toBe(true)
  })

  it('retains stale provider facts with their original observation time', () => {
    const snapshot = toCompanionCapacityV1([
      quota('kimi', { connection: 'transientFailure', freshness: 'stale' }),
    ], { desktopId: DESKTOP_ID, generatedAt: '2026-08-14T10:05:00.000Z' })

    expect(snapshot).toMatchObject({ available: true, freshness: 'stale' })
    expect(snapshot.providers[0]).toMatchObject({
      availability: 'unavailable',
      connection: 'transientFailure',
      freshness: 'stale',
      observedAt: OBSERVED_AT,
    })
  })

  it('allowlists display fields and drops account, credential and filesystem data', () => {
    const unsafe = quota('claude', {
      planLabel: 'C:\\Users\\fixture\\account@example.com',
      accountEmail: 'account@example.com',
      accessToken: 'secret-token',
      accountId: 'acct_private',
      localPath: 'C:\\Users\\fixture\\workspace',
      windows: [{ id: '../../token', label: 'C:\\Users\\fixture', usedFraction: 0.5, resetsAt: null }],
    })
    const snapshot = toCompanionCapacityV1([unsafe], { desktopId: DESKTOP_ID, generatedAt: OBSERVED_AT })
    const serialized = JSON.stringify(snapshot)

    expect(snapshot.providers[0]).toMatchObject({ availability: 'unavailable', freshness: 'unavailable', windows: [], planLabel: null })
    expect(serialized).not.toContain('account@example.com')
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain('C:\\Users\\fixture')
    expect(serialized).not.toContain('acct_private')
  })
})
