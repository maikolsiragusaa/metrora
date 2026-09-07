import { copyFile, mkdtemp, mkdir, open, rename, rm, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import type { OpenCodeRuntimePaths } from './config'
import { OPENCODE_VERSION } from './types'

type SqliteDatabase = {
  serialize: (name?: string) => Uint8Array
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
const MAX_SOURCE_BYTES = 512 * 1024 * 1024

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
    if (value.size > MAX_SOURCE_BYTES) throw new Error(`source file exceeds the bounded import size (${MAX_SOURCE_BYTES} bytes)`)
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

function waitBriefly(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10))
}

type OwnedSnapshot = { directory: string; databasePath: string }

async function createOwnedSnapshot(sourcePath: string, root: string): Promise<OwnedSnapshot> {
  let lastFailure = 'source state was not stable'

  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
    const before = await sourceState(sourcePath)
    if (!before) {
      lastFailure = 'source database disappeared or exceeded the bounded import size'
      break
    }
    if (before.journal) {
      lastFailure = 'an active rollback journal was present'
      await waitBriefly()
      continue
    }

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
      if (before.wal) await rename(stagedWal, `${databasePath}-wal`)
      return { directory, databasePath }
    } catch (error) {
      lastFailure = errorMessage(error)
      await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  }

  throw new Error(`safe SQLite snapshot failed: ${lastFailure}`)
}

async function writeDatabaseIfAbsent(filePath: string, content: Uint8Array): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(filePath, 'wx', 0o600)
    await handle.writeFile(content)
    await handle.sync()
    return true
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') return false
    if (handle) {
      await handle.close().catch(() => {})
      handle = undefined
      try { await unlink(filePath) } catch { /* a partial owned file is best effort cleanup */ }
    }
    throw error
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function importDatabaseSnapshot(sourcePath: string, paths: OpenCodeRuntimePaths): Promise<boolean> {
  const DatabaseSync = await loadSqliteConstructor()
  if (!DatabaseSync) throw new Error('the bundled Node runtime has no node:sqlite support')

  const snapshotRoot = path.join(paths.runtimeRoot, 'storage-imports')
  await mkdir(snapshotRoot, { recursive: true, mode: 0o700 })
  const snapshot = await createOwnedSnapshot(sourcePath, snapshotRoot)
  let database: SqliteDatabase | undefined
  try {
    // serialize() runs against the owned snapshot, never the external path.
    // The destination is a fresh Metrora-owned database with no shared WAL.
    database = new DatabaseSync(snapshot.databasePath)
    const serialized = database.serialize()
    if (!(serialized instanceof Uint8Array) || serialized.byteLength === 0) throw new Error('SQLite snapshot was empty')
    return await writeDatabaseIfAbsent(paths.databasePath, serialized)
  } finally {
    try { database?.close() } catch { /* best effort for an owned snapshot */ }
    await rm(snapshot.directory, { recursive: true, force: true }).catch(() => {})
  }
}

export async function prepareOpenCodeStorage(paths: OpenCodeRuntimePaths, options: OpenCodeStorageOptions): Promise<OpenCodeStoragePreparation> {
  if (await fileFingerprint(paths.databasePath)) return { outcome: 'existing' }
  await mkdir(paths.dbDir, { recursive: true, mode: 0o700 })

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
