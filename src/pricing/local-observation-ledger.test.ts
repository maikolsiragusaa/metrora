import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { HistoricalPriceBookV1 } from './history.js'
import {
  LocalPriceObservationLedgerError,
  loadLocalPriceObservationBookV1,
  localPriceObservationDirectoryV1,
  observeCurrentPriceV1,
  resolveHistoricalPriceAcrossBooksV1,
  scanLocalPriceObservationsV1,
  type LocalPriceObservationInputV1,
} from './local-observation-ledger.js'

const temporaryRoots: string[] = []
const EMPTY_BOOK: HistoricalPriceBookV1 = { schemaVersion: 1, records: [] }

async function temporaryDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'qovrion-price-observation-'))
  temporaryRoots.push(root)
  return root
}

function pricedInput(overrides: Partial<LocalPriceObservationInputV1> = {}): LocalPriceObservationInputV1 {
  return {
    pricingAuthority: 'openai',
    pricingModel: 'model-a',
    rates: {
      inputPerToken: 1e-6,
      outputPerToken: 2e-6,
      cacheReadPerToken: 0.1e-6,
      cacheWritePerToken: 1.25e-6,
    },
    valuation: { kind: 'priced' },
    source: {
      kind: 'litellm',
      reference: 'https://example.invalid/prices.json',
      revision: 'revision-a',
      digest: `sha256:${'a'.repeat(64)}`,
    },
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('local price-observation ledger v1', () => {
  it('writes and reloads one immutable first-observation record', async () => {
    const dataDir = await temporaryDataDir()
    const result = await observeCurrentPriceV1(pricedInput(), {
      dataDir,
      now: () => new Date('2026-07-01T10:00:00Z'),
    })

    expect(result.status).toBe('observed')
    expect(result.record.validFrom).toEqual({
      basis: 'first-observed',
      at: '2026-07-01T10:00:00.000Z',
    })
    expect(result.record.source.observedAt).toBe('2026-07-01T10:00:00.000Z')

    const book = await loadLocalPriceObservationBookV1({ dataDir })
    expect(book.records).toEqual([result.record])
    expect(await readdir(localPriceObservationDirectoryV1(dataDir))).toHaveLength(1)
  })

  it('deduplicates repeated snapshots when the economic price did not change', async () => {
    const dataDir = await temporaryDataDir()
    const first = await observeCurrentPriceV1(pricedInput(), {
      dataDir,
      now: () => new Date('2026-07-01T10:00:00Z'),
    })
    const duplicate = await observeCurrentPriceV1(pricedInput({
      source: {
        kind: 'litellm',
        reference: 'https://example.invalid/prices.json',
        revision: 'revision-b',
        digest: `sha256:${'b'.repeat(64)}`,
      },
    }), {
      dataDir,
      now: () => new Date('2026-07-02T10:00:00Z'),
    })

    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.record.priceRecordId).toBe(first.record.priceRecordId)
    expect((await loadLocalPriceObservationBookV1({ dataDir })).records).toHaveLength(1)
  })

  it('appends a changed rate and binds it to its predecessor', async () => {
    const dataDir = await temporaryDataDir()
    const first = await observeCurrentPriceV1(pricedInput(), {
      dataDir,
      now: () => new Date('2026-07-01T10:00:00Z'),
    })
    const second = await observeCurrentPriceV1(pricedInput({
      rates: {
        inputPerToken: 0.5e-6,
        outputPerToken: 1e-6,
        cacheReadPerToken: 0.05e-6,
        cacheWritePerToken: 0.625e-6,
      },
      source: {
        kind: 'litellm',
        reference: 'https://example.invalid/prices.json',
        revision: 'revision-b',
        digest: `sha256:${'b'.repeat(64)}`,
      },
    }), {
      dataDir,
      now: () => new Date('2026-07-15T08:30:00Z'),
    })

    expect(second.status).toBe('observed')
    expect(second.record.supersedes).toBe(first.record.priceRecordId)
    const book = await loadLocalPriceObservationBookV1({ dataDir })
    expect(book.records).toHaveLength(2)

    expect(resolveHistoricalPriceAcrossBooksV1(EMPTY_BOOK, book, {
      pricingAuthority: 'openai',
      pricingModel: 'model-a',
      timestamp: '2026-07-14T23:59:59Z',
    })?.record.priceRecordId).toBe(first.record.priceRecordId)
    expect(resolveHistoricalPriceAcrossBooksV1(EMPTY_BOOK, book, {
      pricingAuthority: 'openai',
      pricingModel: 'model-a',
      timestamp: '2026-07-15T08:30:00Z',
    })?.record.priceRecordId).toBe(second.record.priceRecordId)
  })

  it('keeps an explicitly free route separate from the paid route', async () => {
    const dataDir = await temporaryDataDir()
    await observeCurrentPriceV1(pricedInput({ pricingAuthority: 'openrouter' }), {
      dataDir,
      now: () => new Date('2026-07-01T10:00:00Z'),
    })
    const free = await observeCurrentPriceV1(pricedInput({
      pricingAuthority: 'openrouter',
      route: 'free',
      rates: {
        inputPerToken: 0,
        outputPerToken: 0,
        cacheReadPerToken: 0,
        cacheWritePerToken: 0,
      },
      valuation: { kind: 'explicit-zero', reason: 'free-route' },
      source: {
        kind: 'openrouter',
        reference: 'https://example.invalid/free-route',
        digest: `sha256:${'c'.repeat(64)}`,
      },
    }), {
      dataDir,
      now: () => new Date('2026-07-01T10:00:00Z'),
    })

    const book = await loadLocalPriceObservationBookV1({ dataDir })
    expect(book.records).toHaveLength(2)
    expect(resolveHistoricalPriceAcrossBooksV1(EMPTY_BOOK, book, {
      pricingAuthority: 'openrouter',
      pricingModel: 'model-a',
      route: 'free',
      timestamp: '2026-07-02T00:00:00Z',
    })?.record.priceRecordId).toBe(free.record.priceRecordId)
  })

  it('serializes concurrent observations into one immutable record', async () => {
    const dataDir = await temporaryDataDir()
    const results = await Promise.all([
      observeCurrentPriceV1(pricedInput(), {
        dataDir,
        now: () => new Date('2026-07-01T10:00:00Z'),
      }),
      observeCurrentPriceV1(pricedInput(), {
        dataDir,
        now: () => new Date('2026-07-01T10:00:00Z'),
      }),
    ])

    expect(results.map(result => result.status).sort()).toEqual(['duplicate', 'observed'])
    expect((await loadLocalPriceObservationBookV1({ dataDir })).records).toHaveLength(1)
  })

  it('fails closed when an immutable observation file is corrupted', async () => {
    const dataDir = await temporaryDataDir()
    await observeCurrentPriceV1(pricedInput(), {
      dataDir,
      now: () => new Date('2026-07-01T10:00:00Z'),
    })
    const directory = localPriceObservationDirectoryV1(dataDir)
    const [file] = await readdir(directory)
    await writeFile(join(directory, file!), '{broken', 'utf8')

    const scan = await scanLocalPriceObservationsV1({ dataDir })
    expect(scan.invalid).toHaveLength(1)
    await expect(loadLocalPriceObservationBookV1({ dataDir }))
      .rejects.toBeInstanceOf(LocalPriceObservationLedgerError)
  })

  it('lets a later local observation protect new usage without repricing older usage', () => {
    const reviewed: HistoricalPriceBookV1 = {
      schemaVersion: 1,
      records: [{
        priceRecordId: 'reviewed:model-a:2026-01-01',
        pricingAuthority: 'openai',
        pricingModel: 'model-a',
        validFrom: { basis: 'official-effective', at: '2026-01-01T00:00:00Z' },
        rates: {
          inputPerToken: 1e-6,
          outputPerToken: 2e-6,
          cacheReadPerToken: 0.1e-6,
          cacheWritePerToken: 1.25e-6,
        },
        valuation: { kind: 'priced' },
        source: {
          kind: 'official-provider',
          reference: 'official pricing',
          observedAt: '2026-01-01T00:00:00Z',
        },
      }],
    }
    const local: HistoricalPriceBookV1 = {
      schemaVersion: 1,
      records: [{
        priceRecordId: 'local:model-a:2026-07-01',
        pricingAuthority: 'openai',
        pricingModel: 'model-a',
        validFrom: { basis: 'first-observed', at: '2026-07-01T10:00:00Z' },
        rates: {
          inputPerToken: 0.5e-6,
          outputPerToken: 1e-6,
          cacheReadPerToken: 0.05e-6,
          cacheWritePerToken: 0.625e-6,
        },
        valuation: { kind: 'priced' },
        source: {
          kind: 'litellm',
          reference: 'current feed',
          digest: `sha256:${'d'.repeat(64)}`,
          observedAt: '2026-07-01T10:00:00Z',
        },
      }],
    }

    expect(resolveHistoricalPriceAcrossBooksV1(reviewed, local, {
      pricingAuthority: 'openai',
      pricingModel: 'model-a',
      timestamp: '2026-06-30T23:59:59Z',
    })?.origin).toBe('reviewed-book')
    expect(resolveHistoricalPriceAcrossBooksV1(reviewed, local, {
      pricingAuthority: 'openai',
      pricingModel: 'model-a',
      timestamp: '2026-07-02T00:00:00Z',
    })?.origin).toBe('local-observation')
  })

  it('prefers reviewed provenance after the same observed price is promoted', () => {
    const rates = {
      inputPerToken: 0.5e-6,
      outputPerToken: 1e-6,
      cacheReadPerToken: 0.05e-6,
      cacheWritePerToken: 0.625e-6,
    }
    const reviewed: HistoricalPriceBookV1 = {
      schemaVersion: 1,
      records: [{
        priceRecordId: 'reviewed:model-a:new-price',
        pricingAuthority: 'openai',
        pricingModel: 'model-a',
        validFrom: { basis: 'official-effective', at: '2026-07-01T00:00:00Z' },
        rates,
        valuation: { kind: 'priced' },
        source: {
          kind: 'official-provider',
          reference: 'official pricing',
          observedAt: '2026-07-03T00:00:00Z',
        },
      }],
    }
    const local: HistoricalPriceBookV1 = {
      schemaVersion: 1,
      records: [{
        priceRecordId: 'local:model-a:new-price',
        pricingAuthority: 'openai',
        pricingModel: 'model-a',
        validFrom: { basis: 'first-observed', at: '2026-07-02T00:00:00Z' },
        rates,
        valuation: { kind: 'priced' },
        source: {
          kind: 'litellm',
          reference: 'current feed',
          digest: `sha256:${'e'.repeat(64)}`,
          observedAt: '2026-07-02T00:00:00Z',
        },
      }],
    }

    const resolved = resolveHistoricalPriceAcrossBooksV1(reviewed, local, {
      pricingAuthority: 'openai',
      pricingModel: 'model-a',
      timestamp: '2026-07-04T00:00:00Z',
    })
    expect(resolved?.origin).toBe('reviewed-book')
    expect(resolved?.record.priceRecordId).toBe('reviewed:model-a:new-price')
  })

  it('requires a content digest before recording mutable pricing evidence', async () => {
    const dataDir = await temporaryDataDir()
    const invalid = pricedInput() as unknown as Record<string, unknown>
    invalid.source = {
      kind: 'litellm',
      reference: 'https://example.invalid/prices.json',
    }

    await expect(observeCurrentPriceV1(invalid as LocalPriceObservationInputV1, { dataDir }))
      .rejects.toThrow()
  })
})
