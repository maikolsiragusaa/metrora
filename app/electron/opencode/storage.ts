import { copyFile, mkdtemp, mkdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import type { OpenCodeRuntimePaths } from './config'
import { OPENCODE_VERSION } from './types'

type SqliteStatement = {
  all: (...parameters: unknown[]) => Array<Record<string, unknown>>
}

type SqliteDatabase = {
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

type SqliteDatabaseConstructor = new (filePath: string, options?: { readOnly?: boolean }) => SqliteDatabase

type FileFingerprint = {
  size: number
  mtimeMs: number
  ctimeMs: number
  ino?: number
  dev?: number
}

type SourceState = {
  main: FileFingerprint
  wal: FileFingerprint | null
  journal: FileFingerprint | null
}

export type OpenCodeStoragePreparation =
  | { outcome: 'existing' }
  | { outcome: 'empty' }
  | { outcome: 'imported'; sourcePath: string }
  | { outcome: 'failed'; sourcePath?: string; detail: string }

export type OpenCodeStorageOptions = {
  userDataPath: string
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  discoverDefaultLocations?: boolean
  onWarning?: (message: string) => void
}

const SNAPSHOT_ATTEMPTS = 3
const SNAPSHOT_PREFIX = 'opencode-storage-snapshot-'
// This is a reserve for SQLite validation/temp files and filesystem overhead,
// not a maximum source size. The source itself is bounded by available space.
const EXTERNAL_IMPORT_DISK_RESERVE_BYTES = 256 * 1024 * 1024
const DATABASE_SIDECARS = ['-wal', '-shm', '-journal'] as const

let sqliteConstructorPromise: Promise<SqliteDatabaseConstructor | null> | null = null

async function loadSqliteConstructor(): Promise<SqliteDatabaseConstructor | null> {
  if (!sqliteConstructorPromise) {
    sqliteConstructorPromise = import('node:sqlite')
      .then(module => (module as { DatabaseSync?: SqliteDatabaseConstructor }).DatabaseSync ?? null)
      .catch(() => null)
  }
  return sqliteConstructorPromise
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbsolute(value: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? path.win32.isAbsolute(value) : path.isAbsolute(value)
}

function normalizedPath(value: string, platform: NodeJS.Platform): string {
  const resolved = platform === 'win32' ? path.win32.resolve(value) : path.resolve(value)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  return normalizedPath(a, platform) === normalizedPath(b, platform)
}

function isWithin(parent: string, candidate: string, platform: NodeJS.Platform): boolean {
  const relative = platform === 'win32'
    ? path.win32.relative(path.win32.resolve(parent), path.win32.resolve(candidate))
    : path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${platform === 'win32' ? '\\' : path.sep}`))
}

function addCandidate(
  candidates: string[],
  seen: Set<string>,
  value: string | undefined,
  platform: NodeJS.Platform,
  paths: OpenCodeRuntimePaths,
): void {
  if (!value || !isAbsolute(value, platform)) return
  if (samePath(value, paths.databasePath, platform) || isWithin(paths.runtimeRoot, value, platform)) return
  const key = normalizedPath(value, platform)
  if (seen.has(key)) return
  seen.add(key)
  candidates.push(value)
}

/** Resolve only stores that the pre-isolation runtime could have used. */
export function legacyOpenCodeDatabaseCandidates(options: OpenCodeStorageOptions, paths: OpenCodeRuntimePaths): string[] {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const home = homedir()
  const candidates: string[] = []
  const seen = new Set<string>()

  addCandidate(candidates, seen, environment.OPENCODE_DB, platform, paths)

  if (environment.XDG_DATA_HOME) {
    addCandidate(candidates, seen, path.join(environment.XDG_DATA_HOME, 'opencode', 'opencode.db'), platform, paths)
  }

  if (options.discoverDefaultLocations ?? options.environment === undefined) {
    if (platform === 'win32') {
      addCandidate(candidates, seen, path.join(environment.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'opencode', 'opencode.db'), platform, paths)
      addCandidate(candidates, seen, path.join(environment.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'opencode', 'opencode.db'), platform, paths)
      addCandidate(candidates, seen, path.join(home, '.local', 'share', 'opencode', 'opencode.db'), platform, paths)
    } else if (platform === 'darwin') {
      addCandidate(candidates, seen, path.join(home, 'Library', 'Application Support', 'opencode', 'opencode.db'), platform, paths)
      addCandidate(candidates, seen, path.join(home, '.local', 'share', 'opencode', 'opencode.db'), platform, paths)
    } else {
      addCandidate(candidates, seen, path.join(home, '.local', 'share', 'opencode', 'opencode.db'), platform, paths)
    }
  }

  // Very early Metrora builds placed the config and any explicitly redirected
  // database below this version directory. Keep this read-only candidate for
  // existing users, while excluding the new runtime root above.
  addCandidate(candidates, seen, path.join(options.userDataPath, 'opencode', OPENCODE_VERSION, 'opencode.db'), platform, paths)
  return candidates
}

async function fileFingerprint(filePath: string): Promise<FileFingerprint | null> {
  try {
    const value = await stat(filePath)
    if (!value.isFile()) return null
    return { size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, ino: value.ino, dev: value.dev }
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null
    throw error
  }
}

async function sourceState(filePath: string): Promise<SourceState | null> {
  const main = await fileFingerprint(filePath)
  if (!main) return null
  return {
    main,
    wal: await fileFingerprint(`${filePath}-wal`),
    journal: await fileFingerprint(`${filePath}-journal`),
  }
}

function sameFingerprint(a: FileFingerprint | null, b: FileFingerprint | null): boolean {
  if (a === null || b === null) return a === b
  return a.size === b.size
    && a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs
    && a.ino === b.ino
    && a.dev === b.dev
}

function sameSourceState(a: SourceState, b: SourceState): boolean {
  return sameFingerprint(a.main, b.main) && sameFingerprint(a.wal, b.wal) && sameFingerprint(a.journal, b.journal)
}

async function ensureExternalImportResources(source: SourceState, destinationRoot: string): Promise<void> {
  let availableBytes: bigint
  try {
    const filesystem = await statfs(destinationRoot, { bigint: true })
    availableBytes = filesystem.bavail * filesystem.bsize
  } catch (error) {
    throw new Error(`available destination disk space could not be checked: ${errorMessage(error)}`)
  }

  const snapshotBytes = BigInt(source.main.size) + BigInt(source.wal?.size ?? 0)
  const requiredBytes = snapshotBytes + BigInt(EXTERNAL_IMPORT_DISK_RESERVE_BYTES)
  if (availableBytes < requiredBytes) {
    throw new Error(`external OpenCode import needs ${requiredBytes.toString()} bytes but only ${availableBytes.toString()} bytes are available`)
  }
}

function waitBriefly(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10))
}

type OwnedSnapshot = { directory: string; databasePath: string; walPath: string | null }

async function createOwnedSnapshot(sourcePath: string, root: string): Promise<OwnedSnapshot> {
  let lastFailure = 'source state was not stable'

  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
    const before = await sourceState(sourcePath)
    if (!before) {
      lastFailure = 'source database disappeared'
      break
    }
    if (before.journal) {
      lastFailure = 'an active rollback journal was present'
      await waitBriefly()
      continue
    }
    await ensureExternalImportResources(before, root)

    const directory = await mkdtemp(path.join(root, SNAPSHOT_PREFIX))
    const stagedDatabase = path.join(directory, 'source.sqlite.copying')
    const stagedWal = path.join(directory, 'source.sqlite-wal.copying')
    const databasePath = path.join(directory, 'source.sqlite')
    try {
      // WAL is copied first so a stable source fence can only publish a pair
      // that represents one read-only point in time. SHM is intentionally not
      // copied; SQLite can rebuild that index in this Metrora-owned directory.
      if (before.wal) await copyFile(`${sourcePath}-wal`, stagedWal)
      await copyFile(sourcePath, stagedDatabase)
      const after = await sourceState(sourcePath)
      if (!after || after.journal || !sameSourceState(before, after)) {
        lastFailure = !after ? 'source disappeared during snapshot' : after.journal ? 'a rollback journal appeared during snapshot' : 'source changed during snapshot'
        await rm(directory, { recursive: true, force: true })
        await waitBriefly()
        continue
      }
      await rename(stagedDatabase, databasePath)
      const walPath = before.wal ? `${databasePath}-wal` : null
      if (walPath) await rename(stagedWal, walPath)
      return { directory, databasePath, walPath }
    } catch (error) {
      lastFailure = errorMessage(error)
      await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  }

  throw new Error(`safe SQLite snapshot failed: ${lastFailure}`)
}

async function validateOwnedSnapshot(filePath: string): Promise<void> {
  const DatabaseSync = await loadSqliteConstructor()
  if (!DatabaseSync) throw new Error('the bundled Node runtime has no node:sqlite support')
  let database: SqliteDatabase | undefined
  try {
    database = new DatabaseSync(filePath, { readOnly: true })
    const rows = database.prepare('PRAGMA integrity_check').all()
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error('SQLite snapshot failed integrity verification')
  } finally {
    try { database?.close() } catch { /* best effort for an owned snapshot */ }
  }
}

async function removeOwnedDatabaseSidecars(paths: OpenCodeRuntimePaths): Promise<void> {
  for (const suffix of DATABASE_SIDECARS) {
    await rm(`${paths.databasePath}${suffix}`, { force: true })
  }
}

async function publishOwnedSnapshot(snapshot: OwnedSnapshot, paths: OpenCodeRuntimePaths): Promise<boolean> {
  let publishedWal = false
  let publishedDatabase = false
  try {
    if (snapshot.walPath) {
      // Publish WAL first. If startup is interrupted before the main file is
      // moved, the next prepare pass removes this orphan sidecar and retries
      // from the unchanged external source.
      await rename(snapshot.walPath, `${paths.databasePath}-wal`)
      publishedWal = true
    }
    // The snapshot and final database live below the same runtime root, so a
    // rename avoids a second full-size copy at peak disk usage.
    await rename(snapshot.databasePath, paths.databasePath)
    publishedDatabase = true
    return true
  } catch (error) {
    if (publishedDatabase) await rm(paths.databasePath, { force: true }).catch(() => {})
    if (publishedWal) await rm(`${paths.databasePath}-wal`, { force: true }).catch(() => {})
    throw error
  }
}

async function importDatabaseSnapshot(sourcePath: string, paths: OpenCodeRuntimePaths): Promise<boolean> {
  const snapshotRoot = path.join(paths.runtimeRoot, 'storage-imports')
  await mkdir(snapshotRoot, { recursive: true, mode: 0o700 })
  const snapshot = await createOwnedSnapshot(sourcePath, snapshotRoot)
  try {
    // Validate only the owned snapshot. The external database is never opened
    // by SQLite, and the source SHM index is intentionally omitted.
    await validateOwnedSnapshot(snapshot.databasePath)
    // Publish only the owned main+WAL pair; no serialization API is required.
    return await publishOwnedSnapshot(snapshot, paths)
  } finally {
    await rm(snapshot.directory, { recursive: true, force: true }).catch(() => {})
  }
}

export async function prepareOpenCodeStorage(paths: OpenCodeRuntimePaths, options: OpenCodeStorageOptions): Promise<OpenCodeStoragePreparation> {
  if (await fileFingerprint(paths.databasePath)) return { outcome: 'existing' }
  await mkdir(paths.dbDir, { recursive: true, mode: 0o700 })
  // A missing main file can leave sidecars behind after an interrupted import.
  // They are not a valid database on their own and must not be paired with a
  // different source snapshot.
  await removeOwnedDatabaseSidecars(paths)

  for (const sourcePath of legacyOpenCodeDatabaseCandidates(options, paths)) {
    try {
      if (!await fileFingerprint(sourcePath)) continue
      const imported = await importDatabaseSnapshot(sourcePath, paths)
      if (!imported) return { outcome: 'existing' }
      return { outcome: 'imported', sourcePath }
    } catch (error) {
      const detail = errorMessage(error)
      const failure: OpenCodeStoragePreparation = { outcome: 'failed', sourcePath, detail }
      options.onWarning?.(`OpenCode history import skipped for ${sourcePath}: ${detail}`)
      return failure
    }
  }
  return { outcome: 'empty' }
}

/** Preserve an imported database for diagnosis before retrying with a clean store. */
export async function quarantineImportedOpenCodeDatabase(paths: OpenCodeRuntimePaths): Promise<string | null> {
  const target = path.join(paths.dbDir, `opencode-import-rejected-${Date.now()}.db`)
  try {
    const database = await stat(paths.databasePath)
    if (!database.isFile()) return null
    await rename(paths.databasePath, target)
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try { await rename(`${paths.databasePath}${suffix}`, `${target}${suffix}`) } catch { /* sidecar may not exist */ }
    }
    return target
  } catch {
    return null
  }
}
