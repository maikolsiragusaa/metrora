import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  isSqliteAvailable,
  isSqliteBusyError,
  isSqliteSourceSafeReadError,
  openDatabase,
} from '../src/sqlite.js'

const requireForTest = createRequire(import.meta.url)

type Statement = { run(...params: unknown[]): unknown }
type TestDatabase = {
  exec(sql: string): void
  prepare(sql: string): Statement
  close(): void
}
type DatabaseConstructor = {
  new (path: string, options?: { readOnly?: boolean }): TestDatabase
  prototype: TestDatabase
}

const roots: string[] = []
const producers: TestDatabase[] = []

function databaseConstructor(): DatabaseConstructor {
  return (requireForTest('node:sqlite') as { DatabaseSync: DatabaseConstructor }).DatabaseSync
}

function root(prefix: string): string {
  const path = fs.mkdtempSync(join(tmpdir(), prefix))
  roots.push(path)
  return path
}

function cacheFor(testRoot: string): string {
  const cache = join(testRoot, 'metrora-cache')
  vi.stubEnv('METRORA_CACHE_DIR', cache)
  return cache
}

function snapshotDirectories(cache: string): string[] {
  const snapshotRoot = join(cache, 'sqlite-source-snapshots')
  try {
    return fs.readdirSync(snapshotRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('sqlite-source-read-'))
      .map(entry => entry.name)
      .sort()
  } catch {
    return []
  }
}

function directorySnapshot(directory: string): Array<[string, string]> {
  return fs.readdirSync(directory)
    .sort()
    .map(name => [name, fs.readFileSync(join(directory, name)).toString('base64')])
}

function createWalProducer(directory: string): { path: string; db: TestDatabase } {
  fs.mkdirSync(directory, { recursive: true })
  const path = join(directory, 'source.sqlite')
  const db = new (databaseConstructor())(path)
  producers.push(db)
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA wal_autocheckpoint=0;
    CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    PRAGMA wal_checkpoint(TRUNCATE);
  `)
  db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run(1, 'wal-row')
  return { path, db }
}

function createActiveWalSource(testRoot: string): { sourcePath: string; sourceDirectory: string; producer: TestDatabase } {
  const sourceDirectory = join(testRoot, 'active-source')
  const producer = createWalProducer(sourceDirectory)
  return { sourcePath: producer.path, sourceDirectory, producer: producer.db }
}

function createCopiedWalSource(testRoot: string): { sourcePath: string; sourceDirectory: string; producer: TestDatabase } {
  const producerDirectory = join(testRoot, 'producer-source')
  const sourceDirectory = join(testRoot, 'copied-source')
  const producer = createWalProducer(producerDirectory)
  fs.mkdirSync(sourceDirectory, { recursive: true })
  const sourcePath = join(sourceDirectory, 'source.sqlite')
  fs.copyFileSync(producer.path, sourcePath)
  fs.copyFileSync(`${producer.path}-wal`, `${sourcePath}-wal`)
  // Deliberately omit -shm: it is a derived coordination file, never source
  // authority for the Metrora snapshot.
  return { sourcePath, sourceDirectory, producer: producer.db }
}

function createWalModeMainOnly(
  testRoot: string,
  sourceName = 'main-only-source',
  producerName = 'producer-main-only',
): {
  sourcePath: string
  sourceDirectory: string
  walBytes: Buffer
  producer: TestDatabase
} {
  const producerDirectory = join(testRoot, producerName)
  const sourceDirectory = join(testRoot, sourceName)
  const producer = createWalProducer(producerDirectory)
  const initialMain = fs.readFileSync(producer.path)
  const walBytes = fs.readFileSync(`${producer.path}-wal`)
  fs.mkdirSync(sourceDirectory, { recursive: true })
  const sourcePath = join(sourceDirectory, 'source.sqlite')
  fs.writeFileSync(sourcePath, initialMain)
  // The source starts WAL-mode with no live WAL. The bytes are published by a
  // deterministic query-time test hook to model a producer racing the reader.
  return { sourcePath, sourceDirectory, walBytes, producer: producer.db }
}

function createRollbackSource(testRoot: string, value = 'rollback-row', directoryName = 'rollback-source'): { sourcePath: string; sourceDirectory: string } {
  const sourceDirectory = join(testRoot, directoryName)
  fs.mkdirSync(sourceDirectory, { recursive: true })
  const sourcePath = join(sourceDirectory, 'source.sqlite')
  const db = new (databaseConstructor())(sourcePath)
  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run(1, value)
  db.close()
  return { sourcePath, sourceDirectory }
}

function createImmutableWalSource(testRoot: string, value: string, directoryName: string): { sourcePath: string; sourceDirectory: string } {
  const sourceDirectory = join(testRoot, directoryName)
  fs.mkdirSync(sourceDirectory, { recursive: true })
  const sourcePath = join(sourceDirectory, 'source.sqlite')
  const db = new (databaseConstructor())(sourcePath)
  producers.push(db)
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA wal_autocheckpoint=0;
    CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
  `)
  db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run(1, value)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()
  return { sourcePath, sourceDirectory }
}
function replaceSourceFile(sourcePath: string, replacementPath: string): void {
  const temporaryPath = join(dirname(sourcePath), `.replacement-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  try {
    fs.copyFileSync(replacementPath, temporaryPath)
    if (process.platform === 'win32') {
      fs.copyFileSync(temporaryPath, sourcePath)
    } else {
      fs.renameSync(temporaryPath, sourcePath)
    }
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true })
  }
}

function publishWalPair(sourcePath: string, producerPath: string): void {
  const suffix = `.wal-replacement-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const mainTemporaryPath = `${sourcePath}${suffix}`
  const walTemporaryPath = `${sourcePath}-wal${suffix}`
  try {
    fs.copyFileSync(producerPath, mainTemporaryPath)
    fs.copyFileSync(`${producerPath}-wal`, walTemporaryPath)
    fs.renameSync(walTemporaryPath, `${sourcePath}-wal`)
    fs.renameSync(mainTemporaryPath, sourcePath)
  } finally {
    if (fs.existsSync(mainTemporaryPath)) fs.rmSync(mainTemporaryPath, { force: true })
    if (fs.existsSync(walTemporaryPath)) fs.rmSync(walTemporaryPath, { force: true })
  }
}

afterEach(() => {
  for (const producer of producers.splice(0)) {
    try { producer.close() } catch { /* fixture cleanup */ }
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const path of roots.splice(0)) {
    fs.rmSync(path, { recursive: true, force: true })
  }
})

const sqliteDescribe = isSqliteAvailable() ? describe : describe.skip

sqliteDescribe('shared SQLite source-safe reads', () => {
  it('reads an ordinary rollback-journal database without changing its directory', () => {
    const testRoot = root('metrora-sqlite-safe-rollback-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot)
    const before = directorySnapshot(source.sourceDirectory)

    const db = openDatabase(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'rollback-row' }])
    db.close()

    expect(directorySnapshot(source.sourceDirectory)).toEqual(before)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('reads committed rows from a live WAL without touching the producer directory', () => {
    const testRoot = root('metrora-sqlite-safe-wal-')
    const cache = cacheFor(testRoot)
    const source = createActiveWalSource(testRoot)
    const before = directorySnapshot(source.sourceDirectory)

    const snapshotCopy = vi.spyOn(fs, 'copyFileSync')
    const sourceStats = vi.spyOn(fs, 'statSync')
    const db = openDatabase(source.sourcePath)
    const statsAfterOpen = sourceStats.mock.calls.length
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    expect(snapshotDirectories(cache)).toHaveLength(1)
    expect(snapshotCopy).toHaveBeenCalledTimes(2)
    db.close()

    expect(directorySnapshot(source.sourceDirectory)).toEqual(before)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('reads a WAL with missing SHM from a read-only parent where permissions are enforceable', () => {
    const testRoot = root('metrora-sqlite-safe-missing-shm-')
    const cache = cacheFor(testRoot)
    const source = createCopiedWalSource(testRoot)
    const before = directorySnapshot(source.sourceDirectory)
    let restorePermissions: (() => void) | undefined

    if (process.platform !== 'win32') {
      const mode = fs.statSync(source.sourceDirectory).mode & 0o777
      fs.chmodSync(source.sourceDirectory, 0o555)
      restorePermissions = () => fs.chmodSync(source.sourceDirectory, mode)
    }

    try {
      const db = openDatabase(source.sourcePath)
      expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
      db.close()
    } finally {
      restorePermissions?.()
    }

    expect(fs.existsSync(`${source.sourcePath}-shm`)).toBe(false)
    expect(directorySnapshot(source.sourceDirectory)).toEqual(before)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('does not create SHM beside a writable WAL source either', () => {
    const testRoot = root('metrora-sqlite-safe-writable-wal-')
    const cache = cacheFor(testRoot)
    const source = createCopiedWalSource(testRoot)
    const before = directorySnapshot(source.sourceDirectory)

    const db = openDatabase(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    db.close()

    expect(fs.existsSync(`${source.sourcePath}-shm`)).toBe(false)
    expect(directorySnapshot(source.sourceDirectory)).toEqual(before)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('promotes after a constructor-success/query-time CANTOPEN boundary failure and retries once', () => {
    const testRoot = root('metrora-sqlite-safe-query-fallback-')
    const cache = cacheFor(testRoot)
    const source = createWalModeMainOnly(testRoot)
    const db = openDatabase(source.sourcePath)
    const DatabaseSync = databaseConstructor()
    const originalPrepare = DatabaseSync.prototype.prepare
    let injectFailure = true

    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: TestDatabase, sql: string) {
      if (injectFailure) {
        injectFailure = false
        fs.writeFileSync(`${source.sourcePath}-wal`, source.walBytes)
        throw Object.assign(new Error('unable to open database file'), {
          code: 'ERR_SQLITE_ERROR',
          errcode: 14,
          errstr: 'unable to open database file',
        })
      }
      return originalPrepare.call(this, sql)
    })

    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    db.close()

    expect(fs.existsSync(`${source.sourcePath}-shm`)).toBe(false)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('keeps fallback authority available when CANTOPEN has no live WAL yet', () => {
    const testRoot = root('metrora-sqlite-safe-two-stage-fallback-')
    const cache = cacheFor(testRoot)
    const source = createWalModeMainOnly(testRoot)
    const db = openDatabase(source.sourcePath)
    const DatabaseSync = databaseConstructor()
    const originalPrepare = DatabaseSync.prototype.prepare
    let failOnce = true

    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: TestDatabase, sql: string) {
      if (failOnce) {
        failOnce = false
        throw Object.assign(new Error('unable to open database file'), { code: 'ERR_SQLITE_ERROR', errcode: 14 })
      }
      return originalPrepare.call(this, sql)
    })

    expect(() => db.query('SELECT value FROM items')).toThrow(/unable to open database file/i)
    expect(snapshotDirectories(cache)).toEqual([])

    fs.writeFileSync(`${source.sourcePath}-wal`, source.walBytes)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    expect(snapshotDirectories(cache)).toHaveLength(1)
    db.close()

  })

  it('uses the immutable URI for a WAL-mode main file with no live WAL', () => {
    const testRoot = root('metrora-sqlite-safe-immutable-')
    const cache = cacheFor(testRoot)
    const source = createWalModeMainOnly(testRoot)
    const before = directorySnapshot(source.sourceDirectory)

    const db = openDatabase(source.sourcePath)
    expect(db.query('SELECT name FROM sqlite_master WHERE type = \'table\'')).toEqual([{ name: 'items' }])
    db.close()

    expect(directorySnapshot(source.sourceDirectory)).toEqual(before)
    expect(fs.existsSync(`${source.sourcePath}-shm`)).toBe(false)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('reclassifies direct readers after pathname rotation', () => {
    const testRoot = root('metrora-sqlite-safe-direct-rotation-')
    const cache = cacheFor(testRoot)
    const oldSource = createRollbackSource(testRoot, 'old-row', 'rotation-old')
    const nextSource = createRollbackSource(testRoot, 'new-row', 'rotation-new')
    const nextBefore = directorySnapshot(nextSource.sourceDirectory)
    const db = openDatabase(oldSource.sourcePath)

    replaceSourceFile(oldSource.sourcePath, nextSource.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'new-row' }])
    db.close()

    expect(directorySnapshot(nextSource.sourceDirectory)).toEqual(nextBefore)
    expect(fs.existsSync(`${oldSource.sourcePath}-wal`)).toBe(false)
    expect(fs.existsSync(`${oldSource.sourcePath}-shm`)).toBe(false)
  })

  it('reclassifies immutable readers after pathname rotation', () => {
    const testRoot = root('metrora-sqlite-safe-immutable-rotation-')
    const cache = cacheFor(testRoot)
    const oldSource = createImmutableWalSource(testRoot, 'old-row', 'immutable-old')
    const nextSource = createImmutableWalSource(testRoot, 'new-row', 'immutable-new')
    const db = openDatabase(oldSource.sourcePath)

    replaceSourceFile(oldSource.sourcePath, nextSource.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'new-row' }])
    db.close()

    expect(fs.existsSync(`${oldSource.sourcePath}-shm`)).toBe(false)
    expect(snapshotDirectories(cache)).toEqual([])
  })
  it('reclassifies immutable readers after an in-place main-file change', () => {
    const testRoot = root('metrora-sqlite-safe-immutable-change-')
    const cache = cacheFor(testRoot)
    const oldSource = createImmutableWalSource(testRoot, 'old-row', 'immutable-change-old')
    const nextSource = createImmutableWalSource(testRoot, 'new-row', 'immutable-change-new')
    const db = openDatabase(oldSource.sourcePath)

    fs.copyFileSync(nextSource.sourcePath, oldSource.sourcePath)
    const touched = new Date(Date.now() + 2000)
    fs.utimesSync(oldSource.sourcePath, touched, touched)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'new-row' }])
    db.close()

  })

  it('uses lightweight source probes in direct and immutable steady state', () => {
    const testRoot = root('metrora-sqlite-safe-preflight-')
    const cache = cacheFor(testRoot)
    const sourceStats = vi.spyOn(fs, 'openSync')
    const directSource = createRollbackSource(testRoot, 'direct-row', 'preflight-direct')
    const direct = openDatabase(directSource.sourcePath)
    const directOpenCount = sourceStats.mock.calls.length
    for (let index = 0; index < 20; index++) {
      expect(direct.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'direct-row' }])
    }
    expect(sourceStats.mock.calls.length).toBe(directOpenCount)
    direct.close()

    const immutableSource = createImmutableWalSource(testRoot, 'immutable-row', 'preflight-immutable')
    const immutable = openDatabase(immutableSource.sourcePath)
    const immutableOpenCount = sourceStats.mock.calls.length
    for (let index = 0; index < 20; index++) {
      expect(immutable.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'immutable-row' }])
    }
    expect(sourceStats.mock.calls.length).toBe(immutableOpenCount)
    immutable.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('rejects an unstable WAL copy, retries, and publishes only the stable pair', () => {
    const testRoot = root('metrora-sqlite-safe-retry-')
    const cache = cacheFor(testRoot)
    const source = createActiveWalSource(testRoot)
    const realCopyFileSync = fs.copyFileSync
    let copyCalls = 0

    vi.spyOn(fs, 'copyFileSync').mockImplementation((from: fs.PathLike, to: fs.PathLike, mode?: number) => {
      const result = realCopyFileSync(from, to, mode)
      copyCalls++
      if (copyCalls === 1) {
        source.producer.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run(2, 'during-copy')
      }
      return result
    })

    const db = openDatabase(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items ORDER BY id')).toEqual([
      { value: 'wal-row' },
      { value: 'during-copy' },
    ])
    expect(copyCalls).toBeGreaterThanOrEqual(4)
    expect(snapshotDirectories(cache)).toHaveLength(1)
    db.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('promotes an existing direct reader when rollback mode becomes live WAL', () => {
    const testRoot = root('metrora-sqlite-safe-rollback-to-wal-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot, 'rollback-row', 'rollback-to-wal-source')
    const producer = createActiveWalSource(testRoot)
    const db = openDatabase(source.sourcePath)

    publishWalPair(source.sourcePath, producer.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    expect(snapshotDirectories(cache)).toHaveLength(1)
    db.close()

    expect(fs.existsSync(`${source.sourcePath}-shm`)).toBe(false)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('fails clearly when the current source disappears', () => {
    const testRoot = root('metrora-sqlite-safe-disappearance-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot)
    const db = openDatabase(source.sourcePath)

    fs.unlinkSync(source.sourcePath)
    expect(() => db.query('SELECT value FROM items')).toThrow(/disappeared|replaced|unavailable/i)
    db.close()
  })

  it('keeps concurrent reader snapshots collision-free and cleans them on close', () => {
    const testRoot = root('metrora-sqlite-safe-concurrent-')
    const cache = cacheFor(testRoot)
    const source = createActiveWalSource(testRoot)
    const readers = Array.from({ length: 4 }, () => openDatabase(source.sourcePath))

    const directories = snapshotDirectories(cache)
    expect(directories).toHaveLength(4)
    expect(new Set(directories).size).toBe(4)
    for (const reader of readers) {
      expect(reader.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    }
    for (const reader of readers) reader.close()

    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('does not reclaim an active snapshot whose owner appears stale by wall clock', () => {
    const testRoot = root('metrora-sqlite-safe-active-owner-')
    const cache = cacheFor(testRoot)
    const source = createActiveWalSource(testRoot)
    const first = openDatabase(source.sourcePath)
    const firstDirectory = join(cache, 'sqlite-source-snapshots', snapshotDirectories(cache)[0])
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    fs.utimesSync(firstDirectory, old, old)

    const second = openDatabase(source.sourcePath)
    expect(snapshotDirectories(cache)).toHaveLength(2)
    expect(fs.existsSync(firstDirectory)).toBe(true)
    expect(first.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    second.close()
    expect(fs.existsSync(firstDirectory)).toBe(true)
    first.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('removes stale owned material before opening and cleans the active snapshot on close', () => {
    const testRoot = root('metrora-sqlite-safe-cleanup-')
    const cache = cacheFor(testRoot)
    const snapshotRoot = join(cache, 'sqlite-source-snapshots')
    const stale = join(snapshotRoot, 'sqlite-source-read-stale')
    fs.mkdirSync(stale, { recursive: true })
    const stalePid = Number.MAX_SAFE_INTEGER
    fs.writeFileSync(join(stale, '.owner.json'), JSON.stringify({ pid: stalePid, token: 'abandoned', createdAtMs: Date.now() - 2 * 24 * 60 * 60 * 1000 }))
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('owner is gone'), { code: 'ESRCH' })
    })
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    fs.utimesSync(stale, old, old)

    const source = createActiveWalSource(testRoot)
    const db = openDatabase(source.sourcePath)
    expect(fs.existsSync(stale)).toBe(false)
    expect(snapshotDirectories(cache)).toHaveLength(1)
    db.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('does not reclaim stale material when ownership is ambiguous', () => {
    const testRoot = root('metrora-sqlite-safe-ambiguous-owner-')
    const cache = cacheFor(testRoot)
    const snapshotRoot = join(cache, 'sqlite-source-snapshots')
    const ambiguous = join(snapshotRoot, 'sqlite-source-read-ambiguous')
    fs.mkdirSync(ambiguous, { recursive: true })
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    fs.utimesSync(ambiguous, old, old)

    const source = createActiveWalSource(testRoot)
    const db = openDatabase(source.sourcePath)
    expect(fs.existsSync(ambiguous)).toBe(true)
    db.close()
    expect(fs.existsSync(ambiguous)).toBe(true)
  })

  it('does not retry unrelated SQL errors or create a snapshot', () => {
    const testRoot = root('metrora-sqlite-safe-query-error-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot)
    const db = openDatabase(source.sourcePath)

    expect(() => db.query('SELECT * FROM missing_table')).toThrow(/no such table/i)
    db.close()

    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('does not promote a CANTOPEN error without live WAL evidence', () => {
    const testRoot = root('metrora-sqlite-safe-unrelated-cantopen-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot)
    const db = openDatabase(source.sourcePath)
    const DatabaseSync = databaseConstructor()

    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(() => {
      throw Object.assign(new Error('unable to open database file'), {
        code: 'ERR_SQLITE_ERROR',
        errcode: 14,
      })
    })

    expect(() => db.query('SELECT value FROM items')).toThrow(/unable to open database file/i)
    db.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('preserves busy/locked classification and excludes it from source-safe fallback', () => {
    const busy = { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' }
    expect(isSqliteBusyError(busy)).toBe(true)
    expect(isSqliteSourceSafeReadError(busy)).toBe(false)
    expect(isSqliteSourceSafeReadError({ code: 'ERR_SQLITE_ERROR', errcode: 14, errstr: 'unable to open database file' })).toBe(true)
  })

  it('surfaces malformed SQLite instead of turning it into an empty read', () => {
    const testRoot = root('metrora-sqlite-safe-corrupt-')
    const cache = cacheFor(testRoot)
    const sourceDirectory = join(testRoot, 'corrupt-source')
    fs.mkdirSync(sourceDirectory, { recursive: true })
    const sourcePath = join(sourceDirectory, 'source.sqlite')
    fs.writeFileSync(sourcePath, 'not a sqlite database')

    const db = openDatabase(sourcePath)
    expect(() => db.query('SELECT * FROM items')).toThrow()
    db.close()

    expect(snapshotDirectories(cache)).toEqual([])
  })
})
