import { describe, expect, it } from 'vitest'

import {
  QUOTA_PACE_ETA_MAX_WINDOW_SECONDS,
  QUOTA_PACE_MIN_ELAPSED_FRACTION,
  computePace,
  type QuotaPaceWindow,
} from '../src/quota.js'

const NOW = new Date('2026-07-18T12:00:00Z')
const WEEK = 7 * 24 * 3600
const FIVE_HOURS = 5 * 3600

function window(overrides: Partial<QuotaPaceWindow> = {}): QuotaPaceWindow {
  return {
    usedFraction: 0.5,
    windowSeconds: WEEK,
    resetsAt: resetsAfterElapsedFraction(0.5, WEEK),
    ...overrides,
  }
}

/** resetsAt such that `fraction` of the window has elapsed at NOW. */
function resetsAfterElapsedFraction(fraction: number, windowSeconds: number): Date {
  return new Date(NOW.getTime() + windowSeconds * (1 - fraction) * 1000)
}

describe('computePace', () => {
  it('reports on-pace at the window midpoint', () => {
    const pace = computePace(window(), NOW)
    expect(pace?.expectedFraction).toBeCloseTo(0.5, 6)
    expect(pace?.deltaFraction).toBeCloseTo(0, 6)
    expect(pace?.projectedAtReset).toBeCloseTo(1, 6)
    expect(pace?.exhaustsAt).toBeUndefined()
  })

  it('computes deficit with an exhaustion ETA strictly before the reset', () => {
    const resetsAt = resetsAfterElapsedFraction(0.5, WEEK)
    const pace = computePace(window({ usedFraction: 0.8, resetsAt }), NOW)
    expect(pace?.deltaFraction).toBeCloseTo(0.3, 6)
    expect(pace?.projectedAtReset).toBeCloseTo(1.6, 6)
    const expectedHit = NOW.getTime() + WEEK * (0.5 * (1 / 0.8) - 0.5) * 1000
    expect(pace?.exhaustsAt?.getTime()).toBeCloseTo(expectedHit, -3)
    expect(pace!.exhaustsAt!.getTime()).toBeLessThan(resetsAt.getTime())
  })

  it('reports reserve without an ETA', () => {
    const pace = computePace(window({ usedFraction: 0.2 }), NOW)
    expect(pace?.deltaFraction).toBeCloseTo(-0.3, 6)
    expect(pace?.projectedAtReset).toBeCloseTo(0.4, 6)
    expect(pace?.exhaustsAt).toBeUndefined()
  })

  it('suppresses the ETA on short windows but keeps the deficit', () => {
    const pace = computePace(window({ usedFraction: 0.9, windowSeconds: FIVE_HOURS, resetsAt: resetsAfterElapsedFraction(0.5, FIVE_HOURS) }), NOW)
    expect(pace?.deltaFraction).toBeCloseTo(0.4, 6)
    expect(pace?.projectedAtReset).toBeGreaterThan(1)
    expect(pace?.exhaustsAt).toBeUndefined()
  })

  it('says nothing early in the window', () => {
    const early = window({ resetsAt: resetsAfterElapsedFraction(0.02, WEEK) })
    expect(computePace(early, NOW)).toBeUndefined()
    expect(0.02).toBeLessThan(QUOTA_PACE_MIN_ELAPSED_FRACTION)
  })

  it('says nothing on skewed or missing inputs', () => {
    expect(computePace(window({ resetsAt: new Date(NOW.getTime() - 60_000) }), NOW)).toBeUndefined()
    expect(computePace(window({ resetsAt: new Date(NOW.getTime() + (WEEK + 3600) * 1000) }), NOW)).toBeUndefined()
    expect(computePace(window({ resetsAt: undefined }), NOW)).toBeUndefined()
    expect(computePace(window({ windowSeconds: undefined }), NOW)).toBeUndefined()
    expect(computePace(window({ windowSeconds: 0 }), NOW)).toBeUndefined()
    expect(computePace(window({ resetsAt: 'not-a-date' }), NOW)).toBeUndefined()
  })

  it('says nothing on an exhausted window, clamping over-range input', () => {
    expect(computePace(window({ usedFraction: 1 }), NOW)).toBeUndefined()
    expect(computePace(window({ usedFraction: 1.3 }), NOW)).toBeUndefined()
  })

  it('treats zero usage mid-window as pure reserve', () => {
    const pace = computePace(window({ usedFraction: 0 }), NOW)
    expect(pace?.deltaFraction).toBeCloseTo(-0.5, 6)
    expect(pace?.projectedAtReset).toBe(0)
    expect(pace?.exhaustsAt).toBeUndefined()
  })

  it('keeps the ETA boundary aligned with the exported constant', () => {
    const boundary = window({ usedFraction: 0.9, windowSeconds: QUOTA_PACE_ETA_MAX_WINDOW_SECONDS, resetsAt: resetsAfterElapsedFraction(0.5, QUOTA_PACE_ETA_MAX_WINDOW_SECONDS) })
    expect(computePace(boundary, NOW)?.exhaustsAt).toBeUndefined()
    const above = window({ usedFraction: 0.9, windowSeconds: QUOTA_PACE_ETA_MAX_WINDOW_SECONDS + 3600, resetsAt: resetsAfterElapsedFraction(0.5, QUOTA_PACE_ETA_MAX_WINDOW_SECONDS + 3600) })
    expect(computePace(above, NOW)?.exhaustsAt).toBeInstanceOf(Date)
  })

  it('returns undefined for malformed and non-finite usage instead of a NaN pace', () => {
    expect(computePace(window({ usedFraction: NaN }), NOW)).toBeUndefined()
    expect(computePace(window({ usedFraction: Infinity }), NOW)).toBeUndefined()
  })
})
