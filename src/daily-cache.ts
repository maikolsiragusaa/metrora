import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { isSessionHydrationComplete } from './parser.js'
import { currentSessionSnapshotCompleteness } from './session-snapshot-completeness.js'
import type { DateRange, ProjectSummary } from './types.js'
import * as core from './daily-cache-core.js'

export * from './daily-cache-core.js'

export type DailyCache = core.DailyCache & {
  watermarkTrusted?: boolean
}

function withTrust(cache: core.DailyCache, watermarkTrusted: boolean): DailyCache {
  return { ...cache, watermarkTrusted }
}

async function readPersistedTrust(): Promise<boolean> {
  const path = core.dailyCachePath()
  if (!existsSync(path)) return false
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8')) as { watermarkTrusted?: unknown }
    return raw.watermarkTrusted === true
  } catch {
    return false
  }
}

export function emptyCache(savingsConfigHash = ''): DailyCache {
  return withTrust(core.emptyCache(savingsConfigHash), false)
}

export async function loadDailyCache(): Promise<DailyCache> {
  const watermarkTrusted = await readPersistedTrust()
  return withTrust(await core.loadDailyCache(), watermarkTrusted)
}

export async function saveDailyCache(cache: DailyCache): Promise<void> {
  await core.saveDailyCache(cache)
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

async function parseIsAuthoritative(sessionComplete: () => boolean): Promise<boolean> {
  if (!sessionComplete()) return false
  if (sessionComplete !== isSessionHydrationComplete) return true
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
    if (
      cache.watermarkTrusted !== true
      && newestCachedDate !== null
      && cache.lastComputedDate !== null
      && cache.lastComputedDate > newestCachedDate
    ) {
      cache = { ...cache, lastComputedDate: newestCachedDate }
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
      const parseWasComplete = await parseIsAuthoritative(sessionComplete)
      const days = parseWasComplete
        ? core.mergeDayEntries(freshDays, baseline, true)
        : core.mergeDayEntries(baseline, freshDays, false)

      cache = {
        version: core.DAILY_CACHE_VERSION,
        savingsConfigHash,
        tzKey,
        lastComputedDate: parseWasComplete ? yesterdayStr : priorWatermark,
        days: applyRetention(days, yesterdayStr),
        complete: parseWasComplete,
        watermarkTrusted: parseWasComplete,
      }
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
      const parseWasComplete = await parseIsAuthoritative(sessionComplete)
      cache = addNewDays(cache, aggregateDays(projects), yesterdayStr)
      cache = {
        ...cache,
        lastComputedDate: parseWasComplete ? cache.lastComputedDate : priorWatermark,
        complete: parseWasComplete,
        watermarkTrusted: parseWasComplete,
      }
      await saveDailyCache(cache)
    } else if (cache.complete !== true && await parseIsAuthoritative(sessionComplete)) {
      cache = { ...cache, complete: true, watermarkTrusted: true }
      await saveDailyCache(cache)
    }

    return cache
  })
}
