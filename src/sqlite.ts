import { createRequire } from 'node:module'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { type SourceFileFingerprint } from './sqlite-source-fingerprint.js'
import { getMetroraCacheDir } from './product-paths.js'
import { cleanupSnapshotDirectory, cleanupStaleSnapshots, writeSnapshotOwner } from './sqlite-snapshot-ownership.js'
import {
  observeSource,
  resolveSourcePath,
  sameSourceProbe,
  type SourceObservation,
} from './sqlite-source-probe.js'



/// Thin SQLite read-only wrapper over Node's built-in `node:sqlite` module (stable in
/// Node 24, experimental in Node 22 / 23). Replaces the earlier `better-sqlite3` binding
/// so the dependency graph no longer pulls in the deprecated `prebuild-install` package
/// (issue #75). Works across Cursor and OpenCode session DBs, both of which we only read.

const requireForSqlite = createRequire(import.meta.url)

type Row = Record<string, unknown>

export type SqliteDatabase = {
  query<T extends Row = Row>(sql: string, params?: unknown[]): T[]
  close(): void
}

type RawDatabase = {
  prepare(sql: string): { all(...params: unknown[]): Row[] }
  exec?(sql: string): void
  close(): void
}
type DatabaseSyncCtor = new (path: string, options?: { readOnly?: boolean }) => RawDatabase

let DatabaseSync: DatabaseSyncCtor | null = null
let loadAttempted = false
let loadError: string | null = null

const textDecoder = new TextDecoder('utf-8', { fatal: false })

/// Safely decode a BLOB column (Uint8Array) to a UTF-8 string. Node's
/// node:sqlite crashes with a V8 CHECK abort when a TEXT column contains
/// invalid UTF-8 (common in Cursor chat blobs with truncated multi-byte
/// chars). By selecting those columns as `CAST(... AS BLOB)` in SQL, we
/// get a Uint8Array here and decode it in JS where bad bytes become the
/// U+FFFD replacement character instead of aborting the process.
export function blobToText(value: Uint8Array | string | null | undefined): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return textDecoder.decode(value)
}

/// Lazily imports `node:sqlite`. On Node 22/23 it emits an ExperimentalWarning the first
/// time the module is loaded; we silence that specific warning once so dashboards aren't
/// preceded by a scary stderr line every run. Any other warnings (including future
/// non-SQLite ones) are left untouched.
function loadDriver(): boolean {
  if (loadAttempted) return DatabaseSync !== null
  loadAttempted = true

  const origEmit = process.emit.bind(process)
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    process.emit = origEmit
  }

  // Node's `process.emit` signature is overloaded; we intercept the 'warning' channel
  // only and proxy everything else through unchanged. The `any` cast avoids chasing the
  // overload union which isn't worth its verbosity for a single-purpose shim.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.emit = function patchedEmit(this: NodeJS.Process, event: string, ...args: any[]): boolean {
    if (event === 'warning') {
      const warning = args[0] as { name?: string; message?: string } | undefined
      if (
        warning?.name === 'ExperimentalWarning' &&
        typeof warning.message === 'string' &&
        /SQLite/i.test(warning.message)
      ) {
        return false
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origEmit as any).call(this, event, ...args)
  } as typeof process.emit

  try {
    const mod = requireForSqlite('node:sqlite') as { DatabaseSync: DatabaseSyncCtor }
    DatabaseSync = mod.DatabaseSync
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    loadError =
      'SQLite-based providers (Cursor, OpenCode) need Node 22+ with the node:sqlite module.\n' +
      `Current Node: ${process.version}.\n` +
      'Upgrade Node (https://nodejs.org) and run metrora again.\n' +
      `(underlying error: ${message})`
    return false
  } finally {
    process.nextTick(restore)
  }
}

export function isSqliteAvailable(): boolean {
  return loadDriver()
}

export function getSqliteLoadError(): string {
  return loadError ?? 'SQLite driver not available'
}

export function isSqliteBusyError(err: unknown): boolean {
  const e = err as { code?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown } | null
  const code = typeof e?.code === 'string' ? e.code : ''
  const errcode = typeof e?.errcode === 'number' ? e.errcode : null
  const message = [
    typeof e?.message === 'string' ? e.message : '',
    typeof e?.errstr === 'string' ? e.errstr : '',
  ].join(' ')

  return (
    errcode === 5 ||
    errcode === 6 ||
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_LOCKED' ||
    /\bSQLITE_(BUSY|LOCKED)\b|database (?:is |table is )?locked/i.test(message)
  )
}

type SourceSnapshot = {
  directory: string
  databasePath: string
  ownerToken: string
}

const SNAPSHOT_DIRECTORY = 'sqlite-source-snapshots'
const SNAPSHOT_PREFIX = 'sqlite-source-read-'
const SNAPSHOT_ATTEMPTS = 3

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sameFingerprint(a: SourceFileFingerprint | null, b: SourceFileFingerprint | null): boolean {
  if (a === null || b === null) return a === b
  if (
    a.dev !== b.dev ||
    a.ino !== b.ino ||
    a.mtimeMs !== b.mtimeMs ||
    a.sizeBytes !== b.sizeBytes
  ) return false

  if (a.sqliteWal === undefined || b.sqliteWal === undefined) {
    return a.sqliteWal === b.sqliteWal
  }
  return a.sqliteWal.mtimeMs === b.sqliteWal.mtimeMs
    && a.sqliteWal.sizeBytes === b.sqliteWal.sizeBytes
}

function sameSourceObservation(a: SourceObservation, b: SourceObservation): boolean {
  return sameSourceProbe(a, b)
    && sameFingerprint(a.fingerprint, b.fingerprint)
    && a.walMode === b.walMode
}

function isWithin(parent: string, candidate: string): boolean {
  const relativePath = relative(resolve(parent), resolve(candidate))
  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith('..' + sep))
}

function pathsOverlap(a: string, b: string): boolean {
  return isWithin(a, b) || isWithin(b, a)
}

function ensureSnapshotRoot(sourcePath: string): string {
  const sourceDirectory = resolve(dirname(resolveSourcePath(sourcePath)))
  const roots = [
    join(resolve(getMetroraCacheDir()), SNAPSHOT_DIRECTORY),
    join(resolve(tmpdir()), SNAPSHOT_DIRECTORY),
  ]

  for (const root of roots) {
    if (pathsOverlap(sourceDirectory, root)) continue
    try {
      fs.mkdirSync(root, { recursive: true })
      cleanupStaleSnapshots(root, SNAPSHOT_PREFIX)
      return root
    } catch {
      // A restricted cache is not a reason to write beside the producer.
    }
  }

  throw new Error('Metrora could not create an owned SQLite snapshot directory for ' + sourcePath)
}

function createSnapshot(sourcePath: string): SourceSnapshot {
  const root = ensureSnapshotRoot(sourcePath)
  let lastFailure = 'source state was not stable'

  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt++) {
    const before = observeSource(sourcePath)
    if (before.fingerprint === null) {
      throw new Error('SQLite source disappeared before a safe snapshot could be taken: ' + sourcePath)
    }

    if (before.hasActiveJournal) {
      lastFailure = 'an active rollback journal was present before copying'
      if (attempt + 1 === SNAPSHOT_ATTEMPTS) break
      continue
    }

    let directory: string | undefined
    try {
      directory = fs.mkdtempSync(join(root, SNAPSHOT_PREFIX))
      const ownerToken = writeSnapshotOwner(directory)
      const databasePath = join(directory, 'source.sqlite')
      const walPath = databasePath + '-wal'
      const stagedDatabasePath = databasePath + '.copying'
      const stagedWalPath = walPath + '.copying'

      // Copy WAL first, then the main file. Neither name is published until
      // both copies pass the source consistency fence; SHM is never copied.
      if (before.hasLiveWal) {
        fs.copyFileSync(before.walPath, stagedWalPath)
      }
      fs.copyFileSync(before.path, stagedDatabasePath)

      const after = observeSource(sourcePath)
      if (after.fingerprint === null) {
        lastFailure = 'source disappeared while its main/WAL pair was copied'
        cleanupSnapshotDirectory(directory, SNAPSHOT_PREFIX)
        directory = undefined
        if (attempt + 1 < SNAPSHOT_ATTEMPTS) continue
        break
      }
      if (after.hasActiveJournal) {
        lastFailure = 'an active rollback journal appeared while its source was copied'
        cleanupSnapshotDirectory(directory, SNAPSHOT_PREFIX)
        directory = undefined
        if (attempt + 1 < SNAPSHOT_ATTEMPTS) continue
        break
      }
      if (!sameSourceObservation(before, after)) {
        lastFailure = 'source changed while its main/WAL pair was copied'
        cleanupSnapshotDirectory(directory, SNAPSHOT_PREFIX)
        directory = undefined
        if (attempt + 1 < SNAPSHOT_ATTEMPTS) continue
        break
      }

      // Publish the pair only after the post-copy fingerprint agrees. The
      // directory is unique to this reader, so other readers cannot collide.
      if (before.hasLiveWal) fs.renameSync(stagedWalPath, walPath)
      fs.renameSync(stagedDatabasePath, databasePath)
      return { directory, databasePath, ownerToken }
    } catch (err) {
      lastFailure = errorMessage(err)
      cleanupSnapshotDirectory(directory, SNAPSHOT_PREFIX)
      if (attempt + 1 === SNAPSHOT_ATTEMPTS) break
    }
  }

  throw new Error('SQLite source-safe snapshot failed for ' + sourcePath + ': ' + lastFailure)
}

function openRawDatabase(path: string): RawDatabase {
  if (DatabaseSync === null) throw new Error(getSqliteLoadError())
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec?.('PRAGMA busy_timeout = 1000')
  } catch {
    // Best effort. Some Node sqlite builds may not expose exec on DatabaseSync.
  }
  return db
}

function closeRawDatabase(db: RawDatabase): void {
  try { db.close() } catch { /* best effort during close */ }
}

export function openDatabase(path: string): SqliteDatabase {
  if (!loadDriver() || DatabaseSync === null) {
    throw new Error(getSqliteLoadError())
  }

  // Every synchronous reader gets one stable, Metrora-owned point-in-time
  // view. No application SELECT is ever executed against the producer path.
  const snapshot = createSnapshot(path)
  let db: RawDatabase | null = null
  try {
    db = openRawDatabase(snapshot.databasePath)
  } catch (err) {
    cleanupSnapshotDirectory(snapshot.directory, SNAPSHOT_PREFIX, snapshot.ownerToken)
    throw new Error(
      'SQLite source snapshot could not be opened: ' + errorMessage(err),
      { cause: err },
    )
  }

  let closed = false
  return {
    query<T extends Row = Row>(sql: string, params: unknown[] = []): T[] {
      if (closed || db === null) throw new Error('SQLite database is closed')
      return db.prepare(sql).all(...params) as T[]
    },
    close() {
      if (closed) return
      closed = true
      try {
        if (db !== null) closeRawDatabase(db)
      } finally {
        cleanupSnapshotDirectory(snapshot.directory, SNAPSHOT_PREFIX, snapshot.ownerToken)
        db = null
      }
    },
  }
}
