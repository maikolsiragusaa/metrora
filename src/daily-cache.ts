import { existsSync } from 'fs'
import { readFile, readdir, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { isSessionHydrationComplete } from './parser.js'
import { currentSessionSnapshotCompleteness } from './session-snapshot-completeness.js'
import type { DateRange, ProjectSummary } from './types.js'
import * as core from './daily-cache-core.js'

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
  return version === core.DAILY_CACHE_VERSION || version === core.DAILY_CACHE_VERSION - 1
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
  // re-persist a trusted stamp when that path minted the active v16 envelope.
  const watermarkTrusted = await readPersistedTrust()
  const cache = withTrust(await core.loadDailyCache(), watermarkTrusted)
  if (watermarkTrusted) {
    const active = await readTrust(core.dailyCachePath())
    if (active?.version !== core.DAILY_CACHE_VERSION || !active.trusted) {
      await core.saveDailyCache(cache).catch(() => {})
    }
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
  return await currentSessionSnapshotCompleteness('all') === 'complete'
}

export async function ensureCacheHydrated(
  parseSessions: (range: DateRange) => Promise<ProjectSummary[]>,
  aggregateDays: (projects: ProjectSummary[]) => core.DailyEntry[],
  savingsConfigHash: string = '',
  sessionComplete: () => boolean = () => true,
): Promise<DailyCache> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayEnd = new Date(todayStart.getTime() - 1)
  const yesterdayStr = core.toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const allowDegradedSourceReconciliation = /modelIdentity=v[23](?:\u0002|$)/.test(savingsConfigHash)

  return core.withDailyCacheLock(async () => {
    let cache = await loadDailyCache()
    const todayStr = core.toDateString(now)

    if (cache.days.some(day => day.date >= todayStr)) {
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

    const tzKey = core.currentTzKey()
    const tzChanged = cache.tzKey !== undefined && cache.tzKey !== tzKey
    if (cache.savingsConfigHash !== savingsConfigHash || cache.complete !== true || tzChanged) {
      const baseline = cache.days
      const priorWatermark = cache.lastComputedDate
      const backfillStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - core.BACKFILL_DAYS)
      let freshDays: core.DailyEntry[] = []
      if (backfillStart.getTime() <= yesterdayEnd.getTime()) {
        freshDays = aggregateDays(await parseSessions({ start: backfillStart, end: yesterdayEnd }))
      }
      const parseWasComplete = await parseIsAuthoritative(sessionComplete, allowDegradedSourceReconciliation)
      const days = parseWasComplete
        ? core.mergeDayEntries(freshDays, baseline, true)
        : core.mergeDayEntries(baseline, freshDays, false)

      cache = withTrust({
        version: core.DAILY_CACHE_VERSION,
        savingsConfigHash,
        tzKey,
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
      const parseWasComplete = await parseIsAuthoritative(sessionComplete, allowDegradedSourceReconciliation)
      cache = addNewDays(cache, aggregateDays(projects), yesterdayStr)
      cache = withTrust({
        ...cache,
        lastComputedDate: parseWasComplete ? cache.lastComputedDate : priorWatermark,
        complete: parseWasComplete,
      }, parseWasComplete)
      await saveDailyCache(cache)
    } else if (cache.complete !== true && await parseIsAuthoritative(sessionComplete, allowDegradedSourceReconciliation)) {
      cache = withTrust({ ...cache, complete: true }, true)
      await saveDailyCache(cache)
    }

    return cache
  })
}
