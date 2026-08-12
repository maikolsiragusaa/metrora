import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getModelCosts, loadPricing } from '../src/models.js'

describe('LiteLLM refresh entry validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('skips null, primitive, array, and malformed entries while retaining later valid entries', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'metrora-litellm-malformed-'))
    const previousCacheDir = process.env['METRORA_CACHE_DIR']

    try {
      process.env['METRORA_CACHE_DIR'] = cacheDir
      const dataset = {
        'invalid-null-entry': null,
        'invalid-array-entry': [],
        'invalid-string-entry': 'not an object',
        'invalid-number-entry': 42,
        'invalid-partial-entry': { input_cost_per_token: 1e-6 },
        'valid-after-malformed-entries': {
          input_cost_per_token: 1e-6,
          output_cost_per_token: 2e-6,
        },
      }

      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(dataset), { status: 200 })))

      await loadPricing()

      expect(getModelCosts('valid-after-malformed-entries')).toMatchObject({
        inputCostPerToken: 1e-6,
        outputCostPerToken: 2e-6,
      })
      expect(getModelCosts('invalid-null-entry')).toBeNull()
      expect(getModelCosts('invalid-array-entry')).toBeNull()
      expect(getModelCosts('invalid-string-entry')).toBeNull()
      expect(getModelCosts('invalid-number-entry')).toBeNull()
      expect(getModelCosts('invalid-partial-entry')).toBeNull()

      const cache = JSON.parse(await readFile(join(cacheDir, 'litellm-pricing.json'), 'utf8')) as {
        data: Record<string, unknown>
      }
      expect(cache.data['valid-after-malformed-entries']).toBeDefined()
      expect(cache.data['invalid-null-entry']).toBeUndefined()
    } finally {
      if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
      else process.env['METRORA_CACHE_DIR'] = previousCacheDir
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
