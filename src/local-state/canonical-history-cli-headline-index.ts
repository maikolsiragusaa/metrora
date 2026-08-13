import { createHash } from 'node:crypto'
import * as z from 'zod/v4'

import type { CanonicalHistoryReadProjectionV1 } from './canonical-history-read-projection.js'
import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'

export const CANONICAL_HISTORY_CLI_HEADLINE_INDEX_KIND = 'metrora.canonical-history-cli-headline-index' as const
export const CANONICAL_HISTORY_CLI_HEADLINE_INDEX_VERSION = 1 as const

export type CanonicalHistoryCliHeadlineTotalsV1 = {
  cost: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type CanonicalHistoryCliHeadlineProviderTotalsV1 = Partial<CanonicalHistoryCliHeadlineTotalsV1> & {
  cost: number
  calls: number
}

export type CanonicalHistoryCliHeadlineDayV1 = {
  date: string
  bucketTimeZone: string | null
  totals: CanonicalHistoryCliHeadlineTotalsV1
  providers: Record<string, CanonicalHistoryCliHeadlineProviderTotalsV1>
  unpriced?: boolean
  unpricedProviders?: string[]
}

export type CanonicalHistoryCliHeadlineIndexV1 = {
  kind: typeof CANONICAL_HISTORY_CLI_HEADLINE_INDEX_KIND
  version: typeof CANONICAL_HISTORY_CLI_HEADLINE_INDEX_VERSION
  projectionSha256: string
  snapshotSha256: string
  sessionAuthorityGenerationSha256?: string
  dailyAuthorityGenerationSha256?: string
  sessionSourceManifestSha256?: string
  analyticsGenerationId?: string
  indexSha256: string
  timeZone: string
  dailySnapshots: CanonicalHistoryCliHeadlineDayV1[]
  activityDays: CanonicalHistoryCliHeadlineDayV1[]
}

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const TotalsSchema = z.strictObject({
  cost: z.number().finite(),
  calls: z.number().finite(),
  inputTokens: z.number().finite(),
  outputTokens: z.number().finite(),
  cacheReadTokens: z.number().finite(),
  cacheWriteTokens: z.number().finite(),
})
const ProviderTotalsSchema = z.strictObject({
  cost: z.number().finite(),
  calls: z.number().finite(),
  inputTokens: z.number().finite().optional(),
  outputTokens: z.number().finite().optional(),
  cacheReadTokens: z.number().finite().optional(),
  cacheWriteTokens: z.number().finite().optional(),
})
const DaySchema = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  bucketTimeZone: z.string().nullable(),
  totals: TotalsSchema,
  providers: z.record(z.string(), ProviderTotalsSchema),
  unpriced: z.boolean().optional(),
  unpricedProviders: z.array(z.string()).optional(),
})
const IndexWithoutDigestSchema = z.strictObject({
  kind: z.literal(CANONICAL_HISTORY_CLI_HEADLINE_INDEX_KIND),
  version: z.literal(CANONICAL_HISTORY_CLI_HEADLINE_INDEX_VERSION),
  projectionSha256: DigestSchema,
  snapshotSha256: DigestSchema,
  sessionAuthorityGenerationSha256: DigestSchema.optional(),
  dailyAuthorityGenerationSha256: DigestSchema.optional(),
  sessionSourceManifestSha256: DigestSchema.optional(),
  analyticsGenerationId: DigestSchema.optional(),
  timeZone: z.string().min(1),
  dailySnapshots: z.array(DaySchema),
  activityDays: z.array(DaySchema),
})
const IndexSchema = IndexWithoutDigestSchema.extend({ indexSha256: DigestSchema })

function digest(value: unknown): string {
  return createHash('sha256')
    .update('metrora-canonical-history-cli-headline-index-v1')
    .update('\0')
    .update(canonicalizeRfc8785(value))
    .digest('hex')
}

function withoutDigest(value: CanonicalHistoryCliHeadlineIndexV1): Omit<CanonicalHistoryCliHeadlineIndexV1, 'indexSha256'> {
  const { indexSha256: _indexSha256, ...rest } = value
  return rest
}

function emptyTotals(): CanonicalHistoryCliHeadlineTotalsV1 {
  return {
    cost: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

function addTotals(target: CanonicalHistoryCliHeadlineTotalsV1, source: {
  cost: number
  calls: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): void {
  target.cost += source.cost
  target.calls += source.calls
  target.inputTokens += source.inputTokens ?? 0
  target.outputTokens += source.outputTokens ?? 0
  target.cacheReadTokens += source.cacheReadTokens ?? 0
  target.cacheWriteTokens += source.cacheWriteTokens ?? 0
}

function providerTotals(value: {
  cost: number
  calls: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): CanonicalHistoryCliHeadlineProviderTotalsV1 {
  return {
    cost: value.cost,
    calls: value.calls,
    ...(value.inputTokens !== undefined ? { inputTokens: value.inputTokens } : {}),
    ...(value.outputTokens !== undefined ? { outputTokens: value.outputTokens } : {}),
    ...(value.cacheReadTokens !== undefined ? { cacheReadTokens: value.cacheReadTokens } : {}),
    ...(value.cacheWriteTokens !== undefined ? { cacheWriteTokens: value.cacheWriteTokens } : {}),
  }
}

function dateKeyInTimeZone(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const values = new Map(parts.map(part => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function projectionDay(day: CanonicalHistoryReadProjectionV1['dailySnapshots'][number]): CanonicalHistoryCliHeadlineDayV1 {
  const providers: Record<string, CanonicalHistoryCliHeadlineProviderTotalsV1> = {}
  for (const [provider, value] of Object.entries(day.providers)) providers[provider] = providerTotals(value)
  return {
    date: day.date,
    bucketTimeZone: day.bucketTimeZone,
    totals: {
      cost: day.cost,
      calls: day.calls,
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
      cacheReadTokens: day.cacheReadTokens,
      cacheWriteTokens: day.cacheWriteTokens,
    },
    providers,
  }
}

function activityDay(
  date: string,
  bucketTimeZone: string,
  totals: CanonicalHistoryCliHeadlineTotalsV1,
  providers: Record<string, CanonicalHistoryCliHeadlineTotalsV1>,
  unpriced: boolean,
  unpricedProviders: string[],
): CanonicalHistoryCliHeadlineDayV1 {
  return {
    date,
    bucketTimeZone,
    totals,
    providers: Object.fromEntries(
      Object.entries(providers).map(([provider, value]) => [provider, providerTotals(value)]),
    ),
    ...(unpriced ? { unpriced: true } : {}),
    ...(unpricedProviders.length > 0 ? { unpricedProviders } : {}),
  }
}

export function buildCanonicalHistoryCliHeadlineIndexV1(input: {
  projection: CanonicalHistoryReadProjectionV1
  projectionSha256: string
  snapshotSha256: string
  authorityGeneration?: {
    sessionPayloadSha256: string
    dailyPayloadSha256: string
    sourceManifestSha256: string
    analyticsGenerationId?: string
  }
}): CanonicalHistoryCliHeadlineIndexV1 {
  const timeZone = input.projection.dailySnapshots.find(day => day.bucketTimeZone)?.bucketTimeZone ?? localTimeZone()
  const observations = new Map(input.projection.observations.map(observation => [observation.observationId, observation]))
  const activityTotals = new Map<string, CanonicalHistoryCliHeadlineTotalsV1>()
  const activityProviders = new Map<string, Record<string, CanonicalHistoryCliHeadlineTotalsV1>>()
  const unpricedDates = new Set<string>()
  const unpricedProvidersByDate = new Map<string, Set<string>>()

  for (const activity of input.projection.activities) {
    const date = dateKeyInTimeZone(activity.timestamp, timeZone)
    const totals = activityTotals.get(date) ?? emptyTotals()
    const providers = activityProviders.get(date) ?? {}
    for (const observationId of activity.observationIds) {
      const observation = observations.get(observationId)
      if (!observation) continue
      if (observation.costUSD === null) {
        unpricedDates.add(date)
        const unpricedProviders = unpricedProvidersByDate.get(date) ?? new Set<string>()
        unpricedProviders.add(observation.collector)
        unpricedProvidersByDate.set(date, unpricedProviders)
        continue
      }
      const source = {
        cost: observation.costUSD,
        calls: 1,
        inputTokens: observation.usage.inputTokens,
        outputTokens: observation.usage.outputTokens,
        cacheReadTokens: observation.usage.cacheReadInputTokens,
        cacheWriteTokens: observation.usage.cacheCreationInputTokens,
      }
      addTotals(totals, source)
      const provider = providers[observation.collector] ?? emptyTotals()
      addTotals(provider, source)
      providers[observation.collector] = provider
    }
    activityTotals.set(date, totals)
    activityProviders.set(date, providers)
  }

  const activityDays = [...activityTotals.keys()].sort().map(date => activityDay(
    date,
    timeZone,
    activityTotals.get(date)!,
    activityProviders.get(date)!,
    unpricedDates.has(date),
    [...(unpricedProvidersByDate.get(date) ?? [])].sort(),
  ))
  const unsigned: Omit<CanonicalHistoryCliHeadlineIndexV1, 'indexSha256'> = {
    kind: CANONICAL_HISTORY_CLI_HEADLINE_INDEX_KIND,
    version: CANONICAL_HISTORY_CLI_HEADLINE_INDEX_VERSION,
    projectionSha256: input.projectionSha256,
    snapshotSha256: input.snapshotSha256,
    ...(input.authorityGeneration ? {
      sessionAuthorityGenerationSha256: input.authorityGeneration.sessionPayloadSha256,
      dailyAuthorityGenerationSha256: input.authorityGeneration.dailyPayloadSha256,
      sessionSourceManifestSha256: input.authorityGeneration.sourceManifestSha256,
      ...(input.authorityGeneration.analyticsGenerationId
        ? { analyticsGenerationId: input.authorityGeneration.analyticsGenerationId }
        : {}),
    } : {}),
    timeZone,
    dailySnapshots: input.projection.dailySnapshots.map(projectionDay),
    activityDays,
  }
  return {
    ...unsigned,
    indexSha256: digest(unsigned),
  }
}

export function parseCanonicalHistoryCliHeadlineIndexV1(bytes: Uint8Array): CanonicalHistoryCliHeadlineIndexV1 {
  let parsed: CanonicalHistoryCliHeadlineIndexV1
  try {
    parsed = IndexSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf-8')))
  } catch {
    throw new Error('canonical history CLI headline index is invalid')
  }
  if (digest(withoutDigest(parsed)) !== parsed.indexSha256) {
    throw new Error('canonical history CLI headline index digest does not match its contents')
  }
  return parsed
}
