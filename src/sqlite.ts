import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
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

type MainObservation = {
  dev: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  size: number
}

type WalObservation = {
  dev: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  size: number
}

type SourceProbe = {
  path: string
  main: MainObservation | null
  walPath: string
  wal: WalObservation | null
  hasLiveWal: boolean
}

type SourceObservation = SourceProbe & {
  fingerprint: SourceFileFingerprint | null
  walMode: boolean
}

type SourceSnapshot = {
  directory: string
  databasePath: string
  ownerToken: string
}

type SnapshotOwner = {
  pid: number
  token: string
  createdAtMs: number
}

type OpenedSource = {
  db: RawDatabase
  mode: OpenMode
  snapshot: SourceSnapshot | null
  probe: SourceProbe
}

const SNAPSHOT_DIRECTORY = 'sqlite-source-snapshots'
const SNAPSHOT_PREFIX = 'sqlite-source-read-'
const SNAPSHOT_OWNER_FILE = '.owner.json'
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

function readMainObservation(path: string): MainObservation | null {
  try {
    const stat = fs.statSync(path)
    if (!stat.isFile()) return null
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
function resolveSourceFile(
  sourcePath: string,
  preferredPath?: string,
): { path: string; main: MainObservation | null } {
  const candidates = preferredPath === undefined
    ? sourcePathCandidates(sourcePath)
    : [preferredPath, ...sourcePathCandidates(sourcePath)]

  for (const candidate of [...new Set(candidates)]) {
    const main = readMainObservation(candidate)
    if (main !== null) return { path: candidate, main }
  }

  return { path: preferredPath ?? sourcePath, main: null }
}

function resolveSourcePath(sourcePath: string, preferredPath?: string): string {
  return resolveSourceFile(sourcePath, preferredPath).path
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

function probeSource(sourcePath: string, preferredPath?: string, previousWal?: WalObservation | null): SourceProbe {
  const resolved = resolveSourceFile(sourcePath, preferredPath)
  const walPath = `${resolved.path}-wal`
  const wal = resolved.main === null
    ? null
    : previousWal === null && !fs.existsSync(walPath)
      ? null
      : readWalObservation(walPath)
  return {
    path: resolved.path,
    main: resolved.main,
    walPath,
    wal,
    hasLiveWal: wal !== null && wal.size > 0,
  }
}

function observeSource(sourcePath: string): SourceObservation {
  const probe = probeSource(sourcePath)
  return {
    ...probe,
    fingerprint: fingerprintSourceFileSync(sourcePath),
    walMode: probe.main !== null && hasWalModeHeader(probe.path),
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

function sameMainIdentity(a: MainObservation | null, b: MainObservation | null): boolean {
  if (a === null || b === null) return a === b
  return a.dev === b.dev && a.ino === b.ino
}

function sameMainMetadata(a: MainObservation | null, b: MainObservation | null): boolean {
  if (a === null || b === null) return a === b
  return a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs
    && a.size === b.size
}

function sameSourceProbe(a: SourceProbe, b: SourceProbe): boolean {
  if (a.path !== b.path) return false
  if (a.main === null || b.main === null) return a.main === b.main && sameWalObservation(a.wal, b.wal)
  return sameMainIdentity(a.main, b.main)
    && sameMainMetadata(a.main, b.main)
    && sameWalObservation(a.wal, b.wal)
}

function sourceProbeFromObservation(observation: SourceObservation): SourceProbe {
  return {
    path: observation.path,
    main: observation.main,
    walPath: observation.walPath,
    wal: observation.wal,
    hasLiveWal: observation.hasLiveWal,
  }
}
function sameSourceObservation(a: SourceObservation, b: SourceObservation): boolean {
  return sameSourceProbe(a, b)
    && sameFingerprint(a.fingerprint, b.fingerprint)
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

function writeSnapshotOwner(directory: string): SnapshotOwner {
  const owner: SnapshotOwner = {
    pid: process.pid,
    token: randomUUID(),
    createdAtMs: Date.now(),
  }
  const stagedPath = join(directory, `${SNAPSHOT_OWNER_FILE}.copying`)
  fs.writeFileSync(stagedPath, JSON.stringify(owner), { encoding: 'utf8', flag: 'wx' })
  fs.renameSync(stagedPath, join(directory, SNAPSHOT_OWNER_FILE))
  return owner
}

function readSnapshotOwner(directory: string): SnapshotOwner | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(join(directory, SNAPSHOT_OWNER_FILE), 'utf8')) as Partial<SnapshotOwner>
    if (
      typeof parsed.pid !== 'number' ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.token !== 'string' ||
      parsed.token.length === 0 ||
      typeof parsed.createdAtMs !== 'number' ||
      !Number.isFinite(parsed.createdAtMs)
    ) return null
    return {
      pid: parsed.pid,
      token: parsed.token,
      createdAtMs: parsed.createdAtMs,
    }
  } catch {
    return null
  }
}

function isSnapshotOwnerAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined
    return code !== 'ESRCH'
  }
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
        const owner = readSnapshotOwner(directory)
        if (owner === null || isSnapshotOwnerAlive(owner.pid)) continue
        fs.rmSync(directory, { recursive: true, force: true })
      }
    } catch {
      // A concurrent reader or a platform file lock owns the directory.
    }
  }
}

function cleanupSnapshotDirectory(directory: string | undefined, ownerToken?: string): void {
  if (!directory || !basename(directory).startsWith(SNAPSHOT_PREFIX)) return
  if (ownerToken !== undefined) {
    const owner = readSnapshotOwner(directory)
    if (owner === null || owner.token !== ownerToken) return
  }
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
    let owner: SnapshotOwner | undefined
    try {
      directory = fs.mkdtempSync(join(root, SNAPSHOT_PREFIX))
      owner = writeSnapshotOwner(directory)
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
      return { directory, databasePath, ownerToken: owner.token }
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

function openSnapshotSource(sourcePath: string, observed: SourceObservation): OpenedSource {
  const snapshot = createSnapshot(sourcePath)
  try {
    return {
      db: openRawDatabase(snapshot.databasePath, false),
      mode: 'snapshot',
      snapshot,
      probe: sourceProbeFromObservation(observed),
    }
  } catch (err) {
    cleanupSnapshotDirectory(snapshot.directory, snapshot.ownerToken)
    throw err
  }
}
function openClassifiedSource(sourcePath: string, observed: SourceObservation): OpenedSource {
  if (observed.main === null || observed.fingerprint === null) {
    throw new Error(`SQLite source is unavailable or disappeared: ${sourcePath}`)
  }

  if (observed.hasLiveWal) return openSnapshotSource(sourcePath, observed)

  if (observed.walMode) {
    try {
      const db = openRawDatabase(observed.path, true)
      return {
        db,
        mode: 'immutable',
        snapshot: null,
        probe: sourceProbeFromObservation(observed),
      }
    } catch (err) {
      const current = observeSource(sourcePath)
      if (!isSqliteSourceSafeReadError(err) || !current.hasLiveWal) throw err
      return openSnapshotSource(sourcePath, current)
    }
  }

  try {
    const db = openRawDatabase(observed.path, false)
    return {
      db,
      mode: 'direct',
      snapshot: null,
      probe: sourceProbeFromObservation(observed),
    }
  } catch (err) {
    const current = observeSource(sourcePath)
    if (!isSqliteSourceSafeReadError(err) || !current.hasLiveWal) throw err
    return openSnapshotSource(sourcePath, current)
  }
}
export function openDatabase(path: string): SqliteDatabase {
  if (!loadDriver() || DatabaseSync === null) {
    throw new Error(getSqliteLoadError())
  }

  const initial = observeSource(path)
  let db: RawDatabase | null = null
  let mode: OpenMode = 'direct'
  let snapshot: SourceSnapshot | null = null
  let handleProbe: SourceProbe | null = null

  try {
    const opened = openClassifiedSource(path, initial)
    db = opened.db
    mode = opened.mode
    snapshot = opened.snapshot
    handleProbe = opened.probe
  } catch (err) {
    cleanupSnapshotDirectory(snapshot?.directory, snapshot?.ownerToken)
    throw err
  }

  if (db === null || handleProbe === null) {
    cleanupSnapshotDirectory(snapshot?.directory, snapshot?.ownerToken)
    throw new Error(`SQLite database could not be opened: ${path}`)
  }

  let closed = false
  let terminalError: Error | null = null

  const clearOpenSource = (): void => {
    if (db !== null) {
      closeRawDatabase(db)
      db = null
    }
    if (snapshot !== null) {
      cleanupSnapshotDirectory(snapshot.directory, snapshot.ownerToken)
      snapshot = null
    }
    handleProbe = null
  }

  const reclassify = (current: SourceObservation, reason: string): void => {
    if (current.main === null || current.fingerprint === null) {
      const error = new Error(`SQLite source disappeared or was replaced while reading: ${path}`)
      clearOpenSource()
      terminalError = error
      throw error
    }

    clearOpenSource()
    try {
      const opened = openClassifiedSource(path, current)
      db = opened.db
      mode = opened.mode
      snapshot = opened.snapshot
      handleProbe = opened.probe
    } catch (err) {
      const error = new Error(
        `SQLite source could not be reclassified after ${reason}: ${errorMessage(err)}`,
        { cause: err },
      )
      terminalError = error
      throw error
    }
  }

  const preflightSource = (): void => {
    if (mode === 'snapshot') return
    if (handleProbe === null) throw terminalError ?? new Error(`SQLite source is not open: ${path}`)

    const currentProbe = probeSource(path, handleProbe.path, handleProbe.wal)
    if (currentProbe.main === null) {
      reclassify(observeSource(path), 'source disappearance')
      return
    }
    if (sameSourceProbe(handleProbe, currentProbe)) return

    const current = observeSource(path)
    if (current.main === null || current.fingerprint === null) {
      reclassify(current, 'source disappearance')
      return
    }

    // A normal rollback-journal write stays on the same inode and remains
    // correctly visible through the existing direct SQLite handle.
    if (
      mode === 'direct' &&
      !current.hasLiveWal &&
      !current.walMode &&
      sameMainIdentity(handleProbe.main, current.main)
    ) {
      handleProbe = sourceProbeFromObservation(current)
      return
    }

    reclassify(current, 'source identity or mode change')
  }

  const execute = <T extends Row>(sql: string, params: unknown[]): T[] => {
    if (db === null) throw terminalError ?? new Error(`SQLite database is not open: ${path}`)
    return db.prepare(sql).all(...params) as T[]
  }

  return {
    query<T extends Row = Row>(sql: string, params: unknown[] = []): T[] {
      if (closed) throw new Error('SQLite database is closed')
      if (terminalError !== null) throw terminalError
      preflightSource()

      let retryAttempted = false
      try {
        return execute<T>(sql, params)
      } catch (err) {
        if (
          !retryAttempted &&
          mode !== 'snapshot' &&
          isSqliteSourceSafeReadError(err)
        ) {
          retryAttempted = true
          const current = observeSource(path)
          if (current.hasLiveWal) {
            reclassify(current, 'query-time source-safe fallback')
            return execute<T>(sql, params)
          }
        }
        throw err
      }
    },
    close() {
      if (closed) return
      closed = true
      try {
        if (db !== null) closeRawDatabase(db)
      } finally {
        if (snapshot !== null) {
          cleanupSnapshotDirectory(snapshot.directory, snapshot.ownerToken)
          snapshot = null
        }
        db = null
        handleProbe = null
      }
    },
  }
}
