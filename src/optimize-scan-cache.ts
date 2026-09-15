import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'

import { toDateString } from './daily-cache.js'
import { getMetroraCacheDir } from './product-paths.js'
import { isSnapshotReadMode } from './read-lifecycle.js'
import { sessionCacheFingerprint } from './session-cache-fingerprint.js'
import type { DateRange, ProjectSummary } from './types.js'
import { scanAndDetect, type OptimizeResult } from './optimize.js'

/**
 * Disk cache for the optimize findings scan, shared across CLI processes.
 *
 * `scanAndDetect` re-reads every in-range Claude transcript from disk, which is
 * acceptable for an explicit fresh reconcile but disproportionate for the
 * desktop's read-only snapshot polls: each poll is a new process, so the
 * in-process result cache never carries over. Snapshots serve the result
 * persisted by the last scan instead, validated against the session-cache file
 * fingerprint — snapshot parses never write that cache, so the fingerprint only
 * moves when a real reconcile publishes, and findings stay aligned with the
 * session-cache vintage the rest of the snapshot payload projects from.
 */

const SCAN_CACHE_FILE = 'optimize-scan-cache.json'
const MAX_ENTRIES = 20
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

type ScanCacheEntry = { fingerprint: string; ts: number; result: OptimizeResult }
type ScanCacheFile = { version: 1; entries: Record<string, ScanCacheEntry> }

/** One entry per provider|range|scope combination the desktop/CLI can request. */
export function optimizeScanCacheKey(provider: string, range: DateRange, scopeId: string): string {
  return [provider, toDateString(range.start), toDateString(range.end), scopeId].join('|')
}

/** Minimal shape gate so a corrupt or foreign file cannot inject findings. */
function sanitizeResult(value: unknown): OptimizeResult | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as OptimizeResult
  if (!Array.isArray(candidate.findings) || !Number.isFinite(candidate.healthScore)) return null
  return candidate
}

export async function loadPersistedOptimizeResult(cacheDir: string, key: string, fingerprint: string): Promise<OptimizeResult | null> {
  try {
    const parsed = JSON.parse(await readFile(join(cacheDir, SCAN_CACHE_FILE), 'utf-8')) as ScanCacheFile
    const entry = parsed?.entries?.[key]
    if (!entry || entry.fingerprint !== fingerprint) return null
    if (typeof entry.ts !== 'number' || Date.now() - entry.ts > MAX_AGE_MS) return null
    return sanitizeResult(entry.result)
  } catch {
    return null
  }
}

export async function persistOptimizeResult(cacheDir: string, key: string, fingerprint: string, result: OptimizeResult): Promise<void> {
  const entries: Record<string, ScanCacheEntry> = {}
  try {
    const parsed = JSON.parse(await readFile(join(cacheDir, SCAN_CACHE_FILE), 'utf-8')) as ScanCacheFile
    for (const [existingKey, entry] of Object.entries(parsed?.entries ?? {})) {
      if (typeof entry?.ts !== 'number' || Date.now() - entry.ts > MAX_AGE_MS) continue
      if (typeof entry?.fingerprint !== 'string' || sanitizeResult(entry.result) === null) continue
      entries[existingKey] = { fingerprint: entry.fingerprint, ts: entry.ts, result: entry.result }
    }
  } catch { /* first write or unreadable file — start fresh */ }

  // Keep the most recent entries so a long-lived install cannot grow unbounded.
  const kept = Object.entries(entries)
    .filter(([existingKey]) => existingKey !== key)
    .sort((a, b) => a[1].ts - b[1].ts)
    .slice(-(MAX_ENTRIES - 1))
  kept.push([key, { fingerprint, ts: Date.now(), result }])

  try {
    await mkdir(cacheDir, { recursive: true })
    const finalPath = join(cacheDir, SCAN_CACHE_FILE)
    const tmpPath = `${finalPath}.tmp`
    await writeFile(tmpPath, JSON.stringify({ version: 1, entries: Object.fromEntries(kept) } satisfies ScanCacheFile))
    await rename(tmpPath, finalPath)
  } catch { /* best-effort: a later scan simply re-runs */ }
}

/** Serve persisted findings only for snapshot reads; fresh reads always rescan. */
export async function resolveOptimize(
  projects: ProjectSummary[],
  range: DateRange,
  provider: string,
  scopeId: string,
  scan: typeof scanAndDetect,
): Promise<OptimizeResult> {
  const key = optimizeScanCacheKey(provider, range, scopeId)
  const fingerprint = await sessionCacheFingerprint()
  if (isSnapshotReadMode() && fingerprint) {
    const persisted = await loadPersistedOptimizeResult(getMetroraCacheDir(), key, fingerprint)
    if (persisted) return persisted
  }
  const result = await scan(projects, range, provider)
  if (fingerprint) await persistOptimizeResult(getMetroraCacheDir(), key, fingerprint, result)
  return result
}
