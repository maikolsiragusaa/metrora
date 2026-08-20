import { createRequire } from 'node:module'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fingerprintSourceFileSync, sourcePathCandidates, type SourceFileFingerprint } from './sqlite-source-fingerprint.js'
import { getMetroraCacheDir } from './product-paths.js'


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

type OpenMode = 'direct' | 'immutable' | 'snapshot'

type WalObservation = {
  dev: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  size: number
}

type SourceObservation = {
  path: string
  fingerprint: SourceFileFingerprint | null
  walPath: string
  wal: WalObservation | null
  hasLiveWal: boolean
  walMode: boolean
}

type SourceSnapshot = {
  directory: string
  databasePath: string
}

const SNAPSHOT_DIRECTORY = 'sqlite-source-snapshots'
const SNAPSHOT_PREFIX = 'sqlite-source-read-'
const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000
const SNAPSHOT_ATTEMPTS = 3

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Identify only the SQLite open failure that can be caused by a WAL reader
 * needing source-side shared-memory support. Callers still require current
 * live-WAL evidence before promoting a read to a snapshot.
 */
export function isSqliteSourceSafeReadError(err: unknown): boolean {
  const e = err as { code?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown } | null
  const code = typeof e?.code === 'string' ? e.code : ''
  const errcode = typeof e?.errcode === 'number' ? e.errcode : null
  const message = [
    typeof e?.message === 'string' ? e.message : '',
    typeof e?.errstr === 'string' ? e.errstr : '',
  ].join(' ')

  if (isSqliteBusyError(err)) return false
  return (
    errcode === 14 ||
    code === 'SQLITE_CANTOPEN' ||
    code === 'ERR_SQLITE_CANTOPEN' ||
    /\bSQLITE_CANTOPEN\b/i.test(`${code} ${message}`) ||
    /\bunable to open database file\b/i.test(message)
  )
}

function resolveSourcePath(sourcePath: string): string {
  for (const candidate of sourcePathCandidates(sourcePath)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Source discovery is allowed to race rotation and cleanup.
    }
  }
  return sourcePath
}

function readWalObservation(path: string): WalObservation | null {
  try {
    const stat = fs.statSync(path)
    return {
      dev: stat.dev,
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
    }
  } catch {
    return null
  }
}

function hasWalModeHeader(path: string): boolean {
  let handle: number | undefined
  try {
    handle = fs.openSync(path, 'r')
    const header = Buffer.alloc(20)
    const bytesRead = fs.readSync(handle, header, 0, header.length, 0)
    // SQLite's file-format read/write version bytes are both 2 in WAL mode.
    return bytesRead === header.length && header[18] === 2 && header[19] === 2
  } catch {
    return false
  } finally {
    if (handle !== undefined) {
      try { fs.closeSync(handle) } catch { /* best effort */ }
    }
  }
}

function observeSource(sourcePath: string): SourceObservation {
  const resolvedPath = resolveSourcePath(sourcePath)
  const walPath = `${resolvedPath}-wal`
  const wal = readWalObservation(walPath)
  return {
    path: resolvedPath,
    fingerprint: fingerprintSourceFileSync(sourcePath),
    walPath,
    wal,
    hasLiveWal: wal !== null && wal.size > 0,
    walMode: hasWalModeHeader(resolvedPath),
  }
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

function sameWalObservation(a: WalObservation | null, b: WalObservation | null): boolean {
  if (a === null || b === null) return a === b
  return a.dev === b.dev
    && a.ino === b.ino
    && a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs
    && a.size === b.size
}

function sameSourceObservation(a: SourceObservation, b: SourceObservation): boolean {
  return sameFingerprint(a.fingerprint, b.fingerprint)
    && sameWalObservation(a.wal, b.wal)
    && a.walMode === b.walMode
}

function isWithin(parent: string, candidate: string): boolean {
  const relativePath = relative(resolve(parent), resolve(candidate))
  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
}

function pathsOverlap(a: string, b: string): boolean {
  return isWithin(a, b) || isWithin(b, a)
}

function cleanupStaleSnapshots(root: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }

  const cutoff = Date.now() - SNAPSHOT_STALE_MS
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(SNAPSHOT_PREFIX)) continue
    const directory = join(root, entry.name)
    try {
      if (fs.statSync(directory).mtimeMs < cutoff) {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    } catch {
      // A concurrent reader or a platform file lock owns the directory.
    }
  }
}

function cleanupSnapshotDirectory(directory: string | undefined): void {
  if (!directory || !basename(directory).startsWith(SNAPSHOT_PREFIX)) return
  try {
    fs.rmSync(directory, { recursive: true, force: true })
  } catch {
    // Close remains safe if a platform briefly holds a snapshot-side handle;
    // the bounded stale cleanup handles the remaining owned directory later.
  }
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
      cleanupStaleSnapshots(root)
      return root
    } catch {
      // A restricted cache is not a reason to write beside the producer.
    }
  }

  throw new Error(`Metrora could not create an owned SQLite snapshot directory for ${sourcePath}`)
}

function createSnapshot(sourcePath: string): SourceSnapshot {
  const root = ensureSnapshotRoot(sourcePath)
  let lastFailure = 'source state was not stable'

  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt++) {
    const before = observeSource(sourcePath)
    if (before.fingerprint === null) {
      throw new Error(`SQLite source disappeared before a safe snapshot could be taken: ${sourcePath}`)
    }

    let directory: string | undefined
    try {
      directory = fs.mkdtempSync(join(root, SNAPSHOT_PREFIX))
      const databasePath = join(directory, 'source.sqlite')
      const walPath = `${databasePath}-wal`
      const stagedDatabasePath = `${databasePath}.copying`
      const stagedWalPath = `${walPath}.copying`

      // Copy WAL first, then the main file. Neither name is published until
      // both copies pass the source consistency fence; SHM is never copied.
      if (before.hasLiveWal) {
        fs.copyFileSync(before.walPath, stagedWalPath)
      }
      fs.copyFileSync(before.path, stagedDatabasePath)

      const after = observeSource(sourcePath)
      if (!sameSourceObservation(before, after)) {
        lastFailure = 'source changed while its main/WAL pair was copied'
        cleanupSnapshotDirectory(directory)
        directory = undefined
        if (attempt + 1 < SNAPSHOT_ATTEMPTS) continue
        break
      }

      // Publish the pair only after the post-copy fingerprint agrees. The
      // directory is unique to this reader, so other readers cannot collide.
      if (before.hasLiveWal) fs.renameSync(stagedWalPath, walPath)
      fs.renameSync(stagedDatabasePath, databasePath)
      return { directory, databasePath }
    } catch (err) {
      lastFailure = errorMessage(err)
      cleanupSnapshotDirectory(directory)
      if (attempt + 1 === SNAPSHOT_ATTEMPTS) break
    }
  }

  throw new Error(`SQLite source-safe snapshot failed for ${sourcePath}: ${lastFailure}`)
}

function openRawDatabase(path: string, immutable: boolean): RawDatabase {
  if (DatabaseSync === null) throw new Error(getSqliteLoadError())
  const openPath = immutable ? `${pathToFileURL(path).href}?immutable=1` : path
  const db = new DatabaseSync(openPath, { readOnly: true })
  try {
    db.exec?.('PRAGMA busy_timeout = 1000')
  } catch {
    // Best effort. Some Node sqlite builds may not expose exec on DatabaseSync.
  }
  return db
}

function closeRawDatabase(db: RawDatabase): void {
  try { db.close() } catch { /* best effort during promotion */ }
}

export function openDatabase(path: string): SqliteDatabase {
  if (!loadDriver() || DatabaseSync === null) {
    throw new Error(getSqliteLoadError())
  }

  const initial = observeSource(path)
  let db: RawDatabase | null = null
  let mode: OpenMode = 'direct'
  let snapshot: SourceSnapshot | null = null

  try {
    if (initial.hasLiveWal) {
      snapshot = createSnapshot(path)
      db = openRawDatabase(snapshot.databasePath, false)
      mode = 'snapshot'
    } else if (initial.walMode) {
      try {
        db = openRawDatabase(initial.path, true)
        mode = 'immutable'
      } catch (err) {
        if (!isSqliteSourceSafeReadError(err) || !observeSource(path).hasLiveWal) throw err
        snapshot = createSnapshot(path)
        db = openRawDatabase(snapshot.databasePath, false)
        mode = 'snapshot'
      }
    } else {
      try {
        db = openRawDatabase(initial.path, false)
      } catch (err) {
        if (!isSqliteSourceSafeReadError(err) || !observeSource(path).hasLiveWal) throw err
        snapshot = createSnapshot(path)
        db = openRawDatabase(snapshot.databasePath, false)
        mode = 'snapshot'
      }
    }
  } catch (err) {
    cleanupSnapshotDirectory(snapshot?.directory)
    throw err
  }

  if (db === null) {
    cleanupSnapshotDirectory(snapshot?.directory)
    throw new Error(`SQLite database could not be opened: ${path}`)
  }

  let fallbackAttempted = mode === 'snapshot'
  let closed = false

  const promoteToSnapshot = (allowNoWalEvidence: boolean): boolean => {
    if (mode === 'snapshot') return true
    if (fallbackAttempted) return false
    fallbackAttempted = true

    const current = observeSource(path)
    if (!current.hasLiveWal && !(allowNoWalEvidence && current.fingerprint !== null)) {
      return false
    }

    const previous = db!
    closeRawDatabase(previous)
    let nextSnapshot: SourceSnapshot | null = null
    try {
      nextSnapshot = createSnapshot(path)
      const nextDb = openRawDatabase(nextSnapshot.databasePath, false)
      db = nextDb
      snapshot = nextSnapshot
      mode = 'snapshot'
      return true
    } catch (err) {
      cleanupSnapshotDirectory(nextSnapshot?.directory)
      throw new Error(`SQLite source could not be read without source-side support files: ${path}. ${errorMessage(err)}`, { cause: err })
    }
  }

  const execute = <T extends Row>(sql: string, params: unknown[]): T[] => {
    return db!.prepare(sql).all(...params) as T[]
  }

  return {
    query<T extends Row = Row>(sql: string, params: unknown[] = []): T[] {
      if (closed) throw new Error('SQLite database is closed')

      const beforeQuery = mode === 'immutable' ? observeSource(path) : null
      if (mode !== 'snapshot') {
        const current = observeSource(path)
        if (current.hasLiveWal) promoteToSnapshot(false)
        else if (mode === 'direct' && current.walMode) promoteToSnapshot(true)
      }

      try {
        const result = execute<T>(sql, params)

        // Immutable mode intentionally avoids all source-side WAL/SHM access.
        // If the source moved while this statement ran, discard that result
        // and take a stable owned copy before retrying once.
        if (mode === 'immutable' && beforeQuery !== null) {
          const afterQuery = observeSource(path)
          if (!sameSourceObservation(beforeQuery, afterQuery) && promoteToSnapshot(true)) {
            return execute<T>(sql, params)
          }
        }
        return result
      } catch (err) {
        // A DatabaseSync constructor can succeed while the first prepare/all
        // fails when SQLite later needs WAL shared-memory support. Promote only
        // this precise class, only once, and only with current WAL evidence.
        if (
          mode !== 'snapshot' &&
          isSqliteSourceSafeReadError(err) &&
          promoteToSnapshot(false)
        ) {
          return execute<T>(sql, params)
        }
        throw err
      }
    },
    close() {
      if (closed) return
      closed = true
      try {
        db!.close()
      } finally {
        cleanupSnapshotDirectory(snapshot?.directory)
      }
    },
  }
}
