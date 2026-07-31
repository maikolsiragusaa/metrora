import { z } from 'zod'

const IsoInstantSchema = z.string().datetime({ offset: true })
const NonEmptyIdentifierSchema = z.string().trim().min(1).max(240)
const OptionalIdentityPartSchema = z.string().trim().min(1).max(240).optional()
const MoneyRateSchema = z.number().finite().nonnegative()
const PositiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const HistoricalPriceStartBasisV1Schema = z.enum([
  'official-effective',
  'reviewed-effective',
  'first-observed',
])

export const HistoricalPriceSourceKindV1Schema = z.enum([
  'official-provider',
  'official-route',
  'litellm',
  'models-dev',
  'openrouter',
  'manual-reviewed',
])

export const HistoricalPriceZeroReasonV1Schema = z.enum([
  'free-route',
  'free-model',
  'local-inference',
  'manual-reviewed',
])

export const HistoricalPriceRatesV1Schema = z.strictObject({
  inputPerToken: MoneyRateSchema,
  outputPerToken: MoneyRateSchema,
  cacheReadPerToken: MoneyRateSchema,
  cacheWritePerToken: MoneyRateSchema,
  webSearchPerRequest: MoneyRateSchema.optional(),
  fastMultiplier: z.number().finite().positive().optional(),
})

export const HistoricalPriceRateBandV1Schema = z.strictObject({
  when: z.strictObject({
    kind: z.literal('prompt-input-tokens-above'),
    tokens: PositiveSafeIntegerSchema,
  }),
  rates: HistoricalPriceRatesV1Schema,
})

export const HistoricalPriceValuationV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('priced') }),
  z.strictObject({
    kind: z.literal('explicit-zero'),
    reason: HistoricalPriceZeroReasonV1Schema,
  }),
])

export const HistoricalPriceRecordV1Schema = z.strictObject({
  priceRecordId: NonEmptyIdentifierSchema,
  pricingAuthority: NonEmptyIdentifierSchema,
  pricingModel: NonEmptyIdentifierSchema,
  route: OptionalIdentityPartSchema,
  billingTier: OptionalIdentityPartSchema,
  validFrom: z.strictObject({
    basis: HistoricalPriceStartBasisV1Schema,
    at: IsoInstantSchema,
  }),
  validUntil: IsoInstantSchema.optional(),
  rates: HistoricalPriceRatesV1Schema,
  rateBands: z.array(HistoricalPriceRateBandV1Schema).max(20).optional(),
  valuation: HistoricalPriceValuationV1Schema,
  source: z.strictObject({
    kind: HistoricalPriceSourceKindV1Schema,
    reference: z.string().trim().min(1).max(2_000),
    revision: z.string().trim().min(1).max(500).optional(),
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
    observedAt: IsoInstantSchema,
  }),
  supersedes: NonEmptyIdentifierSchema.optional(),
})

export const HistoricalPriceBookV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  records: z.array(HistoricalPriceRecordV1Schema),
})

export type HistoricalPriceStartBasisV1 = z.infer<typeof HistoricalPriceStartBasisV1Schema>
export type HistoricalPriceSourceKindV1 = z.infer<typeof HistoricalPriceSourceKindV1Schema>
export type HistoricalPriceRatesV1 = z.infer<typeof HistoricalPriceRatesV1Schema>
export type HistoricalPriceRateBandV1 = z.infer<typeof HistoricalPriceRateBandV1Schema>
export type HistoricalPriceRecordV1 = z.infer<typeof HistoricalPriceRecordV1Schema>
export type HistoricalPriceBookV1 = z.infer<typeof HistoricalPriceBookV1Schema>

export type HistoricalPriceLookupV1 = {
  pricingAuthority: string
  pricingModel: string
  route?: string
  billingTier?: string
  timestamp: string
}

export class HistoricalPriceBookValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid historical price book:\n- ${issues.join('\n- ')}`)
    this.name = 'HistoricalPriceBookValidationError'
    this.issues = issues
  }
}

function timestampMs(value: string): number {
  return Date.parse(value)
}

function identityKey(record: Pick<HistoricalPriceRecordV1, 'pricingAuthority' | 'pricingModel' | 'route' | 'billingTier'>): string {
  return JSON.stringify([
    record.pricingAuthority,
    record.pricingModel,
    record.route ?? null,
    record.billingTier ?? null,
  ])
}

function monetaryRates(rates: HistoricalPriceRatesV1): number[] {
  return [
    rates.inputPerToken,
    rates.outputPerToken,
    rates.cacheReadPerToken,
    rates.cacheWritePerToken,
    rates.webSearchPerRequest ?? 0,
  ]
}

function validateRateBands(record: HistoricalPriceRecordV1, issues: string[]): void {
  let previousThreshold = 0
  for (const [index, band] of (record.rateBands ?? []).entries()) {
    const threshold = band.when.tokens
    if (index > 0 && threshold <= previousThreshold) {
      issues.push(`${record.priceRecordId} rateBands must be strictly ordered by ascending prompt-input threshold`)
    }
    previousThreshold = threshold

    const rates = monetaryRates(band.rates)
    if (record.valuation.kind === 'explicit-zero' && rates.some(rate => rate !== 0)) {
      issues.push(`${record.priceRecordId} is explicit-zero but rate band above ${threshold} tokens contains a positive monetary rate`)
    }
    if (record.valuation.kind === 'priced' && rates.every(rate => rate === 0)) {
      issues.push(`${record.priceRecordId} rate band above ${threshold} tokens has no positive monetary rate`)
    }
  }
}

export function parseHistoricalPriceBookV1(input: unknown): HistoricalPriceBookV1 {
  const book = HistoricalPriceBookV1Schema.parse(input)
  const issues: string[] = []
  const byId = new Map<string, HistoricalPriceRecordV1>()
  const grouped = new Map<string, HistoricalPriceRecordV1[]>()

  for (const record of book.records) {
    if (byId.has(record.priceRecordId)) {
      issues.push(`duplicate priceRecordId ${record.priceRecordId}`)
    } else {
      byId.set(record.priceRecordId, record)
    }

    const start = timestampMs(record.validFrom.at)
    const end = record.validUntil === undefined ? undefined : timestampMs(record.validUntil)
    if (end !== undefined && end <= start) {
      issues.push(`${record.priceRecordId} validUntil must be later than validFrom`)
    }

    const rates = monetaryRates(record.rates)
    if (record.valuation.kind === 'explicit-zero' && rates.some(rate => rate !== 0)) {
      issues.push(`${record.priceRecordId} is explicit-zero but contains a positive monetary rate`)
    }
    if (record.valuation.kind === 'priced' && rates.every(rate => rate === 0)) {
      issues.push(`${record.priceRecordId} is priced but has no positive monetary rate`)
    }
    validateRateBands(record, issues)

    const key = identityKey(record)
    const records = grouped.get(key) ?? []
    records.push(record)
    grouped.set(key, records)
  }

  for (const records of grouped.values()) {
    records.sort((a, b) => timestampMs(a.validFrom.at) - timestampMs(b.validFrom.at))
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!
      const previous = records[index - 1]
      const next = records[index + 1]

      if (!previous && record.supersedes !== undefined) {
        issues.push(`${record.priceRecordId} cannot supersede another record because it is the first interval for its identity`)
      }
      if (previous && record.supersedes !== previous.priceRecordId) {
        issues.push(`${record.priceRecordId} must supersede ${previous.priceRecordId}`)
      }
      if (previous && timestampMs(previous.validFrom.at) === timestampMs(record.validFrom.at)) {
        issues.push(`${record.priceRecordId} and ${previous.priceRecordId} start at the same instant`)
      }
      if (next && record.validUntil !== undefined && timestampMs(record.validUntil) > timestampMs(next.validFrom.at)) {
        issues.push(`${record.priceRecordId} overlaps ${next.priceRecordId}`)
      }
    }
  }

  for (const record of book.records) {
    if (!record.supersedes) continue
    const predecessor = byId.get(record.supersedes)
    if (!predecessor) {
      issues.push(`${record.priceRecordId} supersedes unknown record ${record.supersedes}`)
      continue
    }
    if (identityKey(predecessor) !== identityKey(record)) {
      issues.push(`${record.priceRecordId} supersedes a record with a different pricing identity`)
    }
    if (timestampMs(predecessor.validFrom.at) >= timestampMs(record.validFrom.at)) {
      issues.push(`${record.priceRecordId} must start after the record it supersedes`)
    }
  }

  if (issues.length > 0) throw new HistoricalPriceBookValidationError(issues)
  return book
}

export function resolveHistoricalPriceRecordV1(
  bookInput: HistoricalPriceBookV1 | unknown,
  lookup: HistoricalPriceLookupV1,
): HistoricalPriceRecordV1 | undefined {
  const book = parseHistoricalPriceBookV1(bookInput)
  const at = timestampMs(IsoInstantSchema.parse(lookup.timestamp))
  const lookupIdentity = identityKey(lookup)

  return book.records
    .filter(record => identityKey(record) === lookupIdentity)
    .filter(record => {
      const start = timestampMs(record.validFrom.at)
      const end = record.validUntil === undefined ? Number.POSITIVE_INFINITY : timestampMs(record.validUntil)
      return start <= at && at < end
    })
    .sort((a, b) => timestampMs(b.validFrom.at) - timestampMs(a.validFrom.at))[0]
}

function escapeMarkdown(value: string | undefined): string {
  return (value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function trimDecimal(value: number): string {
  if (value === 0) return '0'
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

function perMillion(rate: number): string {
  return `$${trimDecimal(rate * 1_000_000)}`
}

function renderRateBands(record: HistoricalPriceRecordV1): string {
  if (!record.rateBands?.length) return '—'
  return record.rateBands.map(band => {
    const rates = band.rates
    return [
      `prompt input > ${band.when.tokens}`,
      `input ${perMillion(rates.inputPerToken)}`,
      `output ${perMillion(rates.outputPerToken)}`,
      `cache read ${perMillion(rates.cacheReadPerToken)}`,
      `cache write ${perMillion(rates.cacheWritePerToken)}`,
    ].join('; ')
  }).join('<br>')
}

export function renderHistoricalPriceBookMarkdownV1(bookInput: HistoricalPriceBookV1 | unknown): string {
  const book = parseHistoricalPriceBookV1(bookInput)
  const records = [...book.records].sort((a, b) => {
    const identity = identityKey(a).localeCompare(identityKey(b))
    return identity || timestampMs(a.validFrom.at) - timestampMs(b.validFrom.at)
  })

  const lines = [
    '# Qovrion historical price book',
    '',
    '> Generated from `src/data/pricing-history/catalog.v1.json`. Do not edit this file directly.',
    '',
    'This book records reviewed, date-effective API-equivalent model prices and explicit zero-price routes. It does not rename observed model/source labels and it does not claim that API-equivalent value equals the user\'s cash bill.',
    '',
  ]

  if (records.length === 0) {
    lines.push('No reviewed historical price records have been added yet.', '')
    return `${lines.join('\n')}\n`
  }

  lines.push(
    '| Authority | Pricing model | Route | Tier | Valid from | Valid until | Valuation | Input / 1M | Output / 1M | Cache read / 1M | Cache write / 1M | Conditional rates | Source | Record ID |',
    '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |',
  )

  for (const record of records) {
    const valuation = record.valuation.kind === 'priced'
      ? 'priced'
      : `explicit zero (${record.valuation.reason})`
    const source = `${record.source.kind}: ${record.source.reference}`
    lines.push([
      escapeMarkdown(record.pricingAuthority),
      escapeMarkdown(record.pricingModel),
      escapeMarkdown(record.route),
      escapeMarkdown(record.billingTier),
      escapeMarkdown(`${record.validFrom.at} (${record.validFrom.basis})`),
      escapeMarkdown(record.validUntil),
      escapeMarkdown(valuation),
      perMillion(record.rates.inputPerToken),
      perMillion(record.rates.outputPerToken),
      perMillion(record.rates.cacheReadPerToken),
      perMillion(record.rates.cacheWritePerToken),
      renderRateBands(record),
      escapeMarkdown(source),
      escapeMarkdown(record.priceRecordId),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }

  lines.push('')
  return `${lines.join('\n')}\n`
}
