import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, open, readdir, readFile, rename, stat, unlink } from 'fs/promises'
import { join } from 'path'
import type { DateRange, ProjectSummary } from './types.js'
import { getMetroraCacheDir } from './product-paths.js'
import { sanitizeModels } from './daily-cache-model-detail.js'
import type { CategoryDayStats, DailyCache, DailyEntry, ModelDayStats, ProjectDayStats, ProviderDaySlice } from './daily-cache-types.js'
import { mergeDayEntries, setOwn } from './daily-cache-merge.js'
// v18: Copilot accounting changed; v17 history is adopted untrusted, re-derived where sources survive, and carried otherwise.
// Bumped to 16: historical per-call cost assignments. Surviving source days
// re-derive under immutable date-effective settlements; sourceless provider
// slices continue to carry forward losslessly from v15.
//
// v15: per-project daily rollups. Days and provider slices now carry
// a `projects` breakdown (cost/calls/savings/sessions per project) so project
// history outlives the session files, like models and categories already do.
// This bump is the first to ride the v14 carry-forward: the old cache is
// adopted losslessly and only days whose sources survive are re-derived (now
// with projects); days already sourceless keep their totals and simply have
// no project split.
//
// v14: NEVER-LOSE history. Session files are ephemeral (Claude Code
// deletes transcripts after ~30 days), so a day that can no longer be re-derived
// from sources exists ONLY in this cache. Every earlier version treated the
// cache as disposable — schema bumps, savings-config changes, timezone changes
// and incomplete-hydration retries all dropped the days and re-derived from
// whatever sources survived, silently truncating history to the source-retention
// window (five bumps between 2026-06-22 and 2026-07-16 erased everything before
// 2026-04-24 on a machine with usage since March). From v14 on, invalidation
// re-derives what it can and CARRIES FORWARD every (day, provider) slice it
// cannot, and loading a missing/unsupported cache file adopts days from every
// older daily-cache file in the cache dir instead of starting empty. Bumping
// the version now only forces re-derivation of days whose sources still exist;
// it must never again lose the rest. DailyEntry.providers slices carry a full
// per-provider breakdown (tokens, models, categories) so those carry-forwards
// stay exact across rebuilds.
//
// v13: day bucketing is now TURN-anchored (a turn's whole cost/calls
// land on the day of its user-message timestamp) to match the live headline/
// report rollup. v12 bucketed each call by its own timestamp, so a midnight-
// straddling turn split across two days and history.daily / the provider
// breakdown never reconciled to current.cost. Raising MIN_SUPPORTED_VERSION
// forces the one-time re-hydration that rebuilds history under turn bucketing.
//
// v12: CodeWhale support adds historical usage that earlier rollups
// did not contain. Both the CodeWhale branch and the kiro credit-pricing
// change (below) claimed v11 independently, so v12 is the first version that
// contains both; raising MIN_SUPPORTED_VERSION forces the one-time
// re-hydration for days finalized at either v11.
//
// v11: kiro cost accounting changed (metered credits pass through
// the session cache instead of being re-priced from estimated tokens), so
// days finalized at v10 carry token-estimated kiro costs that were off by up
// to 16× per model. Raising MIN_SUPPORTED_VERSION forces the one-time full
// re-hydration that backfills history under credit-based pricing.
//
// v10: cursor accounting changed (real composer context tokens on
// conversation-anchored records, Cursor-published composer pricing), so days
// finalized at v9 carry the old double-counted agentKv estimates and
// sonnet-proxy composer costs.
//
// v9: providers added since the v8 rollup (Grok, Hermes, ZCode) parse usage
// that older binaries skipped. v8 added local-model savings to the daily
// rollup; the `savingsConfigHash` field is invalidated separately when the
// user changes their `localModelSavings` mapping.
export const DAILY_CACHE_VERSION = 18
const MIN_SUPPORTED_VERSION = 15
// A durable source is allowed to outlive the bounded detailed session cache.
// This marker makes the first run after that contract change an explicit,
// one-time reconciliation rather than relying on the ordinary 365-day poll.
export const DURABLE_HISTORY_AUTHORITY = 'materialize-before-evict-v1'
// Version-suffixed so different binaries each own a distinct file and never
// clobber an incompatible schema. Bumping the version mints a fresh filename;
// adoptOlderDailyCaches then unions days out of every previous file (including
// the pre-versioning `daily-cache.json`, which old binaries still own and we
// never write or delete).
const DAILY_CACHE_FILENAME = `daily-cache.v${DAILY_CACHE_VERSION}.json`


export type { CategoryDayStats, DailyCache, DailyEntry, ModelDayStats, ProjectDayStats, ProviderDaySlice } from './daily-cache-types.js'
export { emptyDailyEntry } from './daily-cache-reconciliation.js'
export { mergeDayEntries } from './daily-cache-merge.js'

function getCacheDir(): string {
  return getMetroraCacheDir()
}

/** IANA name of the current local timezone (respects the TZ env var). Days are
 *  bucketed by local midnight, so this tags the cache for TZ-change invalidation. */
export function currentTzKey(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
}

function getCachePath(): string {
  return join(getCacheDir(), DAILY_CACHE_FILENAME)
}

/** Absolute path of the active (version-suffixed) daily cache file. */
export function dailyCachePath(): string {
  return getCachePath()
}

export function emptyCache(savingsConfigHash = ''): DailyCache {
  return { version: DAILY_CACHE_VERSION, savingsConfigHash, tzKey: currentTzKey(), lastComputedDate: null, days: [], complete: false }
}

export function isMigratableCache(parsed: unknown): parsed is {
  version: number
  lastComputedDate: string | null
  savingsConfigHash?: string
  tzKey?: string
  durableHistoryAuthority?: string
  days: Record<string, unknown>[]
  complete?: boolean
} {
  if (!parsed || typeof parsed !== 'object') return false
  const c = parsed as Partial<DailyCache>
  if (typeof c.version !== 'number') return false
  if (!Array.isArray(c.days)) return false
  return c.version >= MIN_SUPPORTED_VERSION && c.version <= DAILY_CACHE_VERSION
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeCategories(raw: unknown): DailyEntry['categories'] {
  if (!isRecord(raw)) return {}
  const out: DailyEntry['categories'] = {}
  for (const [name, c] of Object.entries(raw)) {
    if (name in Object.prototype || !isRecord(c)) continue
    setOwn(out, name, {
      turns: num(c.turns),
      cost: num(c.cost),
      savingsUSD: num(c.savingsUSD),
      editTurns: num(c.editTurns),
      oneShotTurns: num(c.oneShotTurns),
    })
  }
  return out
}

const OPTIONAL_SLICE_NUMERICS = ['sessions', 'inputTokens', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens', 'editTurns', 'oneShotTurns'] as const

/// Same junk-tolerance as sanitizeProjects, one level up: a foreign cache can
/// hold anything under a provider slice, and structuredClone in the merge
/// would faithfully preserve that junk into the next cache generation. Numeric
/// fields and nested maps are sanitized before the slice enters the cache.
function sanitizeProviders(raw: unknown): DailyEntry['providers'] {
  if (!isRecord(raw)) return {}
  const out: DailyEntry['providers'] = {}
  for (const [name, s] of Object.entries(raw)) {
    if (name in Object.prototype || !isRecord(s)) continue
    const slice = s
    const clean: ProviderDaySlice = { calls: num(slice.calls), cost: num(slice.cost), savingsUSD: num(slice.savingsUSD) }
    for (const key of OPTIONAL_SLICE_NUMERICS) {
      if (slice[key] !== undefined) clean[key] = num(slice[key])
    }
    if (isRecord(slice.models)) clean.models = sanitizeModels(slice.models)
    if (isRecord(slice.categories)) clean.categories = sanitizeCategories(slice.categories)
    const projects = sanitizeProjects(slice.projects).projects
    if (projects) clean.projects = projects
    setOwn(out, name, clean)
  }
  return out
}

/// Foreign or hand-edited caches can hold anything under `projects`; keep only
/// a plain record of finite numeric stats (arrays and null entries dropped) so
/// later carry merges can't crash on junk.
function sanitizeProjects(raw: unknown): { projects?: DailyEntry['projects'] } {
  if (!isRecord(raw)) return {}
  const out: NonNullable<DailyEntry['projects']> = {}
  for (const [name, p] of Object.entries(raw)) {
    if (!isRecord(p)) continue // Object.entries + setOwn safely preserve prototype-property names
    setOwn(out, name, {
      cost: num(p.cost),
      calls: num(p.calls),
      savingsUSD: num(p.savingsUSD),
      sessions: num(p.sessions),
      ...(typeof p.path === 'string' && p.path.length > 0 ? { path: p.path } : {}),
    })
  }
  return Object.keys(out).length > 0 ? { projects: out } : {}
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export function migrateDays(days: Record<string, unknown>[]): DailyEntry[] {
  return days
    .filter(d => d && typeof d === 'object' && typeof d.date === 'string' && DATE_KEY_RE.test(d.date))
    .map(d => ({
      date: d.date as string,
      cost: num(d.cost),
      savingsUSD: num(d.savingsUSD),
      calls: num(d.calls),
      sessions: num(d.sessions),
      inputTokens: num(d.inputTokens),
      outputTokens: num(d.outputTokens),
      ...(typeof d.reasoningTokens === 'number' && Number.isFinite(d.reasoningTokens)
        ? { reasoningTokens: Math.max(0, d.reasoningTokens) }
        : {}),
      cacheReadTokens: num(d.cacheReadTokens),
      cacheWriteTokens: num(d.cacheWriteTokens),
      editTurns: num(d.editTurns),
      oneShotTurns: num(d.oneShotTurns),
      models: sanitizeModels(d.models),
      categories: sanitizeCategories(d.categories),
      providers: sanitizeProviders(d.providers),
      ...(sanitizeProjects(d.projects)),
      ...(d.carried === true ? { carried: true as const } : {}),
    }))
}

export function migratedFrom(parsed: {
  version: number
  lastComputedDate: string | null
  savingsConfigHash?: string
  tzKey?: string
  durableHistoryAuthority?: string
  days: Record<string, unknown>[]
  complete?: boolean
}): DailyCache {
  return {
    version: DAILY_CACHE_VERSION,
    savingsConfigHash: parsed.savingsConfigHash ?? '',
    tzKey: parsed.tzKey,
    ...(typeof parsed.durableHistoryAuthority === 'string'
      ? { durableHistoryAuthority: parsed.durableHistoryAuthority }
      : {}),
    lastComputedDate: typeof parsed.lastComputedDate === 'string' && DATE_KEY_RE.test(parsed.lastComputedDate)
      ? parsed.lastComputedDate
      : null,
    days: migrateDays(parsed.days),
    // Older schemas carry history but are never complete-authoritative.
    complete: parsed.version === DAILY_CACHE_VERSION && parsed.complete === true,
  }
}

export async function loadDailyCache(): Promise<DailyCache> {
  const path = getCachePath()
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
      if (isMigratableCache(parsed)) {
        const migrated = migratedFrom(parsed)
        if (parsed.version < DAILY_CACHE_VERSION) await saveDailyCache(migrated).catch(() => {})
        return migrated
      }
    } catch {
      // fall through to adoption — a corrupt current file must not cost history
      // that older cache files still hold.
    }
    return adoptOlderDailyCaches()
  }
  return adoptOlderDailyCaches()
}

type AdoptableCache = {
  version: number
  lastComputedDate?: string | null
  savingsConfigHash?: string
  tzKey?: string
  durableHistoryAuthority?: string
  days: Record<string, unknown>[]
  complete?: boolean
}

function isAdoptableCache(parsed: unknown): parsed is AdoptableCache {
  if (!parsed || typeof parsed !== 'object') return false
  const c = parsed as Partial<DailyCache>
  return typeof c.version === 'number' && Array.isArray(c.days)
}

/// Versioned file absent (or unreadable): adopt days from EVERY other
/// daily-cache file in the cache dir — the legacy unversioned file, older
/// versioned files, and manual .bak copies. Files are read, never written or
/// deleted (old binaries still own theirs). A candidate at exactly our version
/// (the legacy file written by a same-version binary) is fully trusted and
/// becomes the base; every other candidate contributes per-(day, provider)
/// slices it alone still has, marked `carried`. This is what makes a schema
/// bump lossless: the new version starts from the union of everything every
/// previous version ever recorded, then re-derives what sources still support.
export async function adoptOlderDailyCaches(): Promise<DailyCache> {
  const dir = getCacheDir()
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return emptyCache()
  }
  const candidates: { parsed: AdoptableCache; mtimeMs: number }[] = []
  for (const name of names) {
    if (!name.startsWith('daily-cache') || !name.includes('.json')) continue
    if (name === DAILY_CACHE_FILENAME) continue
    // .tmp files are included deliberately: a crash between the atomic write
    // completing and the rename landing leaves the NEWEST state only in the
    // .tmp. A truncated half-write fails JSON.parse below and is skipped.
    const path = join(dir, name)
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
      if (!isAdoptableCache(parsed)) continue
      candidates.push({ parsed, mtimeMs: (await stat(path)).mtimeMs })
    } catch {
      continue
    }
  }
  if (candidates.length === 0) return emptyCache()
  // Priority: newer schema first, then most recently written. Higher priority
  // wins per (day, provider); lower priority only fills what is missing.
  candidates.sort((a, b) => (b.parsed.version - a.parsed.version) || (b.mtimeMs - a.mtimeMs))

  let base: DailyCache
  let rest = candidates
  if (candidates[0]!.parsed.version === DAILY_CACHE_VERSION && isMigratableCache(candidates[0]!.parsed)) {
    base = migratedFrom(candidates[0]!.parsed as Parameters<typeof migratedFrom>[0])
    rest = candidates.slice(1)
  } else {
    base = emptyCache()
  }
  let days = base.days
  for (const { parsed } of rest) {
    days = mergeDayEntries(days, migrateDays(parsed.days), true)
  }
  // loadDailyCache has standalone readers, so the adopted result must already
  // satisfy the cache's own invariants: no today/future entries (they would be
  // served frozen instead of recomputed live) and nothing past retention.
  const now = new Date()
  const todayStr = toDateString(now)
  const yesterdayStr = toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  days = applyRetention(days.filter(d => d.date < todayStr), yesterdayStr)
  // A trusted base can carry lastComputedDate >= today (clock skew wrote a
  // frozen today entry that the purge above just removed). Left as-is it would
  // make hydration skip the gap parse forever and the purged day would never
  // be recomputed. Clamp back to the retained data.
  let lastComputedDate = base.lastComputedDate
  if (lastComputedDate && lastComputedDate > yesterdayStr) {
    lastComputedDate = days.length > 0 ? days[days.length - 1]!.date : null
  }
  const adopted: DailyCache = {
    ...base,
    lastComputedDate,
    days,
    // An untrusted base means nothing here was derived under the current
    // accounting: leave complete unset so the next hydration re-derives every
    // day whose sources survive (the merge keeps the rest).
    complete: rest.length === candidates.length ? false : base.complete,
  }
  await saveDailyCache(adopted).catch(() => {})
  return adopted
}

export async function saveDailyCache(cache: DailyCache): Promise<void> {
  const dir = getCacheDir()
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  const finalPath = getCachePath()
  const tempPath = `${finalPath}.${randomBytes(8).toString('hex')}.tmp`
  const payload = JSON.stringify(cache)
  const handle = await open(tempPath, 'w', 0o600)
  try {
    await handle.writeFile(payload, { encoding: 'utf-8' })
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tempPath, finalPath)
  } catch (err) {
    try { await unlink(tempPath) } catch { /* ignore */ }
    throw err
  }
}

export function addNewDays(cache: DailyCache, incoming: DailyEntry[], newestDate: string): DailyCache {
  const byDate = new Map(cache.days.map(d => [d.date, d]))
  for (const day of incoming) {
    byDate.set(day.date, day)
  }
  const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  const nextLast = cache.lastComputedDate && cache.lastComputedDate > newestDate
    ? cache.lastComputedDate
    : newestDate
  return {
    version: DAILY_CACHE_VERSION,
    savingsConfigHash: cache.savingsConfigHash,
    tzKey: cache.tzKey,
    ...(typeof cache.durableHistoryAuthority === 'string'
      ? { durableHistoryAuthority: cache.durableHistoryAuthority }
      : {}),
    lastComputedDate: nextLast,
    days: applyRetention(merged, newestDate),
    complete: cache.complete,
  }
}

/// Prune entries older than the retention window so the cache file does not
/// grow unbounded over years of daily use. Anchor the cutoff on newestDate so
/// a stale or stuck clock can't accidentally evict everything. Skip the prune
/// entirely if newestDate is malformed — an invalid Date would produce a NaN
/// cutoff and `d.date >= "Invalid Date"` would silently drop every entry.
export function applyRetention(days: DailyEntry[], newestDate: string): DailyEntry[] {
  const cutoffDate = new Date(`${newestDate}T00:00:00Z`)
  if (isNaN(cutoffDate.getTime())) return days
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - DAILY_CACHE_RETENTION_DAYS)
  const cutoff = toDateString(cutoffDate)
  return days.filter(d => d.date >= cutoff)
}

export function getDaysInRange(cache: DailyCache, start: string, end: string): DailyEntry[] {
  return cache.days.filter(d => d.date >= start && d.date <= end)
}

let lockChain: Promise<unknown> = Promise.resolve()

export function withDailyCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lockChain.then(() => fn())
  lockChain = next.catch(() => undefined)
  return next
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000
export const BACKFILL_DAYS = 365
// Ten years. This cache is the ONLY durable record of carried days (their
// session files are long deleted), and the uncapped `lifetime` period reads
// from it via buildDurablePeriod, so pruning at the old 2-year mark would
// have replayed the lost-history bug in slow motion at that horizon.
// Measured envelope keeps this honest: ~2.3 MB / ~11 ms JSON parse per 730
// days of fully dense data, so even a decade of daily use stays ~11 MB and
// well under 100 ms on the polling path.
export const DAILY_CACHE_RETENTION_DAYS = 3650

export type CacheHydrationOptions = {
  /// Opt into the durable-source materialization contract. The first run with
  /// a new authority scans the full durable daily-retention horizon; subsequent
  /// runs return to BACKFILL_DAYS.
  durableHistoryAuthority?: string
  /** Replace only these provider slices on the listed dates. */
  reconcileProviderDays?: Readonly<Record<string, readonly string[]>>
}

export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export async function ensureCacheHydrated(
  parseSessions: (range: DateRange) => Promise<ProjectSummary[]>,
  aggregateDays: (projects: ProjectSummary[]) => DailyEntry[],
  /// Hash of the active `localModelSavings` config. When this changes
  /// (user re-mapped a baseline) the cached `savingsUSD` totals are no
  /// longer accurate, so we treat the cache as stale and force a full
  /// re-hydration. Pass `''` for "no savings config" to disable.
  savingsConfigHash: string = '',
  /// Whether the session parse that fed this backfill left the session cache
  /// fully hydrated. A partial (interrupted) session cache yields empty/partial
  /// older days; finalizing them would freeze that gap into the daily history.
  /// So the backfill is only marked `complete` when this returns true. Defaults
  /// to a trusting `true` for callers that don't (or can't) supply it.
  sessionComplete: () => boolean = () => true,
  options: CacheHydrationOptions = {},
): Promise<DailyCache> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayEnd = new Date(todayStart.getTime() - 1)
  const yesterdayStr = toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  return withDailyCacheLock(async () => {
    let c = await loadDailyCache()
    const durableHistoryAuthority = options.durableHistoryAuthority
    const historyAuthorityChanged = durableHistoryAuthority !== undefined
      && c.durableHistoryAuthority !== durableHistoryAuthority

    // Drop any cached entry dated today or later BEFORE anything else can
    // carry it forward. The cache only ever stores complete past days (up to
    // yesterday), so a >= today entry can only come from the clock moving
    // backward or a stale older cache; left in place it would be served frozen
    // instead of recomputed live. Yesterday and earlier stay cached.
    const todayStr = toDateString(now)
    if (c.days.some(d => d.date >= todayStr)) {
      const freshDays = c.days.filter(d => d.date < todayStr)
      const latestFresh = freshDays.length > 0 ? freshDays[freshDays.length - 1].date : null
      c = { ...c, days: freshDays, lastComputedDate: latestFresh }
    }

    // Three reasons to re-derive the whole retention window:
    //  1. Savings config changed — cached `savingsUSD` totals are stale.
    //  2. The cache was never finalized against a COMPLETE session parse (an old
    //     pre-marker cache, an adoption from older cache files, or one frozen
    //     from a partial/interrupted hydration).
    //  3. The local timezone changed — days are bucketed by local midnight, so a
    //     TZ change mis-buckets every cached day. Only invalidate when a tzKey is
    //     present and differs (a cache written before this field, or a test
    //     fixture, has none → left alone rather than force a spurious rebuild).
    //
    // Re-derive, NOT discard. Session files are ephemeral; a cached day whose
    // sources are gone exists nowhere else, so the old days stay as a baseline
    // and the fresh parse overrides per (day, provider) wherever it actually
    // produced data. What it could not re-derive is carried forward (marked
    // `carried`) with its old accounting — every wipe here before v14 turned
    // into permanently lost history.
    const tzKey = currentTzKey()
    const tzChanged = c.tzKey !== undefined && c.tzKey !== tzKey
    if (c.savingsConfigHash !== savingsConfigHash || c.complete !== true || tzChanged || historyAuthorityChanged) {
      const baseline = c.days
      const horizonDays = historyAuthorityChanged ? DAILY_CACHE_RETENTION_DAYS : BACKFILL_DAYS
      const backfillStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - horizonDays)
      let freshDays: DailyEntry[] = []
      if (backfillStart.getTime() <= yesterdayEnd.getTime()) {
        freshDays = aggregateDays(await parseSessions({ start: backfillStart, end: yesterdayEnd }))
      }
      const parseWasComplete = sessionComplete()
      // A PARTIAL parse must not overwrite finalized baseline days with
      // undercounts (if their sources die before the next complete parse, the
      // undercount would be what survives). Partial fresh data only fills days
      // and slices the baseline lacks; the next complete parse gets to win.
      const merged = parseWasComplete
        ? mergeDayEntries(freshDays, baseline, true)
        : mergeDayEntries(baseline, freshDays, false)
      c = {
        version: DAILY_CACHE_VERSION,
        savingsConfigHash,
        tzKey,
        ...(durableHistoryAuthority !== undefined && parseWasComplete
          ? { durableHistoryAuthority }
          : typeof c.durableHistoryAuthority === 'string'
            ? { durableHistoryAuthority: c.durableHistoryAuthority }
            : {}),
        lastComputedDate: yesterdayStr,
        days: applyRetention(merged, yesterdayStr),
        complete: parseWasComplete,
      }
      await saveDailyCache(c)
      return c
    }
    if (c.tzKey === undefined) {
      // First write under the tzKey scheme: tag the cache so a later TZ change is
      // detectable, without discarding the (still-valid, same-TZ) cached days.
      c = { ...c, tzKey }
    }

    const gapStart = c.lastComputedDate
      ? new Date(
          parseInt(c.lastComputedDate.slice(0, 4)),
          parseInt(c.lastComputedDate.slice(5, 7)) - 1,
          parseInt(c.lastComputedDate.slice(8, 10)) + 1
        )
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - BACKFILL_DAYS)

    if (gapStart.getTime() <= yesterdayEnd.getTime()) {
      const gapRange: DateRange = { start: gapStart, end: yesterdayEnd }
      const gapProjects = await parseSessions(gapRange)
      const gapDays = aggregateDays(gapProjects)
      c = addNewDays(c, gapDays, yesterdayStr)
      // Finalize as complete ONLY when the session parse that produced these days
      // was itself complete. If it was partial, leave `complete: false` so the
      // next launch (once the session cache is whole) re-backfills instead of
      // freezing the partial history.
      c = { ...c, complete: sessionComplete() }
      await saveDailyCache(c)
    } else if (c.complete !== true && sessionComplete()) {
      // No gap to fill (already current through yesterday) but not yet marked —
      // e.g. a brand-new machine whose only data is today. Finalize so future
      // launches don't re-backfill the whole window every time.
      c = { ...c, complete: true }
      await saveDailyCache(c)
    }
    return c
  })
}
