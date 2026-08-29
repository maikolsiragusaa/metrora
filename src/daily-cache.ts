import { existsSync } from 'fs'
import { readFile, readdir, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { performance } from 'node:perf_hooks'
import { isSessionHydrationComplete } from './parser.js'
import { currentSessionSnapshotCompleteness } from './session-snapshot-completeness.js'
import type { DateRange, ProjectSummary } from './types.js'
import { aggregateProjectsIntoDays, dateKeyInTz } from './day-aggregator.js'
import { mergeDayEntriesByProviderCompleteness } from './daily-cache-merge.js'
import { mergeTimezoneRebucketedDays } from './daily-cache-tz-reconcile.js'
import * as core from './daily-cache-core.js'
import { rememberDailyCachePayloadEvidenceV1 } from './cache-generation.js'
import { hasLatestParserDiscoveryAuthority, latestParserDiscoveryGlobalComplete, latestParserDiscoveryProviderComplete } from './parser-discovery-state.js'
import { traceReconciliation } from './reconciliation-diagnostics.js'

export * from './daily-cache-core.js'

export type DailyCache = core.DailyCache & {
  watermarkTrusted?: boolean
}

function withTrust(cache: core.DailyCache, watermarkTrusted: boolean): DailyCache {
  const trustedCache = { ...cache } as DailyCache
  // Only positive trust is durable authority. Runtime callers still receive an
  // explicit false value, but false remains structurally equivalent to the
  // legacy absence of a stamp for object equality, spreads, and JSON storage.
  Object.defineProperty(trustedCache, 'watermarkTrusted', {
    configurable: true,
    enumerable: watermarkTrusted,
    value: watermarkTrusted,
    writable: true,
  })
  return trustedCache
}

async function readTrust(path: string): Promise<{ version: number; trusted: boolean } | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8')) as {
      version?: unknown
      days?: unknown
      watermarkTrusted?: unknown
    }
    if (typeof raw.version !== 'number' || !Array.isArray(raw.days)) return null
    return { version: raw.version, trusted: raw.watermarkTrusted === true }
  } catch {
    return null
  }
}

function supportsActiveTrust(version: number): boolean {
  // The immediately previous envelope is an adoptable baseline, not active
  // authority: v19 carried no durable Source Project model/category detail and
  // must re-derive surviving sources before its watermark becomes trusted again.
  return version === core.DAILY_CACHE_VERSION
}

async function readPersistedTrust(): Promise<boolean> {
  const activePath = core.dailyCachePath()
  if (existsSync(activePath)) {
    const active = await readTrust(activePath)
    if (active && supportsActiveTrust(active.version)) return active.trusted
  }

  const dir = dirname(activePath)
  const candidates: Array<{ version: number; trusted: boolean; mtimeMs: number }> = []
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.startsWith('daily-cache') || !name.includes('.json')) continue
    const path = join(dir, name)
    if (path === activePath) continue
    const parsed = await readTrust(path)
    if (!parsed) continue
    const mtimeMs = await stat(path).then(value => value.mtimeMs).catch(() => null)
    if (mtimeMs === null) continue
    candidates.push({ ...parsed, mtimeMs })
  }
  candidates.sort((left, right) => (right.version - left.version) || (right.mtimeMs - left.mtimeMs))
  const base = candidates[0]
  return base?.version === core.DAILY_CACHE_VERSION && base.trusted
}

export function emptyCache(savingsConfigHash = ''): DailyCache {
  return withTrust(core.emptyCache(savingsConfigHash), false)
}

export async function loadDailyCache(): Promise<DailyCache> {
  // Read before the core migration/adoption path sanitizes unknown fields, then
  // re-persist a trusted stamp when that path minted the active envelope.
  const watermarkTrusted = await readPersistedTrust()
  const cache = withTrust(await core.loadDailyCache(), watermarkTrusted)
  if (watermarkTrusted) {
    const active = await readTrust(core.dailyCachePath())
    if (active?.version !== core.DAILY_CACHE_VERSION || !active.trusted) {
      await core.saveDailyCache(cache).catch(() => {})
    }
  }
  try {
    const payload = await readFile(core.dailyCachePath(), 'utf-8')
    rememberDailyCachePayloadEvidenceV1(cache, payload)
  } catch {
    // The generation sidecar check below remains the publication authority.
  }
  return cache
}

export async function saveDailyCache(cache: DailyCache): Promise<void> {
  const persisted = { ...cache } as DailyCache
  if (cache.watermarkTrusted === true) {
    persisted.watermarkTrusted = true
  } else {
    delete persisted.watermarkTrusted
  }
  await core.saveDailyCache(persisted)
  rememberDailyCachePayloadEvidenceV1(cache, JSON.stringify(persisted))
}

export function addNewDays(cache: DailyCache, incoming: core.DailyEntry[], newestDate: string): DailyCache {
  return withTrust(core.addNewDays(cache, incoming, newestDate), cache.watermarkTrusted === true)
}

function applyRetention(days: core.DailyEntry[], newestDate: string): core.DailyEntry[] {
  const cutoffDate = new Date(`${newestDate}T00:00:00Z`)
  if (Number.isNaN(cutoffDate.getTime())) return days
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - core.DAILY_CACHE_RETENTION_DAYS)
  const cutoff = core.toDateString(cutoffDate)
  return days.filter(day => day.date >= cutoff)
}

function dateFromKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function hasDailyData(day: core.DailyEntry): boolean {
  return day.calls > 0 || day.cost !== 0 || day.savingsUSD !== 0 || day.sessions > 0
    || day.inputTokens > 0 || day.outputTokens > 0 || day.cacheReadTokens > 0 || day.cacheWriteTokens > 0
    || Object.keys(day.providers).length > 0
}

function mergeDegradedFreshDays(
  fresh: core.DailyEntry[],
  baseline: core.DailyEntry[],
  sessionComplete: () => boolean,
): core.DailyEntry[] {
  // The production parser records per-provider discovery outcomes even when the
  // all-provider scan is degraded. Reconcile those independently: a healthy
  // provider may advance, while an incomplete provider keeps its finalized
  // baseline and cannot authorize a destructive replacement. Test/custom
  // callers without that authority retain the older conservative merge.
  if (sessionComplete === isSessionHydrationComplete && hasLatestParserDiscoveryAuthority()) {
    return mergeDayEntriesByProviderCompleteness(fresh, baseline, latestParserDiscoveryProviderComplete)
  }
  return core.mergeDayEntries(baseline, fresh, false)
}

async function reconcileProviderDays(
  cache: DailyCache,
  parseSessions: (range: DateRange) => Promise<ProjectSummary[]>,
  aggregateDays: (projects: ProjectSummary[]) => core.DailyEntry[],
  sessionComplete: () => boolean,
  requested: Readonly<Record<string, readonly string[]>> | undefined,
  yesterdayEnd: Date,
  yesterdayStr: string,
): Promise<DailyCache> {
  if (!requested) return cache

  const requestedDays = new Map<string, Set<string>>()
  for (const [provider, days] of Object.entries(requested)) {
    for (const day of days) {
      const parsed = dateFromKey(day)
      if (!parsed || parsed.getTime() > yesterdayEnd.getTime()) continue
      const existing = requestedDays.get(provider) ?? new Set<string>()
      existing.add(day)
      requestedDays.set(provider, existing)
    }
  }
  if (requestedDays.size === 0) return cache

  const affectedDays = [...new Set([...requestedDays.values()].flatMap(days => [...days]))].sort()
  const first = dateFromKey(affectedDays[0]!)
  const last = dateFromKey(affectedDays[affectedDays.length - 1]!)
  if (!first || !last) return cache

  const fresh = aggregateDays(await parseSessions({
    start: first,
    end: new Date(last.getTime() + 24 * 60 * 60 * 1000 - 1),
  }))
  if (!sessionComplete()) return cache

  // An empty primary day is intentional: it prevents NEVER-LOSE carry-forward
  // from resurrecting a deleted journal slice when the new snapshot has no
  // calls on that date.
  const primaryDates = new Set(fresh.map(day => day.date))
  const primary = [...fresh]
  for (const day of affectedDays) {
    if (!primaryDates.has(day)) primary.push(core.emptyDailyEntry(day))
  }

  const blocked = new Set<string>()
  for (const [provider, days] of requestedDays) {
    for (const day of days) blocked.add(`${provider}\u0000${day}`)
  }
  const merged = core.mergeDayEntries(primary, cache.days, true, blocked)
    .filter(hasDailyData)

  return withTrust({
    ...cache,
    lastComputedDate: cache.lastComputedDate ?? yesterdayStr,
    days: applyRetention(merged, yesterdayStr),
  }, cache.watermarkTrusted === true)
}

async function parseIsAuthoritative(
  sessionComplete: () => boolean,
  allowDegradedSourceReconciliation = false,
): Promise<boolean> {
  if (!sessionComplete()) return false
  if (sessionComplete !== isSessionHydrationComplete) return true
  // A parser/model-identity migration is an explicit one-time re-derivation
  // from the freshly published session cache. The live source set may change
  // again while it is being checked (especially SQLite/WAL and active JSONL),
  // but rejecting this migration would leave the old model population in the
  // durable cache forever. Ordinary future hydrations keep the stricter
  // fingerprint authority below.
  if (allowDegradedSourceReconciliation) return true
  // The parser has already completed a fresh all-provider discovery and the
  // daily callback consumed that run. Re-checking every source fingerprint
  // here made a bounded date-range hydration reject itself whenever an older
  // source sat outside the backfill horizon, leaving the daily cache degraded
  // and forcing the same expensive reconciliation on every Refresh.
  const discoveryComplete = latestParserDiscoveryGlobalComplete()
  if (discoveryComplete !== undefined) return discoveryComplete
  return await currentSessionSnapshotCompleteness('all') === 'complete'
}

export async function ensureCacheHydrated(
  parseSessions: (range: DateRange) => Promise<ProjectSummary[]>,
  aggregateDays: (projects: ProjectSummary[]) => core.DailyEntry[],
  savingsConfigHash: string = '',
  sessionComplete: () => boolean = () => true,
  aggregateDaysInTz: (projects: ProjectSummary[], tz: string) => core.DailyEntry[] =
    (projects, tz) => aggregateProjectsIntoDays(projects, iso => dateKeyInTz(iso, tz)),
  options: core.CacheHydrationOptions = {},
): Promise<DailyCache> {
  const startedAt = performance.now()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayEnd = new Date(todayStart.getTime() - 1)
  const yesterdayStr = core.toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const allowDegradedSourceReconciliation = /modelIdentity=v[23](?:\u0002|$)/.test(savingsConfigHash)

  const hydrated = await core.withDailyCacheLock(async () => {
    let cache = await loadDailyCache()
    const todayStr = core.toDateString(now)
    const tzKey = core.currentTzKey()
    const tzChanged = cache.tzKey !== undefined && cache.tzKey !== tzKey
    const accountingChanged = cache.savingsConfigHash !== savingsConfigHash
    const durableHistoryAuthority = options.durableHistoryAuthority
    const historyAuthorityChanged = durableHistoryAuthority !== undefined
      && cache.durableHistoryAuthority !== durableHistoryAuthority

    cache = await reconcileProviderDays(
      cache,
      parseSessions,
      aggregateDays,
      sessionComplete,
      options.reconcileProviderDays,
      yesterdayEnd,
      yesterdayStr,
    )

    // Serialize simultaneous invalidations. First re-derive the accounting
    // authority while retaining the old timezone, then persist that intermediate
    // state. The next run sees accounting=B/tz=A and can perform the lossless
    // timezone rebucket under one accounting authority. This avoids subtracting
    // old-money from new-money while still guaranteeing finite progress.
    if (tzChanged && accountingChanged) {
      const baseline = cache.days
      const horizonDays = historyAuthorityChanged ? core.DAILY_CACHE_RETENTION_DAYS : core.BACKFILL_DAYS
      const backfillStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - horizonDays)
      let freshDays: core.DailyEntry[] = []
      if (backfillStart.getTime() <= yesterdayEnd.getTime() && cache.tzKey !== undefined) {
        const projects = await parseSessions({ start: backfillStart, end: yesterdayEnd })
        freshDays = aggregateDaysInTz(projects, cache.tzKey)
      }
      const parseWasComplete = await parseIsAuthoritative(sessionComplete, allowDegradedSourceReconciliation)
      // If the parse is partial, keep A/A completely intact and retry this same
      // first phase. In particular, do not publish a B/A intermediate state from
      // an undercounted snapshot.
      if (!parseWasComplete) return cache

      cache = withTrust({
        version: core.DAILY_CACHE_VERSION,
        savingsConfigHash,
        tzKey: cache.tzKey,
        ...(durableHistoryAuthority !== undefined
          ? { durableHistoryAuthority }
          : typeof cache.durableHistoryAuthority === 'string'
            ? { durableHistoryAuthority: cache.durableHistoryAuthority }
            : {}),
        lastComputedDate: yesterdayStr,
        days: applyRetention(core.mergeDayEntries(freshDays, baseline, true), yesterdayStr),
        complete: true,
      }, true)
      await saveDailyCache(cache)
      return cache
    }

    // On ordinary runs an accidental/current-day cache row is discarded because
    // live parsing owns today. During a timezone migration, however, a day that
    // was FINALIZED as yesterday in the old timezone can have the same date as
    // today's new-timezone label (for example a large westward offset change).
    // Dropping it here would bypass NEVER-LOSE carry semantics and permanently
    // erase sourceless history before the old/new timezone reconciliation sees
    // it. Keep the complete old baseline intact whenever tzKey changes.
    if (!tzChanged && cache.days.some(day => day.date >= todayStr)) {
      const days = cache.days.filter(day => day.date < todayStr)
      const lastComputedDate = days.length > 0 ? days[days.length - 1]!.date : null
      cache = { ...cache, days, lastComputedDate }
    }

    const newestCachedDate = cache.days.reduce<string | null>(
      (latest, day) => latest === null || day.date > latest ? day.date : latest,
      null,
    )
    if (cache.watermarkTrusted !== true && cache.lastComputedDate !== null) {
      // An unstamped watermark has no complete-parse authority. Pull it back to
      // the newest populated day; when the cache is empty there is no historical
      // coverage to trust at all, so reset it to null and open one backfill.
      const trustedBoundary = newestCachedDate === null
        ? null
        : cache.lastComputedDate > newestCachedDate
          ? newestCachedDate
          : cache.lastComputedDate
      if (trustedBoundary !== cache.lastComputedDate) {
        cache = { ...cache, lastComputedDate: trustedBoundary }
      }
    }

    if (accountingChanged || cache.complete !== true || tzChanged || historyAuthorityChanged) {
      const baseline = cache.days
      const priorWatermark = cache.lastComputedDate
      const horizonDays = historyAuthorityChanged ? core.DAILY_CACHE_RETENTION_DAYS : core.BACKFILL_DAYS
      const backfillStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - horizonDays)
      let freshDays: core.DailyEntry[] = []
      if (backfillStart.getTime() <= yesterdayEnd.getTime()) {
        freshDays = aggregateDays(await parseSessions({ start: backfillStart, end: yesterdayEnd }))
      }
      let parseWasComplete = await parseIsAuthoritative(sessionComplete, allowDegradedSourceReconciliation)
      let days: core.DailyEntry[]

      // A timezone change is not a pricing/source change: the same physical
      // usage can simply cross a local-midnight boundary. Re-aggregate a WIDE
      // copy of the same parse under the cache's old timezone and subtract that
      // evidence from carried baseline slices before the normal NEVER-LOSE
      // merge. Without this step, a rebucketed turn can survive on its old day
      // as carried history and also appear on its new day.
      if (
        parseWasComplete
        && tzChanged
        && cache.savingsConfigHash === savingsConfigHash
        && cache.tzKey !== undefined
      ) {
        const wideProjects = await parseSessions({ start: backfillStart, end: now })
        const wideParseWasComplete = await parseIsAuthoritative(sessionComplete, allowDegradedSourceReconciliation)
        if (wideParseWasComplete) {
          const freshUnderOldTimezone = aggregateDaysInTz(wideProjects, cache.tzKey)
          days = mergeTimezoneRebucketedDays(freshDays, baseline, freshUnderOldTimezone)
        } else {
          // The subtraction must never be built from a partial wide snapshot.
          // Preserve the baseline as authority and leave the cache incomplete so
          // the next run retries the migration rather than freezing a guess.
          parseWasComplete = false
          days = core.mergeDayEntries(baseline, freshDays, false)
        }
      } else {
        days = parseWasComplete
          ? core.mergeDayEntries(freshDays, baseline, true)
          : mergeDegradedFreshDays(freshDays, baseline, sessionComplete)
      }

      cache = withTrust({
        version: core.DAILY_CACHE_VERSION,
        savingsConfigHash,
        tzKey,
        ...(durableHistoryAuthority !== undefined && parseWasComplete
          ? { durableHistoryAuthority }
          : typeof cache.durableHistoryAuthority === 'string'
            ? { durableHistoryAuthority: cache.durableHistoryAuthority }
            : {}),
        lastComputedDate: parseWasComplete ? yesterdayStr : priorWatermark,
        days: applyRetention(days, yesterdayStr),
        complete: parseWasComplete,
      }, parseWasComplete)
      await saveDailyCache(cache)
      return cache
    }

    if (cache.tzKey === undefined) cache = { ...cache, tzKey }

    const gapStart = cache.lastComputedDate
      ? new Date(
          Number.parseInt(cache.lastComputedDate.slice(0, 4)),
          Number.parseInt(cache.lastComputedDate.slice(5, 7)) - 1,
          Number.parseInt(cache.lastComputedDate.slice(8, 10)) + 1,
        )
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - core.BACKFILL_DAYS)

    if (gapStart.getTime() <= yesterdayEnd.getTime()) {
      const priorWatermark = cache.lastComputedDate
      const projects = await parseSessions({ start: gapStart, end: yesterdayEnd })
      const freshDays = aggregateDays(projects)
      const parseWasComplete = await parseIsAuthoritative(sessionComplete, allowDegradedSourceReconciliation)
      if (parseWasComplete) {
        cache = addNewDays(cache, freshDays, yesterdayStr)
        cache = withTrust({ ...cache, complete: true }, true)
      } else {
        cache = withTrust({
          ...cache,
          lastComputedDate: priorWatermark,
          days: applyRetention(mergeDegradedFreshDays(freshDays, cache.days, sessionComplete), yesterdayStr),
          complete: false,
        }, false)
      }
      await saveDailyCache(cache)
    } else if (cache.complete !== true && await parseIsAuthoritative(sessionComplete, allowDegradedSourceReconciliation)) {
      cache = withTrust({ ...cache, complete: true }, true)
      await saveDailyCache(cache)
    }

    return cache
  })
  traceReconciliation('daily-cache-publication', {
    complete: hydrated.complete === true,
    watermarkTrusted: hydrated.watermarkTrusted === true,
    dayCount: hydrated.days.length,
    lastComputedDate: hydrated.lastComputedDate,
    elapsedMs: Math.round(performance.now() - startedAt),
  })
  return hydrated
}
