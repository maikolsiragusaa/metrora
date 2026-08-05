import type { Stats } from 'fs'
import { stat as statFileSystem } from 'fs/promises'
import { extname } from 'path'

export type SQLiteWalFingerprint = {
  mtimeMs: number
  sizeBytes: number
}

export type SourceFileFingerprint = {
  dev: number
  ino: number
  mtimeMs: number
  sizeBytes: number
  /** Present only when the SQLite WAL exists at fingerprint time. */
  sqliteWal?: SQLiteWalFingerprint
}

type StatLike = Pick<Stats, 'dev' | 'ino' | 'mtimeMs' | 'size'>
export type SourceStat = (path: string) => Promise<StatLike>

const SQLITE_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3', '.vscdb'])

function isWindowsDriveColon(path: string, index: number): boolean {
  return index === 1 && /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * Candidate real paths for a provider source.
 *
 * Providers may append virtual routing context with `#...` or `:...`. The exact
 * path is always attempted first so a real filename containing either character
 * keeps working. A Windows drive colon is never treated as a virtual separator.
 */
export function sourcePathCandidates(sourcePath: string): string[] {
  const candidates = [sourcePath]

  const hashIndex = sourcePath.indexOf('#')
  if (hashIndex > 0) candidates.push(sourcePath.slice(0, hashIndex))

  const colonIndex = sourcePath.lastIndexOf(':')
  if (colonIndex > 0 && !isWindowsDriveColon(sourcePath, colonIndex)) {
    candidates.push(sourcePath.slice(0, colonIndex))
  }

  return [...new Set(candidates)]
}

export function isSQLiteSourcePath(path: string): boolean {
  return SQLITE_EXTENSIONS.has(extname(path).toLowerCase())
}

async function safeStat(path: string, statSource: SourceStat): Promise<StatLike | null> {
  try {
    return await statSource(path)
  } catch {
    // Source discovery races ordinary file rotation/checkpoint cleanup. A path
    // disappearing between stats skips this source for the current refresh
    // instead of escalating into a provider-wide failure.
    return null
  }
}

function basicFingerprint(source: StatLike): SourceFileFingerprint {
  return {
    dev: source.dev,
    ino: source.ino,
    mtimeMs: source.mtimeMs,
    sizeBytes: source.size,
  }
}

/**
 * Fingerprint one provider source.
 *
 * Non-SQLite sources preserve the historical single-file semantics exactly.
 * SQLite sources additionally include `<db>-wal` when present: the public size
 * is the combined byte count, the public mtime is the newest relevant mtime,
 * and the WAL sub-fingerprint makes checkpoint/truncation observable even when
 * total bytes and newest mtime happen to collide. `<db>-shm` is intentionally
 * ignored because ordinary readers may mutate it.
 */
export async function fingerprintSourceFile(
  sourcePath: string,
  statSource: SourceStat = statFileSystem,
): Promise<SourceFileFingerprint | null> {
  let resolvedPath: string | null = null
  let initialMain: StatLike | null = null

  for (const candidate of sourcePathCandidates(sourcePath)) {
    const candidateStat = await safeStat(candidate, statSource)
    if (!candidateStat) continue
    resolvedPath = candidate
    initialMain = candidateStat
    break
  }

  if (!resolvedPath || !initialMain) return null
  if (!isSQLiteSourcePath(resolvedPath)) return basicFingerprint(initialMain)

  // Re-stat the main file after path resolution so disappearance/replacement
  // during virtual-suffix probing becomes an ordinary skipped-source race.
  const main = await safeStat(resolvedPath, statSource)
  if (!main) return null

  const wal = await safeStat(`${resolvedPath}-wal`, statSource)
  if (!wal) return basicFingerprint(main)

  return {
    dev: main.dev,
    ino: main.ino,
    mtimeMs: Math.max(main.mtimeMs, wal.mtimeMs),
    sizeBytes: main.size + wal.size,
    sqliteWal: {
      mtimeMs: wal.mtimeMs,
      sizeBytes: wal.size,
    },
  }
}
