import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'

import * as core from './daily-cache-core.js'
import { cacheMigrationCompleted, cacheMigrationMarkerPath, writeCacheMigrationMarker } from './cache-migration.js'
import { getMetroraCacheDir, getMetroraLegacyCacheDirs } from './product-paths.js'

type DailyCandidate = { parsed: { version: number; days: Record<string, unknown>[]; lastComputedDate?: string | null; savingsConfigHash?: string; tzKey?: string; complete?: boolean }; mtimeMs: number; path: string }

function isAdoptableCache(parsed: unknown): parsed is DailyCandidate['parsed'] {
  if (!parsed || typeof parsed !== 'object') return false
  const value = parsed as Partial<DailyCandidate['parsed']>
  return typeof value.version === 'number' && Array.isArray(value.days)
}

function isDailyCacheFilename(name: string): boolean {
  return name.startsWith('daily-cache') && name.includes('.json')
}

async function readDailyCandidates(dirs: readonly string[]): Promise<DailyCandidate[]> {
  const candidates: DailyCandidate[] = []
  const seenDirs = new Set<string>()
  const seenFiles = new Set<string>()
  for (const dir of dirs) {
    const dirKey = process.platform === 'win32' ? dir.toLowerCase() : dir
    if (seenDirs.has(dirKey)) continue
    seenDirs.add(dirKey)
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!isDailyCacheFilename(name)) continue
      const path = join(dir, name)
      const fileKey = process.platform === 'win32' ? path.toLowerCase() : path
      if (seenFiles.has(fileKey)) continue
      seenFiles.add(fileKey)
      try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
        if (!isAdoptableCache(parsed)) continue
        candidates.push({ parsed, mtimeMs: (await stat(path)).mtimeMs, path })
      } catch {
        // A malformed or interrupted source is ignored; other sources remain
        // eligible and the source file is never modified.
      }
    }
  }
  return candidates
}

function mergeAdoptableDailyCandidates(candidates: DailyCandidate[]): core.DailyCache {
  if (candidates.length === 0) return core.emptyCache()
  candidates.sort((a, b) => (b.parsed.version - a.parsed.version) || (b.mtimeMs - a.mtimeMs))

  let base = core.emptyCache()
  let rest = candidates
  if (candidates[0]!.parsed.version === core.DAILY_CACHE_VERSION && core.isMigratableCache(candidates[0]!.parsed)) {
    base = core.migratedFrom(candidates[0]!.parsed as Parameters<typeof core.migratedFrom>[0])
    rest = candidates.slice(1)
  }

  let days = base.days
  for (const { parsed } of rest) {
    days = core.mergeDayEntries(days, core.migrateDays(parsed.days), true)
  }
  return { ...base, version: core.DAILY_CACHE_VERSION, days }
}

function normalizeAdoptedDailyCache(cache: core.DailyCache): core.DailyCache {
  const now = new Date()
  const todayStr = core.toDateString(now)
  const yesterdayStr = core.toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const days = core.applyRetention(cache.days.filter(day => day.date < todayStr), yesterdayStr)
  let lastComputedDate = cache.lastComputedDate
  if (lastComputedDate && lastComputedDate > yesterdayStr) {
    lastComputedDate = days.length > 0 ? days[days.length - 1]!.date : null
  }
  return { ...cache, days, lastComputedDate }
}

/**
 * Import durable daily history from the previous root exactly once. The marker
 * is written only after the canonical envelope is atomically published; if the
 * process stops between those operations, the next run repeats the same merge,
 * which is safe because mergeDayEntries never adds a provider twice.
 */
export async function migrateLegacyDailyCacheRoot(): Promise<void> {
  const canonicalPath = core.dailyCachePath()
  const markerPath = cacheMigrationMarkerPath(getMetroraCacheDir(), 'daily-cache')
  if (await cacheMigrationCompleted(markerPath, canonicalPath, 'daily-cache', core.isMigratableCache)) return

  const candidates = await readDailyCandidates(getMetroraLegacyCacheDirs())
  if (candidates.length === 0) return

  let canonical: core.DailyCache | null = null
  let canonicalPresent = false
  try {
    const parsed: unknown = JSON.parse(await readFile(canonicalPath, 'utf-8'))
    if (core.isMigratableCache(parsed)) {
      canonical = core.migratedFrom(parsed)
      canonicalPresent = true
    }
  } catch {
    // A later adoption pass may still recover older canonical files below.
  }
  if (!canonical) {
    await core.adoptOlderDailyCaches()
    try {
      const parsed: unknown = JSON.parse(await readFile(canonicalPath, 'utf-8'))
      if (core.isMigratableCache(parsed)) {
        canonical = core.migratedFrom(parsed)
        canonicalPresent = true
      }
    } catch {
      // The canonical file may be absent or unavailable; start from an empty
      // envelope and publish the legacy durable baseline atomically.
    }
  }

  const legacy = mergeAdoptableDailyCandidates(candidates)
  const importedDays = core.mergeDayEntries([], legacy.days, true)
  const current = canonical ?? core.emptyCache()
  // A complete canonical cache is current accounting authority. An incomplete
  // canonical cache is only a working set, so a complete prior baseline wins on
  // overlaps while canonical-only slices still survive as carried data.
  const canonicalIsAuthoritative = canonicalPresent && current.complete === true
  const days = canonicalIsAuthoritative
    ? core.mergeDayEntries(current.days, importedDays, true)
    : core.mergeDayEntries(importedDays, current.days, true)
  const merged = normalizeAdoptedDailyCache({
    ...(canonicalPresent ? current : legacy),
    version: core.DAILY_CACHE_VERSION,
    days,
    complete: canonicalIsAuthoritative,
    lastComputedDate: canonicalPresent ? current.lastComputedDate : legacy.lastComputedDate,
  })

  try {
    await core.saveDailyCache(merged)
    await writeCacheMigrationMarker(markerPath, 'daily-cache', candidates.map(candidate => candidate.path))
  } catch {
    // Migration is best effort at startup. Atomic publication means a failed
    // write leaves the prior canonical file intact; the legacy source remains
    // available for a retry on the next launch.
  }
}
