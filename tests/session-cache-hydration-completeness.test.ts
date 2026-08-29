import { describe, expect, it } from 'vitest'

import { applySessionCacheDiscoveryCompleteness } from '../src/session-cache-completeness.js'
import type { SessionCache } from '../src/session-cache.js'

function cache(complete: boolean, dirty = false): SessionCache {
  const value: SessionCache = { version: 8, providers: {}, complete }
  if (dirty) (value as { _dirty?: boolean })._dirty = true
  return value
}

describe('session cache hydration completeness', () => {
  it('completes a provider-safe hydration even when global discovery is degraded', () => {
    const value = cache(false)

    expect(applySessionCacheDiscoveryCompleteness(value, false)).toBe(true)
    expect(value.complete).toBe(true)
    expect((value as { _dirty?: boolean })._dirty).toBe(true)
  })

  it('does not demote a warm cache because an unrelated provider is degraded', () => {
    const value = cache(true)

    expect(applySessionCacheDiscoveryCompleteness(value, false)).toBe(false)
    expect(value.complete).toBe(true)
  })

  it('does not stamp a provider-scoped parse as a globally complete hydration', () => {
    const value = cache(false)

    expect(applySessionCacheDiscoveryCompleteness(value, true, 'provider')).toBe(false)
    expect(value.complete).toBe(false)
    expect((value as { _dirty?: boolean })._dirty).toBeUndefined()
  })

  it('publishes provider-scoped mutations without upgrading global completeness', () => {
    const value = cache(false, true)

    expect(applySessionCacheDiscoveryCompleteness(value, true, 'provider')).toBe(true)
    expect(value.complete).toBe(false)
    expect((value as { _dirty?: boolean })._dirty).toBe(true)
  })

  it('still publishes ordinary dirty cache mutations', () => {
    const value = cache(true, true)

    expect(applySessionCacheDiscoveryCompleteness(value, false)).toBe(true)
    expect(value.complete).toBe(true)
  })
})
