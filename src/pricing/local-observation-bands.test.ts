import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadLocalPriceObservationBookV1,
  observeCurrentPriceV1,
  type LocalPriceObservationInputV1,
} from './local-observation-ledger.js'

const temporaryRoots: string[] = []

async function temporaryDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-price-bands-'))
  temporaryRoots.push(root)
  return root
}

function input(outputPerToken: number): LocalPriceObservationInputV1 {
  return {
    pricingAuthority: 'openai',
    pricingModel: 'conditional-model',
    rates: {
      inputPerToken: 1e-6,
      outputPerToken: 2e-6,
      cacheReadPerToken: 0.1e-6,
      cacheWritePerToken: 1.25e-6,
    },
    rateBands: [{
      when: { kind: 'prompt-input-tokens-above', tokens: 272_000 },
      rates: {
        inputPerToken: 2e-6,
        outputPerToken,
        cacheReadPerToken: 0.2e-6,
        cacheWritePerToken: 2.5e-6,
      },
    }],
    valuation: { kind: 'priced' },
    source: {
      kind: 'litellm',
      reference: 'https://example.invalid/conditional-prices.json',
      digest: `sha256:${'f'.repeat(64)}`,
    },
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('local conditional pricing observations', () => {
  it('persists conditional bands as immutable pricing evidence', async () => {
    const dataDir = await temporaryDataDir()
    const observed = await observeCurrentPriceV1(input(3e-6), {
      dataDir,
      now: () => new Date('2026-07-01T00:00:00Z'),
    })

    expect(observed.record.rateBands?.[0]?.when.tokens).toBe(272_000)
    expect((await loadLocalPriceObservationBookV1({ dataDir })).records[0]?.rateBands)
      .toEqual(observed.record.rateBands)
  })

  it('treats a conditional-band change as a new append-only price interval', async () => {
    const dataDir = await temporaryDataDir()
    const first = await observeCurrentPriceV1(input(3e-6), {
      dataDir,
      now: () => new Date('2026-07-01T00:00:00Z'),
    })
    const second = await observeCurrentPriceV1(input(4e-6), {
      dataDir,
      now: () => new Date('2026-07-02T00:00:00Z'),
    })

    expect(second.status).toBe('observed')
    expect(second.record.supersedes).toBe(first.record.priceRecordId)
    expect((await loadLocalPriceObservationBookV1({ dataDir })).records).toHaveLength(2)
  })
})
