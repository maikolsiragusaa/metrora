import { describe, expect, it } from 'vitest'

import {
  HistoricalPriceBookValidationError,
  parseHistoricalPriceBookV1,
  renderHistoricalPriceBookMarkdownV1,
  resolveHistoricalPriceRecordV1,
} from './history.js'

function pricedRecord(overrides: Record<string, unknown> = {}) {
  return {
    priceRecordId: 'openai:model-a:2026-01-01',
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
      reference: 'provider pricing page',
      observedAt: '2026-01-01T00:05:00Z',
    },
    ...overrides,
  }
}

function conditionalRates() {
  return [{
    when: { kind: 'prompt-input-tokens-above', tokens: 272_000 },
    rates: {
      inputPerToken: 2e-6,
      outputPerToken: 3e-6,
      cacheReadPerToken: 0.2e-6,
      cacheWritePerToken: 2.5e-6,
    },
  }]
}

function book(records: unknown[]) {
  return { schemaVersion: 1, records }
}

describe('historical price book v1', () => {
  it('accepts the empty bootstrap catalog', () => {
    expect(parseHistoricalPriceBookV1(book([]))).toEqual(book([]))
  })

  it('resolves the price interval active at the call timestamp', () => {
    const first = pricedRecord()
    const second = pricedRecord({
      priceRecordId: 'openai:model-a:2026-07-01',
      validFrom: { basis: 'official-effective', at: '2026-07-01T00:00:00Z' },
      rates: {
        inputPerToken: 0.5e-6,
        outputPerToken: 1e-6,
        cacheReadPerToken: 0.05e-6,
        cacheWritePerToken: 0.625e-6,
      },
      supersedes: 'openai:model-a:2026-01-01',
    })
    const catalog = book([first, second])

    expect(resolveHistoricalPriceRecordV1(catalog, {
      pricingAuthority: 'openai',
      pricingModel: 'model-a',
      timestamp: '2026-06-30T23:59:59Z',
    })?.priceRecordId).toBe('openai:model-a:2026-01-01')

    expect(resolveHistoricalPriceRecordV1(catalog, {
      pricingAuthority: 'openai',
      pricingModel: 'model-a',
      timestamp: '2026-07-01T00:00:00Z',
    })?.priceRecordId).toBe('openai:model-a:2026-07-01')
  })

  it('keeps an explicit free route separate from the paid model identity', () => {
    const paid = pricedRecord()
    const free = pricedRecord({
      priceRecordId: 'openrouter:model-a:free:2026-01-01',
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
        kind: 'official-route',
        reference: 'free route documentation',
        observedAt: '2026-01-01T00:05:00Z',
      },
    })
    const catalog = book([paid, free])

    expect(resolveHistoricalPriceRecordV1(catalog, {
      pricingAuthority: 'openrouter',
      pricingModel: 'model-a',
      route: 'free',
      timestamp: '2026-02-01T00:00:00Z',
    })?.valuation).toEqual({ kind: 'explicit-zero', reason: 'free-route' })

    expect(resolveHistoricalPriceRecordV1(catalog, {
      pricingAuthority: 'openai',
      pricingModel: 'model-a',
      timestamp: '2026-02-01T00:00:00Z',
    })?.valuation).toEqual({ kind: 'priced' })
  })

  it('accepts ordered conditional rate bands', () => {
    const record = pricedRecord({
      rateBands: [
        ...conditionalRates(),
        {
          when: { kind: 'prompt-input-tokens-above', tokens: 500_000 },
          rates: {
            inputPerToken: 3e-6,
            outputPerToken: 4e-6,
            cacheReadPerToken: 0.3e-6,
            cacheWritePerToken: 3.75e-6,
          },
        },
      ],
    })

    expect(parseHistoricalPriceBookV1(book([record])).records[0]?.rateBands).toHaveLength(2)
  })

  it('rejects unordered or duplicate conditional thresholds', () => {
    const invalid = pricedRecord({
      rateBands: [
        {
          when: { kind: 'prompt-input-tokens-above', tokens: 500_000 },
          rates: conditionalRates()[0]!.rates,
        },
        ...conditionalRates(),
      ],
    })

    expect(() => parseHistoricalPriceBookV1(book([invalid])))
      .toThrow(/strictly ordered by ascending prompt-input threshold/)
  })

  it('rejects positive conditional rates for an explicit-zero route', () => {
    const invalid = pricedRecord({
      rates: {
        inputPerToken: 0,
        outputPerToken: 0,
        cacheReadPerToken: 0,
        cacheWritePerToken: 0,
      },
      rateBands: conditionalRates(),
      valuation: { kind: 'explicit-zero', reason: 'free-route' },
    })

    expect(() => parseHistoricalPriceBookV1(book([invalid])))
      .toThrow(/explicit-zero but rate band above 272000 tokens contains a positive monetary rate/)
  })

  it('rejects a zero-only record presented as priced', () => {
    const invalid = pricedRecord({
      rates: {
        inputPerToken: 0,
        outputPerToken: 0,
        cacheReadPerToken: 0,
        cacheWritePerToken: 0,
      },
    })

    expect(() => parseHistoricalPriceBookV1(book([invalid])))
      .toThrowError(HistoricalPriceBookValidationError)
  })

  it('rejects a positive rate presented as an explicit zero', () => {
    const invalid = pricedRecord({
      valuation: { kind: 'explicit-zero', reason: 'free-route' },
    })

    expect(() => parseHistoricalPriceBookV1(book([invalid])))
      .toThrow(/explicit-zero but contains a positive monetary rate/)
  })

  it('requires an append-only supersession chain for later intervals', () => {
    const second = pricedRecord({
      priceRecordId: 'openai:model-a:2026-07-01',
      validFrom: { basis: 'first-observed', at: '2026-07-01T00:00:00Z' },
    })

    expect(() => parseHistoricalPriceBookV1(book([pricedRecord(), second])))
      .toThrow(/must supersede openai:model-a:2026-01-01/)
  })

  it('renders deterministic human-readable documentation', () => {
    const emptyMarkdown = renderHistoricalPriceBookMarkdownV1(book([]))
    expect(emptyMarkdown).toContain('Generated from `src/data/pricing-history/catalog.v1.json`')
    expect(emptyMarkdown).toContain('No reviewed historical price records have been added yet.')

    const conditionalMarkdown = renderHistoricalPriceBookMarkdownV1(book([
      pricedRecord({ rateBands: conditionalRates() }),
    ]))
    expect(conditionalMarkdown).toContain('Conditional rates')
    expect(conditionalMarkdown).toContain('prompt input > 272000')
    expect(conditionalMarkdown).toContain('input $2')
  })
})
