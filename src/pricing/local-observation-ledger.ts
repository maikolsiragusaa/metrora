import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import {
  HistoricalPriceBookV1Schema,
  HistoricalPriceRateBandV1Schema,
  HistoricalPriceRatesV1Schema,
  HistoricalPriceRecordV1Schema,
  HistoricalPriceSourceKindV1Schema,
  HistoricalPriceValuationV1Schema,
  HistoricalPriceBookValidationError,
  parseHistoricalPriceBookV1,
  type HistoricalPriceBookV1,
  type HistoricalPriceLookupV1,
  type HistoricalPriceRecordV1,
} from './history.js'
import {
  atomicWritePrivateFile,
  cleanupStaleAtomicTemps,
  ensurePrivateDirectory,
  readOptionalPrivateFile,
} from '../local-state/atomic-file.js'
import { defaultMetroraDataDir } from '../local-state/endpoint-identity.js'
import { withLocalStateLease } from '../local-state/local-state-lease.js'

export const LOCAL_PRICE_OBSERVATION_KIND = 'metrora.local-price-observation' as const

const Sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const IsoInstantSchema = z.string().datetime({ offset: true })
const OptionalIdentityPartSchema = z.string().trim().min(1).max(240).optional()

export const LocalPriceObservationInputV1Schema = z.strictObject({
  pricingAuthority: z.string().trim().min(1).max(240),
  pricingModel: z.string().trim().min(1).max(240),
  route: OptionalIdentityPartSchema,
  billingTier: OptionalIdentityPartSchema,
  rates: HistoricalPriceRatesV1Schema,
  rateBands: z.array(HistoricalPriceRateBandV1Schema).max(20).optional(),
  valuation: HistoricalPriceValuationV1Schema,
  source: z.strictObject({
    kind: HistoricalPriceSourceKindV1Schema,
    reference: z.string().trim().min(1).max(2_000),
    revision: z.string().trim().min(1).max(500).optional(),
    digest: Sha256DigestSchema,
  }),
})

export const LocalPriceObservationFileV1Schema = z.strictObject({
  kind: z.literal(LOCAL_PRICE_OBSERVATION_KIND),
  version: z.literal(1),
  recordSha256: Sha256DigestSchema,
  record: HistoricalPriceRecordV1Schema,
})

export type LocalPriceObservationInputV1 = z.infer<typeof LocalPriceObservationInputV1Schema>
export type LocalPriceObservationFileV1 = z.infer<typeof LocalPriceObservationFileV1Schema>

export type LocalPriceObservationLedgerOptions = {
  dataDir?: string
  now?: () => Date
}

export type LocalPriceObservationScanV1 = {
  records: HistoricalPriceRecordV1[]
  invalid: Array<{ file: string; reason: string }>
  catalogIssues: string[]
}

export type ResolvedHistoricalPriceV1 = {
  origin: 'reviewed-book' | 'local-observation'
  record: HistoricalPriceRecordV1
}

export class LocalPriceObservationLedgerError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid local price-observation ledger:\n- ${issues.join('\n- ')}`)
    this.name = 'LocalPriceObservationLedgerError'
    this.issues = issues
  }
}

function stableJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('pricing canonical JSON accepts only finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const keys = Object.keys(object).filter(key => object[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
  }
  throw new Error('pricing canonical JSON cannot encode this value')
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function recordDigest(record: HistoricalPriceRecordV1): string {
  return `sha256:${sha256(stableJson(record))}`
}

function recordFileName(priceRecordId: string): string {
  return `${sha256(`metrora-local-price-observation-v1\0${priceRecordId}`)}.json`
}

function ledgerPaths(dataDir: string) {
  const root = join(dataDir, 'pricing', 'v1')
  return {
    root,
    observations: join(root, 'observations'),
  }
}

export function localPriceObservationDirectoryV1(dataDir = defaultMetroraDataDir()): string {
  return ledgerPaths(dataDir).observations
}

async function prepare(paths: ReturnType<typeof ledgerPaths>): Promise<void> {
  await ensurePrivateDirectory(paths.observations)
  await cleanupStaleAtomicTemps(paths.observations)
}

function identityKey(record: Pick<HistoricalPriceRecordV1, 'pricingAuthority' | 'pricingModel' | 'route' | 'billingTier'>): string {
  return stableJson([
    record.pricingAuthority,
    record.pricingModel,
    record.route ?? null,
    record.billingTier ?? null,
  ])
}

function pricingSemantics(
  record: Pick<HistoricalPriceRecordV1, 'rates' | 'rateBands' | 'valuation'>,
): string {
  return stableJson({
    rates: record.rates,
    rateBands: record.rateBands ?? [],
    valuation: record.valuation,
  })
}

function timestampMs(value: string): number {
  return Date.parse(value)
}

function parseObservationFile(bytes: Uint8Array, expectedFile: string): HistoricalPriceRecordV1 {
  const wrapper = LocalPriceObservationFileV1Schema.parse(JSON.parse(Buffer.from(bytes).toString('utf-8')))
  const record = wrapper.record
  if (recordFileName(record.priceRecordId) !== expectedFile) {
    throw new Error('price record id does not match its observation filename')
  }
  if (wrapper.recordSha256 !== recordDigest(record)) {
    throw new Error('price observation digest does not match its immutable record')
  }
  if (record.validFrom.basis !== 'first-observed') {
    throw new Error('local price observations must use the first-observed start basis')
  }
  if (record.validFrom.at !== record.source.observedAt) {
    throw new Error('local price observation start must equal source.observedAt')
  }
  if (record.validUntil !== undefined) {
    throw new Error('local price observations cannot mutate an earlier record with validUntil')
  }
  if (record.source.digest === undefined) {
    throw new Error('local price observations require a source content digest')
  }
  return record
}

export async function scanLocalPriceObservationsV1(
  options: LocalPriceObservationLedgerOptions = {},
): Promise<LocalPriceObservationScanV1> {
  const paths = ledgerPaths(options.dataDir ?? defaultMetroraDataDir())
  await prepare(paths)
  const records: HistoricalPriceRecordV1[] = []
  const invalid: LocalPriceObservationScanV1['invalid'] = []

  const files = (await readdir(paths.observations))
    .filter(file => /^[0-9a-f]{64}\.json$/.test(file))
    .sort()

  for (const file of files) {
    try {
      const bytes = await readOptionalPrivateFile(join(paths.observations, file))
      if (!bytes) continue
      records.push(parseObservationFile(bytes, file))
    } catch (error) {
      invalid.push({ file, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  let catalogIssues: string[] = []
  try {
    parseHistoricalPriceBookV1({ schemaVersion: 1, records })
  } catch (error) {
    catalogIssues = error instanceof HistoricalPriceBookValidationError
      ? [...error.issues]
      : [error instanceof Error ? error.message : String(error)]
  }

  records.sort((a, b) => {
    const identity = identityKey(a).localeCompare(identityKey(b))
    return identity || timestampMs(a.validFrom.at) - timestampMs(b.validFrom.at)
  })
  return { records, invalid, catalogIssues }
}

export async function loadLocalPriceObservationBookV1(
  options: LocalPriceObservationLedgerOptions = {},
): Promise<HistoricalPriceBookV1> {
  const scan = await scanLocalPriceObservationsV1(options)
  const issues = [
    ...scan.invalid.map(item => `${item.file}: ${item.reason}`),
    ...scan.catalogIssues,
  ]
  if (issues.length > 0) throw new LocalPriceObservationLedgerError(issues)
  return parseHistoricalPriceBookV1({ schemaVersion: 1, records: scan.records })
}

function observationRecordId(input: LocalPriceObservationInputV1, observedAt: string): string {
  const digest = sha256(stableJson({
    pricingAuthority: input.pricingAuthority,
    pricingModel: input.pricingModel,
    route: input.route ?? null,
    billingTier: input.billingTier ?? null,
    rates: input.rates,
    rateBands: input.rateBands ?? [],
    valuation: input.valuation,
    source: input.source,
    observedAt,
  }))
  return `local-observation:${digest}`
}

export async function observeCurrentPriceV1(
  inputValue: LocalPriceObservationInputV1,
  options: LocalPriceObservationLedgerOptions = {},
): Promise<{ status: 'observed' | 'duplicate'; record: HistoricalPriceRecordV1 }> {
  const input = LocalPriceObservationInputV1Schema.parse(inputValue)
  const paths = ledgerPaths(options.dataDir ?? defaultMetroraDataDir())
  const now = options.now ?? (() => new Date())
  await prepare(paths)

  return withLocalStateLease(paths.root, async () => {
    const book = await loadLocalPriceObservationBookV1({ dataDir: options.dataDir })
    const key = identityKey(input)
    const previous = book.records
      .filter(record => identityKey(record) === key)
      .sort((a, b) => timestampMs(b.validFrom.at) - timestampMs(a.validFrom.at))[0]

    const nextSemantics = pricingSemantics(input)
    if (previous && pricingSemantics(previous) === nextSemantics) {
      return { status: 'duplicate' as const, record: previous }
    }

    const observedAt = IsoInstantSchema.parse(now().toISOString())
    if (previous && timestampMs(observedAt) <= timestampMs(previous.validFrom.at)) {
      throw new Error('a changed local price observation must occur after the prior observation')
    }

    const record = HistoricalPriceRecordV1Schema.parse({
      priceRecordId: observationRecordId(input, observedAt),
      pricingAuthority: input.pricingAuthority,
      pricingModel: input.pricingModel,
      ...(input.route !== undefined ? { route: input.route } : {}),
      ...(input.billingTier !== undefined ? { billingTier: input.billingTier } : {}),
      validFrom: { basis: 'first-observed', at: observedAt },
      rates: input.rates,
      ...(input.rateBands !== undefined ? { rateBands: input.rateBands } : {}),
      valuation: input.valuation,
      source: {
        ...input.source,
        observedAt,
      },
      ...(previous ? { supersedes: previous.priceRecordId } : {}),
    })

    const wrapper = LocalPriceObservationFileV1Schema.parse({
      kind: LOCAL_PRICE_OBSERVATION_KIND,
      version: 1,
      recordSha256: recordDigest(record),
      record,
    })
    const file = recordFileName(record.priceRecordId)
    const path = join(paths.observations, file)
    const existingBytes = await readOptionalPrivateFile(path)
    if (existingBytes) {
      const existing = parseObservationFile(existingBytes, file)
      if (stableJson(existing) === stableJson(record)) {
        return { status: 'duplicate' as const, record: existing }
      }
      throw new Error('local price observation id collision with different content')
    }

    const candidateBook = {
      schemaVersion: 1 as const,
      records: [...book.records, record],
    }
    parseHistoricalPriceBookV1(candidateBook)
    await atomicWritePrivateFile(path, JSON.stringify(wrapper))
    return { status: 'observed' as const, record }
  })
}

function activeRecords(
  book: HistoricalPriceBookV1,
  lookup: HistoricalPriceLookupV1,
): HistoricalPriceRecordV1[] {
  const at = timestampMs(IsoInstantSchema.parse(lookup.timestamp))
  const key = identityKey(lookup)
  return book.records.filter(record => {
    if (identityKey(record) !== key) return false
    const start = timestampMs(record.validFrom.at)
    const end = record.validUntil === undefined
      ? Number.POSITIVE_INFINITY
      : timestampMs(record.validUntil)
    return start <= at && at < end
  })
}

const START_BASIS_STRENGTH: Record<HistoricalPriceRecordV1['validFrom']['basis'], number> = {
  'official-effective': 3,
  'reviewed-effective': 2,
  'first-observed': 1,
}

export function resolveHistoricalPriceAcrossBooksV1(
  reviewedBookInput: HistoricalPriceBookV1 | unknown,
  localBookInput: HistoricalPriceBookV1 | unknown,
  lookup: HistoricalPriceLookupV1,
): ResolvedHistoricalPriceV1 | undefined {
  const reviewedBook = HistoricalPriceBookV1Schema.parse(parseHistoricalPriceBookV1(reviewedBookInput))
  const localBook = HistoricalPriceBookV1Schema.parse(parseHistoricalPriceBookV1(localBookInput))
  const reviewed = activeRecords(reviewedBook, lookup)
    .sort((a, b) => timestampMs(b.validFrom.at) - timestampMs(a.validFrom.at))[0]
  const local = activeRecords(localBook, lookup)
    .sort((a, b) => timestampMs(b.validFrom.at) - timestampMs(a.validFrom.at))[0]

  if (!reviewed && !local) return undefined
  if (!reviewed) return { origin: 'local-observation', record: local! }
  if (!local) return { origin: 'reviewed-book', record: reviewed }

  // Once a local first-observation is promoted into the reviewed book with the
  // same economic meaning, return the stronger reviewed provenance instead of
  // keeping a duplicate local record authoritative forever.
  if (pricingSemantics(reviewed) === pricingSemantics(local)) {
    return { origin: 'reviewed-book', record: reviewed }
  }

  const reviewedStart = timestampMs(reviewed.validFrom.at)
  const localStart = timestampMs(local.validFrom.at)
  if (reviewedStart !== localStart) {
    return localStart > reviewedStart
      ? { origin: 'local-observation', record: local }
      : { origin: 'reviewed-book', record: reviewed }
  }

  const reviewedStrength = START_BASIS_STRENGTH[reviewed.validFrom.basis]
  const localStrength = START_BASIS_STRENGTH[local.validFrom.basis]
  if (reviewedStrength !== localStrength) {
    return reviewedStrength > localStrength
      ? { origin: 'reviewed-book', record: reviewed }
      : { origin: 'local-observation', record: local }
  }
  return { origin: 'reviewed-book', record: reviewed }
}
