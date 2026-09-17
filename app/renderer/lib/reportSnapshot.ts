import { readStorage, removeStorage, storageKey, writeStorage } from './storage'

/**
 * Bounded durable last-good report snapshots.
 *
 * The in-memory instant-switch memo loses everything on renderer restart, so a
 * reopened Desktop painted skeletons until the first CLI read resolved even
 * though the previous run had accepted a complete report seconds earlier.
 * This store persists the most recent COMPLETE accepted payload per memo key
 * in localStorage so the next launch paints instantly, then revalidates behind
 * the painted data. Persistence is entirely local and best-effort: when
 * storage is unavailable, full, or the payload is oversized, the memory memo
 * keeps working and nothing throws.
 *
 * What may be persisted (privacy audit):
 * - Only values carrying a `freshness` envelope (overview `MenubarPayload`
 *   snapshots: aggregates plus already-displayed top lists). Section detail
 *   payloads (session rows with human titles, local project paths, PR links;
 *   task/compare rows) stay memory-only and revalidate from the canonical
 *   generation when their section opens.
 * - Never credentials, secrets, or message bodies: CLI report DTOs carry none,
 *   and nothing here widens what the DTOs already expose on screen.
 *
 * Freshness ranks (from the CLI `freshness.reconciliation` marker):
 * - `complete`: a finished answer. Displaces anything for its key and is the
 *   only rank that becomes the restart-time exact answer.
 * - `targeted`: a scoped read, complete for its slice. Memo keys are
 *   scope-qualified, so it may serve its key, but it never displaces a
 *   `complete` payload for the same key.
 * - `degraded`: an unfinished answer. Never displaces a held payload in
 *   memory or on disk; never persisted.
 * - unmarked values (section payloads, test scalars): rank as `targeted` for
 *   the in-memory memo, and are never written to disk (no envelope).
 */

export const REPORT_SNAPSHOT_SCHEMA = 1
const SNAPSHOT_SUFFIX_PREFIX = 'reportSnapshot.v1.'
const SNAPSHOT_GENERATION_SUFFIX = 'reportSnapshotGeneration.v1'

/** Raw payloads above this size stay memory-only (renderer main-thread budget). */
export const MAX_SNAPSHOT_SOURCE_CHARS = 1_000_000
/** Stored envelopes above this size are refused (localStorage quota budget). */
export const MAX_SNAPSHOT_CHARS = 1_000_000
/** Bounded snapshot count; oldest-first eviction under quota pressure. */
export const MAX_STORED_SNAPSHOTS = 24

type FreshnessRank = 0 | 1 | 2

export type { FreshnessRank as ReportFreshnessRank }

/** Rank a fetched value for the complete-over-partial rule. */
export function snapshotRank(value: unknown): FreshnessRank {
  if (!value || typeof value !== 'object') return 1
  const reconciliation = (value as { freshness?: { reconciliation?: unknown } }).freshness?.reconciliation
  if (reconciliation === 'complete') return 2
  if (reconciliation === 'degraded') return 0
  return 1
}

/** Whether a value holds a freshness envelope and may therefore be persisted. */
export function isPersistableReport(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return (value as { freshness?: unknown }).freshness !== undefined
}

/** A finished answer rather than a still-converging or degraded one. */
export function isCompleteReport(value: unknown): boolean {
  return snapshotRank(value) === 2
}

function fingerprint(json: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < json.length; index++) {
    hash = Math.imul(hash ^ json.charCodeAt(index), 0x01000193)
  }
  return `${json.length}:${(hash >>> 0).toString(16)}`
}

function snapshotSuffix(key: string): string {
  return `${SNAPSHOT_SUFFIX_PREFIX}${key}`
}

/** Logical generation for atomic snapshot invalidation (see reportGeneration). */
export function durableSnapshotGeneration(): number {
  try {
    return Number(readStorage(SNAPSHOT_GENERATION_SUFFIX) ?? '0') || 0
  } catch {
    return 0
  }
}

export type DurableSnapshot<T> = { value: T; at: number }

export function readDurableSnapshot<T>(key: string): DurableSnapshot<T> | undefined {
  let raw: string | null = null
  try {
    raw = readStorage(snapshotSuffix(key))
  } catch {
    return undefined
  }
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as {
      v?: unknown
      at?: unknown
      generation?: unknown
      fingerprint?: unknown
      value?: T
    }
    if (parsed.v !== REPORT_SNAPSHOT_SCHEMA) return undefined
    if (parsed.generation !== durableSnapshotGeneration()) return undefined
    if (!Number.isFinite(parsed.at)) return undefined
    if (!Object.prototype.hasOwnProperty.call(parsed, 'value')) return undefined
    return { value: parsed.value as T, at: parsed.at as number }
  } catch {
    return undefined
  }
}

function snapshotHeader(raw: string | null): { at: number; generation?: number; fingerprint?: string } | undefined {
  if (!raw) return undefined
  const fast = /^\{"v":1,"at":(\d+),"generation":(\d+),"fingerprint":"([^"]+)"/.exec(raw)
  if (fast) return { at: Number(fast[1]), generation: Number(fast[2]), fingerprint: fast[3] }
  try {
    const parsed = JSON.parse(raw) as { at?: unknown; generation?: unknown; fingerprint?: unknown }
    return { at: Number(parsed.at) || 0, generation: typeof parsed.generation === 'number' ? parsed.generation : undefined, fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : undefined }
  } catch {
    return undefined
  }
}

function storedSnapshotSuffixes(): string[] {
  const out: string[] = []
  try {
    const storage = globalThis.localStorage
    if (!storage) return out
    for (let index = 0; index < storage.length; index++) {
      const full = storage.key(index)
      if (full?.startsWith(storageKey(SNAPSHOT_SUFFIX_PREFIX))) out.push(full.slice(storageKey('').length))
    }
  } catch {
    /* enumeration unavailable */
  }
  return out
}

function removeOldestSnapshot(exceptSuffix: string): boolean {
  const rows = storedSnapshotSuffixes()
    .filter(suffix => suffix !== exceptSuffix)
    .map(suffix => ({ suffix, at: snapshotHeader(readSnapshotRaw(suffix))?.at ?? 0 }))
    .sort((a, b) => a.at - b.at)
  const oldest = rows[0]
  if (!oldest) return false
  try {
    removeStorage(oldest.suffix)
    return true
  } catch {
    return false
  }
}

function readSnapshotRaw(suffix: string): string | null {
  try {
    return readStorage(suffix)
  } catch {
    return null
  }
}

/**
 * Best-effort durable write of a complete, persistable report. Partial or
 * degraded reports are refused; oversized or unserializable values stay
 * memory-only. Byte-identical polls keep the existing body.
 */
export function writeDurableSnapshot(key: string, value: unknown, at: number): void {
  if (!isCompleteReport(value) || !isPersistableReport(value)) return
  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch {
    return
  }
  if (json === undefined || json.length > MAX_SNAPSHOT_SOURCE_CHARS) return
  const suffix = snapshotSuffix(key)
  try {
    const print = fingerprint(json)
    const generation = durableSnapshotGeneration()
    const previous = snapshotHeader(readSnapshotRaw(suffix))
    if (previous?.generation === generation && previous.fingerprint === print) return
    const raw = JSON.stringify({ v: REPORT_SNAPSHOT_SCHEMA, at, generation, fingerprint: print, value })
    if (raw.length > MAX_SNAPSHOT_CHARS) return
    for (let attempt = 0; attempt < MAX_STORED_SNAPSHOTS; attempt++) {
      try {
        writeStorage(suffix, raw)
        break
      } catch {
        if (!removeOldestSnapshot(suffix)) return
      }
    }
    while (storedSnapshotSuffixes().length > MAX_STORED_SNAPSHOTS) {
      if (!removeOldestSnapshot(suffix)) break
    }
  } catch {
    /* persistence is best-effort */
  }
}

/**
 * Invalidate every durable snapshot: bump the logical generation (atomic —
 * stale bodies become unreadable even if removal is interrupted) and remove
 * the bodies on a best-effort basis. Called on config mutations that change
 * computed accounting, mirroring the in-memory memo clear.
 */
export function invalidateDurableSnapshots(): void {
  try {
    writeStorage(SNAPSHOT_GENERATION_SUFFIX, String(durableSnapshotGeneration() + 1))
  } catch {
    /* generation bump is best-effort */
  }
  for (const suffix of storedSnapshotSuffixes()) {
    try {
      removeStorage(suffix)
    } catch {
      /* stale bodies are already unreadable via the generation check */
    }
  }
}
