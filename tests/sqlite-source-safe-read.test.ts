import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  isSqliteAvailable,
  isSqliteBusyError,
  openDatabase,
  type SqliteDatabase,
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
const readers: SqliteDatabase[] = []

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

function openTracked(path: string): SqliteDatabase {
  const db = openDatabase(path)
  readers.push(db)
  return db
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
  try {
    return fs.readdirSync(directory)
      .sort()
      .map(name => [name, fs.readFileSync(join(directory, name)).toString('base64')])
  } catch {
    return []
  }
}

function createWalProducer(directory: string): { path: string; db: TestDatabase } {
  fs.mkdirSync(directory, { recursive: true })
  const path = join(directory, 'source.sqlite')
  const db = new (databaseConstructor())(path)
  producers.push(db)
  db.exec(
    'PRAGMA journal_mode=WAL;\n' +
    'PRAGMA wal_autocheckpoint=0;\n' +
    'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);\n' +
    'PRAGMA wal_checkpoint(TRUNCATE);',
  )
  db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run(1, 'wal-row')
  return { path, db }
}

function createActiveWalSource(testRoot: string): {
  sourcePath: string
  sourceDirectory: string
  producer: TestDatabase
} {
  const sourceDirectory = join(testRoot, 'active-source')
  const producer = createWalProducer(sourceDirectory)
  return { sourcePath: producer.path, sourceDirectory, producer: producer.db }
}

function createCopiedWalSource(testRoot: string): {
  sourcePath: string
  sourceDirectory: string
  producer: TestDatabase
} {
  const producerDirectory = join(testRoot, 'producer-source')
  const sourceDirectory = join(testRoot, 'copied-source')
  const producer = createWalProducer(producerDirectory)
  fs.mkdirSync(sourceDirectory, { recursive: true })
  const sourcePath = join(sourceDirectory, 'source.sqlite')
  fs.copyFileSync(producer.path, sourcePath)
  fs.copyFileSync(producer.path + '-wal', sourcePath + '-wal')
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
  const walBytes = fs.readFileSync(producer.path + '-wal')
  fs.mkdirSync(sourceDirectory, { recursive: true })
  const sourcePath = join(sourceDirectory, 'source.sqlite')
  fs.writeFileSync(sourcePath, initialMain)
  return { sourcePath, sourceDirectory, walBytes, producer: producer.db }
}

function createRollbackSource(
  testRoot: string,
  value = 'rollback-row',
  directoryName = 'rollback-source',
): { sourcePath: string; sourceDirectory: string } {
  const sourceDirectory = join(testRoot, directoryName)
  fs.mkdirSync(sourceDirectory, { recursive: true })
  const sourcePath = join(sourceDirectory, 'source.sqlite')
  const db = new (databaseConstructor())(sourcePath)
  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run(1, value)
  db.close()
  return { sourcePath, sourceDirectory }
}

function createWalModeSourceWithoutLiveWal(
  testRoot: string,
  value: string,
  directoryName: string,
): { sourcePath: string; sourceDirectory: string } {
  const sourceDirectory = join(testRoot, directoryName)
  fs.mkdirSync(sourceDirectory, { recursive: true })
  const sourcePath = join(sourceDirectory, 'source.sqlite')
  const db = new (databaseConstructor())(sourcePath)
  producers.push(db)
  db.exec(
    'PRAGMA journal_mode=WAL;\n' +
    'PRAGMA wal_autocheckpoint=0;\n' +
    'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
  )
  db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run(1, value)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()
  return { sourcePath, sourceDirectory }
}

function replaceSourceFile(sourcePath: string, replacementPath: string): void {
  const temporaryPath = join(
    dirname(sourcePath),
    '.replacement-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2),
  )
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
  const suffix = '.wal-replacement-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2)
  const mainTemporaryPath = sourcePath + suffix
  const walTemporaryPath = sourcePath + '-wal' + suffix
  try {
    fs.copyFileSync(producerPath, mainTemporaryPath)
    fs.copyFileSync(producerPath + '-wal', walTemporaryPath)
    if (process.platform === 'win32') {
      fs.copyFileSync(walTemporaryPath, sourcePath + '-wal')
      fs.copyFileSync(mainTemporaryPath, sourcePath)
    } else {
      fs.renameSync(walTemporaryPath, sourcePath + '-wal')
      fs.renameSync(mainTemporaryPath, sourcePath)
    }
  } finally {
    if (fs.existsSync(mainTemporaryPath)) fs.rmSync(mainTemporaryPath, { force: true })
    if (fs.existsSync(walTemporaryPath)) fs.rmSync(walTemporaryPath, { force: true })
  }
}

afterEach(() => {
  for (const reader of readers.splice(0).reverse()) {
    try { reader.close() } catch { /* fixture cleanup */ }
  }
  for (const producer of producers.splice(0)) {
    try { producer.close() } catch { /* fixture cleanup */ }
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const path of roots.splice(0)) {
    try { fs.rmSync(path, { recursive: true, force: true }) } catch { /* fixture cleanup */ }
  }
})

const sqliteDescribe = isSqliteAvailable() ? describe : describe.skip

sqliteDescribe('shared SQLite source-safe reads', () => {
  it('snapshots an ordinary rollback database and leaves the producer directory unchanged', () => {
    const testRoot = root('metrora-sqlite-safe-rollback-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot)
    const before = directorySnapshot(source.sourceDirectory)

    const db = openTracked(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'rollback-row' }])
    expect(snapshotDirectories(cache)).toHaveLength(1)
    db.close()

    expect(directorySnapshot(source.sourceDirectory)).toEqual(before)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('snapshots committed rows from a live WAL without touching the producer directory', () => {
    const testRoot = root('metrora-sqlite-safe-wal-')
    const cache = cacheFor(testRoot)
    const source = createActiveWalSource(testRoot)
    const before = directorySnapshot(source.sourceDirectory)
    const snapshotCopy = vi.spyOn(fs, 'copyFileSync')

    const db = openTracked(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    expect(snapshotDirectories(cache)).toHaveLength(1)
    expect(snapshotCopy).toHaveBeenCalledTimes(2)
    db.close()

    expect(directorySnapshot(source.sourceDirectory)).toEqual(before)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('reads a WAL with missing SHM from a read-only parent through owned material', () => {
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
      const db = openTracked(source.sourcePath)
      expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
      db.close()
    } finally {
      restorePermissions?.()
    }

    expect(fs.existsSync(source.sourcePath + '-shm')).toBe(false)
    expect(directorySnapshot(source.sourceDirectory)).toEqual(before)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('does not create SHM beside a writable WAL source either', () => {
    const testRoot = root('metrora-sqlite-safe-writable-wal-')
    const cache = cacheFor(testRoot)
    const source = createCopiedWalSource(testRoot)
    const before = directorySnapshot(source.sourceDirectory)

    const db = openTracked(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    db.close()

    expect(fs.existsSync(source.sourcePath + '-shm')).toBe(false)
    expect(directorySnapshot(source.sourceDirectory)).toEqual(before)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('uses a stable owned snapshot for a WAL-mode main file with no live WAL', () => {
    const testRoot = root('metrora-sqlite-safe-wal-main-only-')
    const cache = cacheFor(testRoot)
    const source = createWalModeSourceWithoutLiveWal(testRoot, 'immutable-row', 'wal-main-only')
    const before = directorySnapshot(source.sourceDirectory)

    const db = openTracked(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'immutable-row' }])
    db.close()

    expect(directorySnapshot(source.sourceDirectory)).toEqual(before)
    expect(fs.existsSync(source.sourcePath + '-shm')).toBe(false)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('performs no producer probing or recopying after the snapshot is accepted', () => {
    const testRoot = root('metrora-sqlite-safe-steady-state-')
    const cache = cacheFor(testRoot)
    const source = createActiveWalSource(testRoot)
    const db = openTracked(source.sourcePath)
    const sourceStat = vi.spyOn(fs, 'statSync')
    const sourceOpen = vi.spyOn(fs, 'openSync')
    const sourceCopy = vi.spyOn(fs, 'copyFileSync')

    for (let index = 0; index < 25; index++) {
      expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    }

    expect(sourceStat).not.toHaveBeenCalled()
    expect(sourceOpen).not.toHaveBeenCalled()
    expect(sourceCopy).not.toHaveBeenCalled()
    db.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('retries when a live WAL appears during snapshot copy and never creates source SHM', () => {
    const testRoot = root('metrora-sqlite-safe-wal-during-copy-')
    const cache = cacheFor(testRoot)
    const source = createWalModeMainOnly(testRoot)
    const realCopyFileSync = fs.copyFileSync
    let copyCalls = 0

    vi.spyOn(fs, 'copyFileSync').mockImplementation((from: fs.PathLike, to: fs.PathLike, mode?: number) => {
      const result = realCopyFileSync(from, to, mode)
      copyCalls++
      if (copyCalls === 1) {
        fs.writeFileSync(source.sourcePath + '-wal', source.walBytes)
      }
      return result
    })

    const db = openTracked(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items ORDER BY id')).toEqual([{ value: 'wal-row' }])
    expect(copyCalls).toBeGreaterThanOrEqual(3)
    expect(fs.existsSync(source.sourcePath + '-shm')).toBe(false)
    expect(fs.readdirSync(source.sourceDirectory).sort()).toEqual(['source.sqlite', 'source.sqlite-wal'])
    db.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })
  it('keeps the actual query source-safe when the producer publishes WAL at prepare time', () => {
    const testRoot = root('metrora-sqlite-safe-query-boundary-race-')
    const cache = cacheFor(testRoot)
    const source = createWalModeMainOnly(testRoot, 'query-race-source', 'query-race-producer')
    const db = openTracked(source.sourcePath)
    const DatabaseSync = databaseConstructor()
    const originalPrepare = DatabaseSync.prototype.prepare
    let published = false

    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: TestDatabase, sql: string) {
      if (!published) {
        published = true
        fs.writeFileSync(source.sourcePath + '-wal', source.walBytes)
      }
      return originalPrepare.call(this, sql)
    })

    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([])
    expect(fs.existsSync(source.sourcePath + '-shm')).toBe(false)
    db.close()

    const next = openTracked(source.sourcePath)
    expect(next.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    next.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('closes the immutable stale-read race by fencing a WAL before opening the read view', () => {
    const testRoot = root('metrora-sqlite-safe-immutable-race-')
    const cache = cacheFor(testRoot)
    const source = createWalModeMainOnly(testRoot, 'immutable-race-source', 'immutable-race-producer')
    const realCopyFileSync = fs.copyFileSync
    let copyCalls = 0

    vi.spyOn(fs, 'copyFileSync').mockImplementation((from: fs.PathLike, to: fs.PathLike, mode?: number) => {
      const result = realCopyFileSync(from, to, mode)
      copyCalls++
      if (copyCalls === 1) {
        fs.writeFileSync(source.sourcePath + '-wal', source.walBytes)
      }
      return result
    })

    const db = openTracked(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items ORDER BY id')).toEqual([{ value: 'wal-row' }])
    expect(copyCalls).toBeGreaterThanOrEqual(3)
    expect(fs.existsSync(source.sourcePath + '-shm')).toBe(false)
    db.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('retries a WAL checkpoint that occurs during copy and publishes the post-checkpoint state', () => {
    const testRoot = root('metrora-sqlite-safe-checkpoint-')
    const cache = cacheFor(testRoot)
    const source = createActiveWalSource(testRoot)
    const beforeNames = new Set(fs.readdirSync(source.sourceDirectory))
    const realCopyFileSync = fs.copyFileSync
    let copyCalls = 0

    vi.spyOn(fs, 'copyFileSync').mockImplementation((from: fs.PathLike, to: fs.PathLike, mode?: number) => {
      const result = realCopyFileSync(from, to, mode)
      copyCalls++
      if (copyCalls === 1) {
        source.producer.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      }
      return result
    })

    const db = openTracked(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    expect(copyCalls).toBeGreaterThanOrEqual(2)
    for (const name of fs.readdirSync(source.sourceDirectory)) {
      expect(beforeNames.has(name)).toBe(true)
    }
    db.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('rejects a rollback journal that appears during copy instead of publishing main-only bytes', () => {
    const testRoot = root('metrora-sqlite-safe-journal-during-copy-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot)
    const realCopyFileSync = fs.copyFileSync
    let copyCalls = 0

    vi.spyOn(fs, 'copyFileSync').mockImplementation((from: fs.PathLike, to: fs.PathLike, mode?: number) => {
      const result = realCopyFileSync(from, to, mode)
      copyCalls++
      if (copyCalls === 1) {
        fs.writeFileSync(source.sourcePath + '-journal', Buffer.alloc(512))
      }
      return result
    })

    expect(() => openTracked(source.sourcePath)).toThrow(/rollback journal|source-safe snapshot failed/i)
    expect(copyCalls).toBe(1)
    expect(snapshotDirectories(cache)).toEqual([])
    expect(fs.existsSync(source.sourcePath + '-shm')).toBe(false)
    expect(fs.existsSync(source.sourcePath + '-wal')).toBe(false)
  })

  it('retries source replacement during copy and never publishes the old pair', () => {
    const testRoot = root('metrora-sqlite-safe-replacement-copy-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot, 'old-row', 'replacement-source')
    const replacement = createRollbackSource(testRoot, 'replacement-fixture', 'replacement-target')
    const realCopyFileSync = fs.copyFileSync
    let copyCalls = 0
    let replaced = false

    vi.spyOn(fs, 'copyFileSync').mockImplementation((from: fs.PathLike, to: fs.PathLike, mode?: number) => {
      const result = realCopyFileSync(from, to, mode)
      copyCalls++
      if (copyCalls === 1 && !replaced) {
        replaced = true
        replaceSourceFile(source.sourcePath, replacement.sourcePath)
      }
      return result
    })

    const db = openTracked(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'replacement-fixture' }])
    expect(copyCalls).toBeGreaterThanOrEqual(2)
    db.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('fails clearly when the source disappears during snapshot acquisition', () => {
    const testRoot = root('metrora-sqlite-safe-disappearance-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot)
    const realCopyFileSync = fs.copyFileSync
    let copyCalls = 0

    vi.spyOn(fs, 'copyFileSync').mockImplementation((from: fs.PathLike, to: fs.PathLike, mode?: number) => {
      const result = realCopyFileSync(from, to, mode)
      copyCalls++
      if (copyCalls === 1) fs.unlinkSync(source.sourcePath)
      return result
    })

    expect(() => openDatabase(source.sourcePath)).toThrow(/disappeared|snapshot failed|source changed/i)
    expect(snapshotDirectories(cache)).toEqual([])
    expect(fs.existsSync(source.sourcePath)).toBe(false)
  })

  it('keeps an accepted snapshot stable after pathname rotation and exposes the replacement on the next open', () => {
    const testRoot = root('metrora-sqlite-safe-rotation-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot, 'old-row', 'rotation-source')
    const replacement = createRollbackSource(testRoot, 'new-row', 'rotation-replacement')

    const first = openTracked(source.sourcePath)
    replaceSourceFile(source.sourcePath, replacement.sourcePath)
    expect(first.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'old-row' }])
    first.close()

    const second = openTracked(source.sourcePath)
    expect(second.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'new-row' }])
    second.close()

    expect(fs.existsSync(source.sourcePath + '-shm')).toBe(false)
    expect(fs.existsSync(source.sourcePath + '-wal')).toBe(false)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('keeps an accepted WAL-mode snapshot stable after immutable-path rotation', () => {
    const testRoot = root('metrora-sqlite-safe-immutable-rotation-')
    const cache = cacheFor(testRoot)
    const source = createWalModeSourceWithoutLiveWal(testRoot, 'old-row', 'immutable-rotation-source')
    const replacement = createWalModeSourceWithoutLiveWal(testRoot, 'new-row', 'immutable-rotation-replacement')

    const first = openTracked(source.sourcePath)
    replaceSourceFile(source.sourcePath, replacement.sourcePath)
    expect(first.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'old-row' }])
    first.close()

    const second = openTracked(source.sourcePath)
    expect(second.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'new-row' }])
    second.close()

    expect(fs.existsSync(source.sourcePath + '-shm')).toBe(false)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('does not serve a deleted producer inode as a fresh view', () => {
    const testRoot = root('metrora-sqlite-safe-disappeared-after-open-')
    const source = createRollbackSource(testRoot)
    const db = openTracked(source.sourcePath)

    fs.unlinkSync(source.sourcePath)
    expect(db.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'rollback-row' }])
    db.close()
  })

  it('makes rollback-to-WAL changes visible only to the next open', () => {
    const testRoot = root('metrora-sqlite-safe-rollback-to-wal-')
    const cache = cacheFor(testRoot)
    const source = createRollbackSource(testRoot, 'rollback-row', 'rollback-to-wal-source')
    const producer = createActiveWalSource(testRoot)
    const first = openTracked(source.sourcePath)

    publishWalPair(source.sourcePath, producer.sourcePath)
    expect(first.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'rollback-row' }])
    first.close()

    const second = openTracked(source.sourcePath)
    expect(second.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    second.close()

    expect(fs.existsSync(source.sourcePath + '-shm')).toBe(false)
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('keeps concurrent owned snapshots collision-free and cleans them on close', () => {
    const testRoot = root('metrora-sqlite-safe-concurrent-')
    const cache = cacheFor(testRoot)
    const source = createActiveWalSource(testRoot)
    const readersForTest = Array.from({ length: 4 }, () => openTracked(source.sourcePath))

    const directories = snapshotDirectories(cache)
    expect(directories).toHaveLength(4)
    expect(new Set(directories).size).toBe(4)
    for (const reader of readersForTest) {
      expect(reader.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
      reader.close()
    }

    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('does not reclaim an active snapshot merely because its directory is old', () => {
    const testRoot = root('metrora-sqlite-safe-active-owner-')
    const cache = cacheFor(testRoot)
    const source = createActiveWalSource(testRoot)
    const first = openTracked(source.sourcePath)
    const firstDirectory = join(cache, 'sqlite-source-snapshots', snapshotDirectories(cache)[0])
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    fs.utimesSync(firstDirectory, old, old)

    const second = openTracked(source.sourcePath)
    expect(snapshotDirectories(cache)).toHaveLength(2)
    expect(fs.existsSync(firstDirectory)).toBe(true)
    expect(first.query<{ value: string }>('SELECT value FROM items')).toEqual([{ value: 'wal-row' }])
    second.close()
    expect(fs.existsSync(firstDirectory)).toBe(true)
    first.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('reclaims dead stale material but retains ambiguous ownership', () => {
    const testRoot = root('metrora-sqlite-safe-owner-cleanup-')
    const cache = cacheFor(testRoot)
    const snapshotRoot = join(cache, 'sqlite-source-snapshots')
    const stale = join(snapshotRoot, 'sqlite-source-read-stale')
    const ambiguous = join(snapshotRoot, 'sqlite-source-read-ambiguous')
    fs.mkdirSync(stale, { recursive: true })
    fs.mkdirSync(ambiguous, { recursive: true })
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    fs.utimesSync(stale, old, old)
    fs.utimesSync(ambiguous, old, old)
    fs.writeFileSync(
      join(stale, '.owner.json'),
      JSON.stringify({ pid: Number.MAX_SAFE_INTEGER, token: 'abandoned', createdAtMs: old.getTime() }),
    )
    fs.utimesSync(stale, old, old)
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('owner is gone'), { code: 'ESRCH' })
    })

    const source = createActiveWalSource(testRoot)
    const db = openTracked(source.sourcePath)
    expect(fs.existsSync(stale)).toBe(false)
    expect(fs.existsSync(ambiguous)).toBe(true)
    db.close()
    expect(fs.existsSync(ambiguous)).toBe(true)
  })

  it('retains a snapshot when cleanup is called with the wrong owner token', async () => {
    const testRoot = root('metrora-sqlite-safe-owner-token-')
    const cache = cacheFor(testRoot)
    const source = createActiveWalSource(testRoot)
    const db = openTracked(source.sourcePath)
    const directory = join(cache, 'sqlite-source-snapshots', snapshotDirectories(cache)[0])
    const ownership = await import('../src/sqlite-snapshot-ownership.js')

    ownership.cleanupSnapshotDirectory(directory, 'sqlite-source-read-', 'wrong-token')
    expect(fs.existsSync(directory)).toBe(true)
    db.close()
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('does not turn SQL/schema errors into fake provider absence', () => {
    const testRoot = root('metrora-sqlite-safe-errors-')
    const source = createRollbackSource(testRoot)
    const db = openTracked(source.sourcePath)

    expect(() => db.query('SELECT * FROM missing_table')).toThrow(/no such table/i)
    db.close()

    expect(isSqliteBusyError({ code: 'SQLITE_BUSY' })).toBe(true)
    expect(isSqliteBusyError({ code: 'SQLITE_LOCKED' })).toBe(true)
    expect(isSqliteBusyError({ errcode: 14, errstr: 'unable to open database file' })).toBe(false)
  })

  it('surfaces malformed SQLite instead of returning an empty result', () => {
    const testRoot = root('metrora-sqlite-safe-corrupt-')
    const cache = cacheFor(testRoot)
    const sourceDirectory = join(testRoot, 'corrupt-source')
    fs.mkdirSync(sourceDirectory, { recursive: true })
    const sourcePath = join(sourceDirectory, 'source.sqlite')
    fs.writeFileSync(sourcePath, 'not a sqlite database')

    let db: SqliteDatabase | undefined
    try {
      db = openTracked(sourcePath)
      expect(() => db.query('SELECT * FROM items')).toThrow()
    } catch (err) {
      expect(String(err)).toMatch(/SQLite|database|snapshot|not/i)
    } finally {
      db?.close()
    }
    expect(snapshotDirectories(cache)).toEqual([])
  })

  it('fails clearly for a source that is absent before acquisition', () => {
    const testRoot = root('metrora-sqlite-safe-missing-')
    const cache = cacheFor(testRoot)
    const sourcePath = join(testRoot, 'missing', 'source.sqlite')
    expect(() => openDatabase(sourcePath)).toThrow(/disappeared|snapshot|unavailable/i)
    expect(snapshotDirectories(cache)).toEqual([])
  })
})
