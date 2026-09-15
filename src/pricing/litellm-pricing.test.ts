import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithTimeout } from '../fetch-utils.js'
import { loadRemotePricing } from './litellm-pricing.js'

vi.mock('../fetch-utils.js', () => ({ fetchWithTimeout: vi.fn() }))

const fetchWithTimeoutMock = vi.mocked(fetchWithTimeout)

function okResponse(payload: unknown) {
  return { ok: true, json: async () => payload } as Response
}

let cacheDir: string

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'metrora-pricing-'))
  fetchWithTimeoutMock.mockReset()
})

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true })
})

const litellmPayload = {
  'test-model': { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
}

describe('loadRemotePricing', () => {
  it('caches a successful fetch and serves later loads without the network', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(okResponse(litellmPayload))

    const first = await loadRemotePricing(cacheDir)
    expect(first?.get('test-model')).toBeDefined()
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1)

    const second = await loadRemotePricing(cacheDir)
    expect(second?.get('test-model')).toBeDefined()
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1)
  })

  it('marks a failed fetch and skips the network for subsequent spawns', async () => {
    fetchWithTimeoutMock.mockRejectedValueOnce(new Error('network unreachable'))

    const first = await loadRemotePricing(cacheDir)
    expect(first).toBeNull()
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1)

    // A new CLI spawn would call loadRemotePricing again; the fresh marker must
    // prevent another full network-timeout stall.
    const second = await loadRemotePricing(cacheDir)
    expect(second).toBeNull()
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1)

    const marker = JSON.parse(await readFile(join(cacheDir, 'litellm-pricing.failed.json'), 'utf-8')) as { timestamp: number }
    expect(Number.isFinite(marker.timestamp)).toBe(true)
  })

  it('retries the network once the failure marker has expired', async () => {
    await writeFile(
      join(cacheDir, 'litellm-pricing.failed.json'),
      JSON.stringify({ timestamp: Date.now() - 6 * 60 * 1000 }),
    )

    fetchWithTimeoutMock.mockResolvedValueOnce(okResponse(litellmPayload))
    const pricing = await loadRemotePricing(cacheDir)
    expect(pricing?.get('test-model')).toBeDefined()
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1)
  })
})
