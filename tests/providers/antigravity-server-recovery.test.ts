import { describe, expect, it, vi } from 'vitest'

import {
  ExpiringServerDiscoveryCache,
  runWithSingleServerRediscovery,
  type RecoverableServer,
} from '../../src/providers/antigravity-server-recovery.js'

const FIRST: RecoverableServer = { port: 41001, csrfToken: 'first-token-123456' }
const SECOND: RecoverableServer = { port: 41002, csrfToken: 'second-token-123456' }

describe('Antigravity language-server recovery', () => {
  it('expires an unavailable discovery result so a late-started server is found', async () => {
    let now = 1_000
    const cache = new ExpiringServerDiscoveryCache<string, RecoverableServer>(5_000, () => now)
    const discover = vi.fn<() => Promise<RecoverableServer | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(FIRST)

    await expect(cache.getOrDiscover('antigravity-cli', discover)).resolves.toBeNull()
    now += 4_999
    await expect(cache.getOrDiscover('antigravity-cli', discover)).resolves.toBeNull()
    expect(discover).toHaveBeenCalledTimes(1)

    now += 1
    await expect(cache.getOrDiscover('antigravity-cli', discover)).resolves.toEqual(FIRST)
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('reuses one healthy discovered endpoint', async () => {
    const cache = new ExpiringServerDiscoveryCache<string, RecoverableServer>(5_000)
    const discover = vi.fn(async () => FIRST)

    await expect(cache.getOrDiscover('antigravity', discover)).resolves.toEqual(FIRST)
    await expect(cache.getOrDiscover('antigravity', discover)).resolves.toEqual(FIRST)

    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('invalidates only the endpoint that actually failed', async () => {
    const cache = new ExpiringServerDiscoveryCache<string, RecoverableServer>(5_000)
    await cache.getOrDiscover('antigravity-ide', async () => SECOND)

    expect(cache.invalidate('antigravity-ide', FIRST)).toBe(false)
    await expect(cache.getOrDiscover('antigravity-ide', async () => FIRST)).resolves.toEqual(SECOND)

    expect(cache.invalidate('antigravity-ide', SECOND)).toBe(true)
    await expect(cache.getOrDiscover('antigravity-ide', async () => FIRST)).resolves.toEqual(FIRST)
  })

  it('rediscoveries once after a stale endpoint fails and uses the restarted server', async () => {
    const detect = vi.fn<() => Promise<RecoverableServer | null>>()
      .mockResolvedValueOnce(FIRST)
      .mockResolvedValueOnce(SECOND)
    const invalidate = vi.fn()
    const operation = vi.fn(async (server: RecoverableServer) => {
      if (server.port === FIRST.port) throw new Error('stale endpoint')
      return `ok:${server.port}`
    })

    await expect(runWithSingleServerRediscovery({ detect, invalidate, operation }))
      .resolves.toBe(`ok:${SECOND.port}`)

    expect(detect).toHaveBeenCalledTimes(2)
    expect(operation).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith(FIRST)
  })

  it('stops after one retry when both endpoints fail', async () => {
    const detect = vi.fn<() => Promise<RecoverableServer | null>>()
      .mockResolvedValueOnce(FIRST)
      .mockResolvedValueOnce(SECOND)
      .mockResolvedValueOnce({ port: 41003, csrfToken: 'third-token-123456' })
    const invalidate = vi.fn()
    const operation = vi.fn(async () => {
      throw new Error('unavailable')
    })

    await expect(runWithSingleServerRediscovery({ detect, invalidate, operation }))
      .resolves.toBeNull()

    expect(detect).toHaveBeenCalledTimes(2)
    expect(operation).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenNthCalledWith(1, FIRST)
    expect(invalidate).toHaveBeenNthCalledWith(2, SECOND)
  })

  it('does not execute the RPC operation when no server is available', async () => {
    const detect = vi.fn(async () => null)
    const invalidate = vi.fn()
    const operation = vi.fn(async () => 'unexpected')

    await expect(runWithSingleServerRediscovery({ detect, invalidate, operation }))
      .resolves.toBeNull()

    expect(detect).toHaveBeenCalledTimes(1)
    expect(operation).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
