import { currentTzKey, DAILY_CACHE_VERSION, dailyCachePath, toDateString } from '../daily-cache.js'
import { CACHE_VERSION, sessionCachePath } from '../session-cache.js'
import { getDateRange } from '../cli-date.js'
import { formatCost } from '../currency.js'
import type { DateRange } from '../types.js'
import {
  readCurrentDailyCacheGenerationV1,
  readCurrentSessionCacheGenerationV1,
  readDailyCacheGenerationV1,
  readSessionCacheGenerationV1,
} from '../cache-generation.js'
import type {
  CanonicalHistoryCliHeadlineDayV1,
  CanonicalHistoryCliHeadlineIndexV1,
} from './canonical-history-cli-headline-index.js'
import { canonicalAnalyticsGenerationIdSha256V1 } from './canonical-history-identity.js'
import { readCanonicalHistoryShadowHeadlineIndexV1 } from './canonical-history-shadow-headline-index-read.js'

export const C3_CLI_STATUS_MAX_HEAD_AGE_MS = 15 * 60 * 1000

export type C3CliStatusDualReadCode =
  | 'C3_SUPPORTED_MATCH'
  | 'C3_SUPPORTED_MISMATCH'
  | 'C3_UNAVAILABLE'
  | 'C3_UNSUPPORTED_QUERY'

export type C3CliStatusHeadlineV1 = {
  cost: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type C3CliStatusDualReadReason =
  | 'missing-shadow'
  | 'invalid-shadow'
  | 'stale-head'
  | 'unsupported-projection'
  | 'invalid-query'
  | 'history-out-of-range'
  | 'timezone-reprojection'
  | 'project-filter'
  | 'incomplete-provider-slice'
  | 'unpriced-current-observation'
  | 'missing-authority-generation'
  | 'authority-generation-mismatch'
  | 'daily-authority-untrusted'

export type C3CliStatusDualReadInputV1 = {
  id: string
  range: DateRange
  provider: string
  project?: readonly string[]
  exclude?: readonly string[]
  legacy: C3CliStatusHeadlineV1
}

export type C3CliStatusReadInputV1 = Omit<C3CliStatusDualReadInputV1, 'legacy'>

export type C3CliStatusDualReadResultV1 = {
  id: string
  code: C3CliStatusDualReadCode
  reason?: C3CliStatusDualReadReason
  c3?: C3CliStatusHeadlineV1
  mismatches?: Partial<Record<keyof C3CliStatusHeadlineV1, { legacy: number; c3: number }>>
}

export type C3CliStatusDualReadOptionsV1 = {
  dataDir?: string
  now?: () => Date
  timeZone?: string
  maxHeadAgeMs?: number
  expectedGenerationId?: string
}

type CoreTotals = C3CliStatusHeadlineV1

function zeroTotals(): CoreTotals {
  return {
    cost: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

function addTotals(target: CoreTotals, source: CoreTotals): void {
  target.cost += source.cost
  target.calls += source.calls
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
}

function asTotals(value: Record<string, unknown>, label: string): CoreTotals {
  const fields = ['cost', 'calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const
  const result = zeroTotals()
  for (const field of fields) {
    const item = value[field]
    if (!finiteNumber(item)) throw new Error(`${label}.${field} is not finite`)
    result[field] = item
  }
  return result
}

function snapshotTotals(day: CanonicalHistoryCliHeadlineDayV1, provider: string): CoreTotals {
  if (!validDateKey(day.date) || typeof day.providers !== 'object' || day.providers === null) {
    throw new Error('daily snapshot is malformed')
  }
  if (provider === 'all') return asTotals(day.totals as unknown as Record<string, unknown>, `daily snapshot ${day.date}`)

  const slice = day.providers[provider]
  if (slice === undefined) return zeroTotals()
  if (!slice || typeof slice !== 'object') throw new Error('provider slice is malformed')
  const record = slice as unknown as Record<string, unknown>
  const required = ['cost', 'calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const
  if (required.some(field => !finiteNumber(record[field]))) throw new Error(`provider slice ${provider} is incomplete`)
  return asTotals(record, `provider slice ${provider}`)
}

function activityTotals(
  index: CanonicalHistoryCliHeadlineIndexV1,
  provider: string,
  date: string,
): CoreTotals {
  const day = index.activityDays.find(candidate => candidate.date === date)
  if (!day) return zeroTotals()
  if (day.unpriced && (provider === 'all' || day.unpricedProviders?.includes(provider))) {
    throw new Error('current observation has no trusted cost')
  }
  if (provider === 'all') return day.totals
  const providerTotals = day.providers[provider]
  if (!providerTotals) return zeroTotals()
  return asTotals(providerTotals as unknown as Record<string, unknown>, `activity provider slice ${provider}`)
}

function queryDates(range: DateRange): { start: string; end: string } {
  const start = toDateString(range.start)
  const end = toDateString(range.end)
  if (!validDateKey(start) || !validDateKey(end) || start > end) throw new Error('invalid query range')
  return { start, end }
}

function compareTotals(
  input: C3CliStatusDualReadInputV1,
  c3: CoreTotals,
): C3CliStatusDualReadResultV1 {
  const mismatches: C3CliStatusDualReadResultV1['mismatches'] = {}
  for (const field of ['cost', 'calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (!sameSemanticHeadlineValue(field, input.legacy[field], c3[field])) {
      mismatches[field] = { legacy: input.legacy[field], c3: c3[field] }
    }
  }
  if (Object.keys(mismatches).length > 0) {
    return { id: input.id, code: 'C3_SUPPORTED_MISMATCH', c3, mismatches }
  }
  return { id: input.id, code: 'C3_SUPPORTED_MATCH', c3 }
}

function sameSemanticHeadlineValue(
  field: keyof C3CliStatusHeadlineV1,
  legacy: number,
  c3: number,
): boolean {
  if (legacy === c3) return true
  // Costs are sums of independently ordered floating-point additions. The
  // legacy path sums daily buckets while the projection path sums immutable
  // observations. Compare the existing terminal display contract rather than
  // introducing an accounting epsilon. JSON remains legacy-owned because it
  // also exposes savings and plan fields absent from this index.
  if (field !== 'cost') return false
  return formatCost(legacy) === formatCost(c3)
}

function unavailable(input: C3CliStatusReadInputV1, reason: C3CliStatusDualReadReason): C3CliStatusDualReadResultV1 {
  return { id: input.id, code: 'C3_UNAVAILABLE', reason }
}

function unsupported(input: C3CliStatusReadInputV1, reason: C3CliStatusDualReadReason): C3CliStatusDualReadResultV1 {
  return { id: input.id, code: 'C3_UNSUPPORTED_QUERY', reason }
}

function validateInput(input: C3CliStatusReadInputV1): C3CliStatusDualReadResultV1 | undefined {
  if (input.project?.length || input.exclude?.length) return unsupported(input, 'project-filter')
  try {
    queryDates(input.range)
  } catch {
    return unsupported(input, 'invalid-query')
  }
  return undefined
}

function compareInput(
  input: C3CliStatusDualReadInputV1,
  index: CanonicalHistoryCliHeadlineIndexV1,
  now: Date,
  timeZone: string,
): C3CliStatusDualReadResultV1 {
  const evaluated = evaluateC3Input(input, index, now, timeZone)
  if (evaluated.code !== 'C3_SUPPORTED_MATCH') {
    return { id: input.id, code: evaluated.code, ...(evaluated.reason ? { reason: evaluated.reason } : {}) }
  }
  return compareTotals(input, evaluated.c3!)
}

type C3Evaluation = Pick<C3CliStatusDualReadResultV1, 'code' | 'reason' | 'c3'>

function evaluateC3Input(
  input: C3CliStatusReadInputV1,
  index: CanonicalHistoryCliHeadlineIndexV1,
  now: Date,
  timeZone: string,
): C3Evaluation {
  const invalid = validateInput(input)
  if (invalid) return { code: invalid.code, reason: invalid.reason }

  const { start, end } = queryDates(input.range)
  const currentDate = toDateString(now)
  if (end > currentDate) return { code: 'C3_UNSUPPORTED_QUERY', reason: 'history-out-of-range' }

  const selectedDays = index.dailySnapshots.filter(day => validDateKey(day.date) && day.date >= start && day.date <= end && day.date < currentDate)
  const historicalEnd = end < currentDate ? end : currentDate > start ? toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)) : ''
  const historicalSelected = historicalEnd === ''
    ? []
    : index.dailySnapshots.filter(day => validDateKey(day.date) && day.date >= start && day.date <= historicalEnd)
  const firstSnapshot = index.dailySnapshots
    .map(day => day.date)
    .filter(validDateKey)
    .sort()[0]
  if (historicalSelected.length === 0 && end < currentDate) return { code: 'C3_UNSUPPORTED_QUERY', reason: 'history-out-of-range' }
  if (firstSnapshot !== undefined && start < firstSnapshot && historicalEnd >= firstSnapshot) {
    return { code: 'C3_UNSUPPORTED_QUERY', reason: 'history-out-of-range' }
  }
  if (firstSnapshot === undefined && historicalEnd >= start) return { code: 'C3_UNSUPPORTED_QUERY', reason: 'history-out-of-range' }

  const selectedZones = new Set(selectedDays.map(day => day.bucketTimeZone))
  if ([...selectedZones].some(zone => zone !== timeZone)) return { code: 'C3_UNSUPPORTED_QUERY', reason: 'timezone-reprojection' }
  if (index.timeZone !== timeZone) return { code: 'C3_UNSUPPORTED_QUERY', reason: 'timezone-reprojection' }

  const c3 = zeroTotals()
  try {
    for (const day of selectedDays) addTotals(c3, snapshotTotals(day, input.provider))
    if (start <= currentDate && end >= currentDate) {
      addTotals(c3, activityTotals(index, input.provider, currentDate))
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('no trusted cost')) {
      return { code: 'C3_UNAVAILABLE', reason: 'unpriced-current-observation' }
    }
    if (error instanceof Error && error.message.includes('provider slice')) {
      return { code: 'C3_UNAVAILABLE', reason: 'incomplete-provider-slice' }
    }
    return { code: 'C3_UNAVAILABLE', reason: 'unsupported-projection' }
  }
  return { code: 'C3_SUPPORTED_MATCH', c3 }
}

export async function compareC3CliStatusBatchV1(
  inputs: readonly C3CliStatusDualReadInputV1[],
  options: C3CliStatusDualReadOptionsV1 = {},
): Promise<C3CliStatusDualReadResultV1[]> {
  if (inputs.length === 0) return []
  const early = inputs.map(validateInput)
  const validInputs = inputs.filter((_, index) => early[index] === undefined)
  if (validInputs.length === 0) return early.map(result => result!)

  let loaded: Awaited<ReturnType<typeof readCanonicalHistoryShadowHeadlineIndexV1>>
  try {
    loaded = await readCanonicalHistoryShadowHeadlineIndexV1({ dataDir: options.dataDir })
  } catch {
    return inputs.map((input, index) => early[index] ?? unavailable(input, 'invalid-shadow'))
  }
  if (!loaded) return inputs.map((input, index) => early[index] ?? unavailable(input, 'missing-shadow'))

  const now = options.now?.() ?? new Date()
  const updatedAt = Date.parse(loaded.head.updatedAt)
  const age = now.getTime() - updatedAt
  const maxAge = options.maxHeadAgeMs ?? C3_CLI_STATUS_MAX_HEAD_AGE_MS
  if (!Number.isFinite(updatedAt) || age < 0 || age > maxAge) {
    return inputs.map((input, index) => early[index] ?? unavailable(input, 'stale-head'))
  }

  const timeZone = options.timeZone ?? currentTzKey()
  if (options.expectedGenerationId !== undefined) {
    const authorityReason = await currentAuthorityReason(loaded.index, timeZone, options.expectedGenerationId)
    if (authorityReason) {
      return inputs.map((input, index) => early[index] ?? unavailable(input, authorityReason))
    }
  }
  return inputs.map((input, index) => early[index] ?? compareInput(input, loaded!.index, now, timeZone))
}

async function currentAuthorityReason(
  index: CanonicalHistoryCliHeadlineIndexV1,
  timeZone: string,
  expectedGenerationId?: string,
): Promise<C3CliStatusDualReadReason | undefined> {
  if (expectedGenerationId !== undefined) {
    if (index.timeZone !== timeZone) return 'daily-authority-untrusted'
    if (
      index.sessionAuthorityGenerationSha256 === undefined
      || index.dailyAuthorityGenerationSha256 === undefined
      || index.sessionSourceManifestSha256 === undefined
      || index.analyticsGenerationId === undefined
    ) return 'missing-authority-generation'
    if (
      index.analyticsGenerationId !== expectedGenerationId
      || canonicalAnalyticsGenerationIdSha256V1({
        sessionPayloadSha256: index.sessionAuthorityGenerationSha256,
        dailyPayloadSha256: index.dailyAuthorityGenerationSha256,
        sourceManifestSha256: index.sessionSourceManifestSha256,
      }) !== expectedGenerationId
    ) return 'authority-generation-mismatch'
    // The shadow/index reader has already verified the head, immutable
    // snapshot, projection digest, snapshot binding, and index digest. The
    // generation fields above bind that validated read to the exact
    // completed publication supplied by this invocation, so newer cache bytes
    // are intentionally outside this point-in-time read.
    return undefined
  }
  try {
    const [session, daily] = await Promise.all([
      readCurrentSessionCacheGenerationV1(sessionCachePath()),
      readCurrentDailyCacheGenerationV1(dailyCachePath()),
    ])
    if (!session || !daily) {
      const [sessionStamp, dailyStamp] = await Promise.all([
        readSessionCacheGenerationV1(sessionCachePath()),
        readDailyCacheGenerationV1(dailyCachePath()),
      ])
      return !sessionStamp || !dailyStamp ? 'missing-authority-generation' : 'authority-generation-mismatch'
    }
    if (session.cacheSchemaVersion !== CACHE_VERSION || daily.cacheSchemaVersion !== DAILY_CACHE_VERSION) {
      return 'authority-generation-mismatch'
    }
    if (!session.complete || !daily.complete || !daily.watermarkTrusted) return 'daily-authority-untrusted'
    if (daily.timeZone !== timeZone) return 'daily-authority-untrusted'
    if (
      index.sessionAuthorityGenerationSha256 === undefined
      || index.dailyAuthorityGenerationSha256 === undefined
      || index.sessionSourceManifestSha256 === undefined
    ) return 'missing-authority-generation'
    if (
      index.sessionAuthorityGenerationSha256 !== session.payloadSha256
      || index.dailyAuthorityGenerationSha256 !== daily.payloadSha256
      || index.sessionSourceManifestSha256 !== session.sourceManifestSha256
    ) return 'authority-generation-mismatch'
    // Close the cache-write race: a writer that published after the authority
    // check must not be authorized by the first read's old stamp. Provider
    // source bytes may advance after this generation; the next ordinary fresh
    // lifecycle decides whether that requires a refresh and publishes a new
    // generation. C3 does not run an independent discovery race here.
    const [sessionAgain, dailyAgain] = await Promise.all([
      readCurrentSessionCacheGenerationV1(sessionCachePath()),
      readCurrentDailyCacheGenerationV1(dailyCachePath()),
    ])
    if (
      !sessionAgain
      || !dailyAgain
      || sessionAgain.payloadSha256 !== session.payloadSha256
      || dailyAgain.payloadSha256 !== daily.payloadSha256
    ) return 'authority-generation-mismatch'
    return undefined
  } catch {
    return 'authority-generation-mismatch'
  }
}

/**
 * Read the bounded headline subset from C3. This is the primary-read boundary:
 * it accepts no query unless the indexed projection, exact cache generations,
 * and trusted daily authority all pass. A trusted expected generation binds
 * the read to the completed publication without rereading current cache bytes;
 * standalone reads retain current-cache validation and its write-race check.
 * Every failure is a normal legacy-fallback result.
 */
export async function readC3CliStatusBatchV1(
  inputs: readonly C3CliStatusReadInputV1[],
  options: C3CliStatusDualReadOptionsV1 = {},
): Promise<C3CliStatusDualReadResultV1[]> {
  if (inputs.length === 0) return []
  const early = inputs.map(validateInput)
  const validInputs = inputs.filter((_, index) => early[index] === undefined)
  if (validInputs.length === 0) return early.map(result => result!)

  let loaded: Awaited<ReturnType<typeof readCanonicalHistoryShadowHeadlineIndexV1>>
  try {
    loaded = await readCanonicalHistoryShadowHeadlineIndexV1({ dataDir: options.dataDir })
  } catch {
    return inputs.map((input, index) => early[index] ?? unavailable(input, 'invalid-shadow'))
  }
  if (!loaded) return inputs.map((input, index) => early[index] ?? unavailable(input, 'missing-shadow'))

  const now = options.now?.() ?? new Date()
  const updatedAt = Date.parse(loaded.head.updatedAt)
  const age = now.getTime() - updatedAt
  const maxAge = options.maxHeadAgeMs ?? C3_CLI_STATUS_MAX_HEAD_AGE_MS
  if (!Number.isFinite(updatedAt) || age < 0 || age > maxAge) {
    return inputs.map((input, index) => early[index] ?? unavailable(input, 'stale-head'))
  }

  const timeZone = options.timeZone ?? currentTzKey()
  const authorityReason = await currentAuthorityReason(loaded.index, timeZone, options.expectedGenerationId)
  if (authorityReason) {
    return inputs.map((input, index) => early[index] ?? unavailable(input, authorityReason))
  }
  return inputs.map((input, index) => {
    if (early[index]) return early[index]!
    const evaluated = evaluateC3Input(input, loaded!.index, now, timeZone)
    return {
      id: input.id,
      code: evaluated.code,
      ...(evaluated.reason ? { reason: evaluated.reason } : {}),
      ...(evaluated.c3 ? { c3: evaluated.c3 } : {}),
    }
  })
}

export async function readC3CliStatusV1(
  input: C3CliStatusReadInputV1,
  options: C3CliStatusDualReadOptionsV1 = {},
): Promise<C3CliStatusDualReadResultV1> {
  return (await readC3CliStatusBatchV1([input], options))[0]!
}

export async function compareC3CliStatusV1(
  input: C3CliStatusDualReadInputV1,
  options: C3CliStatusDualReadOptionsV1 = {},
): Promise<C3CliStatusDualReadResultV1> {
  return (await compareC3CliStatusBatchV1([input], options))[0]!
}

function reportC3CliStatusDualRead(results: readonly C3CliStatusDualReadResultV1[]): void {
  if (process.env.METRORA_VERBOSE !== '1') return
  for (const result of results) {
    if (result.code === 'C3_SUPPORTED_MATCH') continue
    const reason = result.reason ? ` (${result.reason})` : ''
    process.stderr.write(`metrora: C3 status dual-read ${result.id}: ${result.code}${reason}; legacy status remains authoritative.\n`)
  }
}

export async function observeC3CliStatusDualReadV1(
  provider: string,
  project: readonly string[],
  exclude: readonly string[],
  today: C3CliStatusHeadlineV1,
  month: C3CliStatusHeadlineV1,
  expectedGenerationId?: string,
): Promise<C3CliStatusDualReadResultV1[]> {
  try {
    const results = await compareC3CliStatusBatchV1([
      { id: 'today', range: getDateRange('today').range, provider, project, exclude, legacy: today },
      { id: 'month', range: getDateRange('month').range, provider, project, exclude, legacy: month },
    ], { expectedGenerationId })
    reportC3CliStatusDualRead(results)
    return results
  } catch {
    // A read failure must never change or interrupt the legacy status result.
    return []
  }
}
