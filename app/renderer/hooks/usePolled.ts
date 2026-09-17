import { useCallback, useContext, useEffect, useRef, useState } from 'react'

import { normalizeCliError } from '../lib/ipc'
import { RefreshCadenceContext } from '../lib/refreshCadence'
import { currentReportGeneration } from '../lib/reportGeneration'
import { invalidateDurableSnapshots, readDurableSnapshot, snapshotRank, writeDurableSnapshot, type ReportFreshnessRank } from '../lib/reportSnapshot'
import type { CliError } from '../lib/types'

export type Polled<T> = {
  data: T | null
  error: CliError | null
  loading: boolean
  /** True while a fresh fetch runs behind instantly-served memoized data (a
   *  provider/period switch). Sections use it for a subtle in-flight indicator. */
  switching: boolean
  /** Wall-clock timestamp for the most recent successful fetch. */
  lastSuccessAt: number | null
  /** Re-run the fetcher immediately (period/provider change, manual refresh). */
  refresh: () => void
  /** Re-run with the optional explicit-refresh fetcher. */
  refreshFresh: () => void
}

// Module-level LRU of last-good results per memoKey. A section that switches deps
// to a previously-seen key (e.g. a provider switch, or a switch-back) paints the
// cached result in the same frame while a fresh fetch runs behind it — no blank,
// no stale-freeze.
//
// The cap must comfortably hold every key live at once: the base overview/act/
// yield polls PLUS one prefetched overview per detected provider. Sized too small
// it LRU-evicts the base `overview|all` key between polls, which blanks the
// overview and re-triggers the provider prefetch every cycle (the prefetch
// storm). The App raises it via setPolledMemoMax to (detected providers + base
// keys); DEFAULT_MEMO_MAX is the floor for isolated hook/component tests.
const DEFAULT_MEMO_MAX = 8
const MEMO_MAX_CAP = 24
let memoMax = DEFAULT_MEMO_MAX
type MemoEntry = { value: unknown; at: number; generation: number; durable?: boolean }
const memoStore = new Map<string, MemoEntry>()

/** Raise (or lower) the instant-switch memo cap so warmed entries survive between
 *  polls. Clamped to [DEFAULT_MEMO_MAX, MEMO_MAX_CAP]; trims immediately if the
 *  new cap is smaller than the current contents. Called by the App as the set of
 *  detected providers grows. */
export function setPolledMemoMax(n: number): void {
  memoMax = Math.max(DEFAULT_MEMO_MAX, Math.min(MEMO_MAX_CAP, Math.floor(n)))
  while (memoStore.size > memoMax) {
    const oldest = memoStore.keys().next().value
    if (oldest === undefined) break
    memoStore.delete(oldest)
  }
}

function memoGet<T>(key: string): MemoEntry & { value: T } | undefined {
  const memory = memoStore.get(key)
  if (memory) {
    // A memo accepted under a previous report generation is never current
    // last-good once a newer canonical generation exists. Drop it so the
    // caller re-reads the canonical snapshot instead of painting stale
    // authority — then the fresh result is stamped with the new generation.
    if (memory.generation !== currentReportGeneration().n) {
      memoStore.delete(key)
      return undefined
    }
    // Touch recency.
    memoStore.delete(key)
    memoStore.set(key, memory)
    return memory as MemoEntry & { value: T }
  }
  // Restart-time read-through: a complete payload the previous run accepted
  // paints instantly, then revalidates behind the painted data — but only
  // while this renderer has not published a newer explicit generation. A
  // pre-process snapshot must never win over current authority, so the
  // promoted entry is adopted at the current generation (a later publish
  // retires it like any other memo) while keeping its `durable` marker so it
  // never stamps the refresh clock. Promoted into the bounded memory LRU so
  // the prefetcher can skip work already warmed.
  if (currentReportGeneration().n !== 0) return undefined
  const durable = readDurableSnapshot<T>(key)
  if (durable) {
    const entry: MemoEntry = { value: durable.value, at: durable.at, generation: currentReportGeneration().n, durable: true }
    memoSetEntry(key, entry)
    return entry as MemoEntry & { value: T }
  }
  return undefined
}

function memoSetEntry(key: string, entry: MemoEntry): void {
  if (memoStore.has(key)) memoStore.delete(key)
  memoStore.set(key, entry)
  while (memoStore.size > memoMax) {
    const oldest = memoStore.keys().next().value
    if (oldest === undefined) break
    memoStore.delete(oldest)
  }
}

function memoSet(key: string, value: unknown): void {
  const at = Date.now()
  // A degraded report never displaces a complete one, in memory or on disk:
  // the memo is what a scope switch paints from, so a partial cached here
  // would resurface as the answer long after the producer had converged.
  const held = memoStore.get(key)
  if (held && snapshotRank(value) < snapshotRank(held.value)) return
  memoSetEntry(key, { value, at, generation: currentReportGeneration().n })
  // Partial hydration and degraded reads are useful last-good data for the
  // current renderer, but must never become the restart-time exact answer.
  writeDurableSnapshot(key, value, at)
}

/** Test-only: clear the module-level memo between renders so cached results from
 *  one test never bleed into the next. */
export function __resetPolledMemo(): void {
  memoStore.clear()
  memoMax = DEFAULT_MEMO_MAX
}

/** Empty the instant-switch memo. Called when a Settings action mutates config
 *  that changes computed costs or currency (currency/alias/plan/price-override):
 *  a later provider/period switch must never paint a payload cached under the OLD
 *  config, which is what stuck the display on the previous currency. Durable
 *  snapshots are invalidated through the same call: the logical generation
 *  bump makes stale bodies unreadable even if their removal is interrupted. */
export function clearPolledMemo(): void {
  memoStore.clear()
  invalidateDurableSnapshots()
}

/** Seed the instant-switch memo out of band. The prefetcher (App.tsx) warms the
 *  overview result for every detected provider so a picker switch to one paints
 *  from memory in the same frame instead of waiting on a fresh CLI spawn. Keyed
 *  identically to the corresponding usePolled `memoKey`. */
export function primePolledMemo(key: string, value: unknown): void {
  memoSet(key, value)
}

/** Whether a live result is already memoized for `key` (does not affect recency).
 *  Lets the prefetcher skip providers it has already warmed. A durable hit is
 *  promoted into the bounded memory LRU. */
export function hasPolledMemo(key: string): boolean {
  return memoGet(key) !== undefined
}

/**
 * Generic CLI-backed data hook: fetches on mount + whenever `deps` change, then
 * re-polls every `intervalMs`. Errors are normalized to the CliError shape so
 * sections can branch on `error.kind`. Last-good data is retained on error.
 *
 * `intervalMs` defaults to the app-wide refresh cadence (Settings > General) via
 * context; pass one explicitly to override. `null` cadence (Manual) means no
 * setInterval — the fetcher runs only on mount, deps change, and refresh().
 *
 * `enabled` (default true) gates fetching: while false the hook stays in its
 * initial loading state and issues no CLI spawn. The app boot flow sets it false
 * on every section poll until the first overview resolves, so the one-time cold
 * cache hydration happens ONCE (via overview) instead of fanning out into a
 * parallel full-history parse per section.
 *
 * `memoKey` opts into the instant-switch memo above.
 */
export function usePolled<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts: { intervalMs?: number | null; enabled?: boolean; memoKey?: string; manualFetcher?: () => Promise<T>; onManualSuccess?: (result: T) => void; onManualError?: (error: CliError) => void } = {},
): Polled<T> {
  const cadence = useContext(RefreshCadenceContext)
  const intervalMs = opts.intervalMs !== undefined ? opts.intervalMs : cadence.intervalMs
  const enabled = opts.enabled ?? true
  const memoKey = opts.memoKey
  const [data, setData] = useState<T | null>(() => (memoKey ? memoGet<T>(memoKey)?.value ?? null : null))
  const [error, setError] = useState<CliError | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  // Rank of the report currently displayed for the active key. An incoming
  // result with a lower rank never replaces what is on screen for the same
  // key: complete displaces anything, targeted displaces degraded, degraded
  // displaces nothing — while a newer complete always replaces an older one.
  const displayRankRef = useRef<ReportFreshnessRank>(0)
  const dataKeyRef = useRef<string | null>(null)
  // Generation counter: every load() (mount, deps change, interval, refresh)
  // claims the next epoch; a fetch applies its result only while its epoch is
  // still current. This is what keeps a slow fetch from an older deps/period
  // from clobbering a newer one that already resolved.
  const epochRef = useRef(0)
  // Wall-clock of the last successful fetch, mirrored out of state so the
  // visibilitychange catch-up can read it without re-subscribing on every poll.
  const lastSuccessRef = useRef<number | null>(null)
  // Explicit reconciliation is single-flight at the hook boundary. Ordinary
  // interval/catch-up refreshes must not supersede it merely because they claim
  // a newer epoch while the heavier read is still running.
  const manualEpochRef = useRef<number | null>(null)
  const fetcherRef = useRef(fetcher)
  const manualFetcherRef = useRef(opts.manualFetcher)
  const onManualSuccessRef = useRef(opts.onManualSuccess)
  const onManualErrorRef = useRef(opts.onManualError)
  fetcherRef.current = fetcher
  manualFetcherRef.current = opts.manualFetcher
  onManualSuccessRef.current = opts.onManualSuccess
  onManualErrorRef.current = opts.onManualError

  const load = useCallback((manual = false) => {
    if (!enabled) return
    if (manualEpochRef.current !== null) return
    const epoch = ++epochRef.current
    if (manual) manualEpochRef.current = epoch
    // Instant paint: on a deps/key change, if a last-good result for the new key
    // is cached, show it immediately and flag `switching` while the fresh fetch
    // runs. If there is NO cached result for the new key, clear stale data so the
    // section paints its loading/skeleton state — never the previous filter's
    // numbers. (An interval re-poll keeps the same key, whose last result is
    // always cached, so a background refresh never blanks.)
    let servedCached = false
    let servedDurable = false
    if (memoKey) {
      const cached = memoGet<T>(memoKey)
      if (cached !== undefined) {
        setData(cached.value)
        dataKeyRef.current = memoKey
        displayRankRef.current = snapshotRank(cached.value)
        servedCached = true
        servedDurable = cached.durable === true
        // A durable entry is a snapshot from an earlier app run, not a refresh
        // this run made: paint it, but stamp no refresh time. The fetch below
        // is what sets the clock, so the footer never announces a refresh that
        // happened before this process started.
        if (!servedDurable) {
          setLastSuccessAt(cached.at)
          lastSuccessRef.current = cached.at
        }
      } else {
        setData(null)
        dataKeyRef.current = null
        displayRankRef.current = 0
      }
    }
    setLoading(true)
    setSwitching(servedCached)
    // Clear any prior error at the start of each attempt so a fresh poll never
    // shows a stale banner while it is still in flight; last-good `data` stays.
    setError(null)
    const selectedFetcher = manual ? (manualFetcherRef.current ?? fetcherRef.current) : fetcherRef.current
    selectedFetcher()
      .then(result => {
        if (epochRef.current !== epoch) return
        // A lower-rank result never regresses the live view for the same key.
        // The memo store applies the same ordering, so screen and memo agree.
        // Loading/switching still resolve in `finally` below.
        if (dataKeyRef.current === (memoKey ?? null) && snapshotRank(result) < displayRankRef.current) return
        setData(result)
        dataKeyRef.current = memoKey ?? null
        displayRankRef.current = snapshotRank(result)
        setError(null)
        const at = Date.now()
        setLastSuccessAt(at)
        lastSuccessRef.current = at
        // The manual success callback runs before memoization: for the
        // canonical Overview it publishes the new report generation, so the
        // result memoized below is stamped with the generation it established
        // instead of being orphaned as previous-generation data (which the
        // next load would drop and needlessly re-read).
        if (manual) onManualSuccessRef.current?.(result)
        if (memoKey) memoSet(memoKey, result)
      })
      .catch(err => {
        if (epochRef.current !== epoch) return
        const normalized = normalizeCliError(err)
        setError(normalized)
        if (manual) onManualErrorRef.current?.(normalized)
      })
      .finally(() => {
        if (manualEpochRef.current === epoch) manualEpochRef.current = null
        if (epochRef.current !== epoch) return
        setLoading(false)
        setSwitching(false)
      })
    // deps are intentionally the caller-provided dependency list; `enabled` and
    // `memoKey` are prepended so flipping the gate / key re-creates load and
    // fires immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, memoKey, ...deps])

  useEffect(() => {
    load()
    // Skip interval ticks while the window is hidden/minimized/occluded: a
    // backgrounded dashboard polling the CLI is pure energy waste. A visible-
    // but-unfocused window (e.g. a second monitor) reports 'visible' and keeps
    // polling. Read visibility live per tick so pausing holds even if a
    // visibilitychange event was missed.
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      load()
    }
    // Manual cadence (intervalMs == null) skips the interval entirely.
    const id = intervalMs != null ? setInterval(tick, intervalMs) : null
    // On return to visible, if the last success is older than a full cadence,
    // refresh once immediately instead of waiting up to intervalMs for the next
    // tick. Manual cadence has no catch-up (the user drives refresh).
    const onVisible = () => {
      if (intervalMs == null) return
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      const last = lastSuccessRef.current
      if (last == null || Date.now() - last >= intervalMs) load()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (id != null) clearInterval(id)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
      // Retire this generation so an in-flight fetch can't resolve into state
      // after unmount or a deps change.
      manualEpochRef.current = null
      epochRef.current++
    }
  }, [load, intervalMs])

  const refresh = useCallback(() => {
    load()
  }, [load])

  const refreshFresh = useCallback(() => {
    load(true)
  }, [load])

  return { data, error, loading, switching, lastSuccessAt, refresh, refreshFresh }
}
