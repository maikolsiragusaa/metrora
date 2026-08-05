import { afterEach, describe, expect, it } from 'vitest'
import { appendFile, mkdir, rm, truncate, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  fingerprintSourceFile,
  isSQLiteSourcePath,
  sourcePathCandidates,
  type SourceStat,
} from '../src/sqlite-source-fingerprint.js'
import {
  fingerprintFile,
  reconcileFile,
  type CachedFile,
  type FileFingerprint,
} from '../src/session-cache.js'

const roots: string[] = []

async function root(): Promise<string> {
  const path = join(tmpdir(), `metrora-sqlite-fp-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(path, { recursive: true })
  roots.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function cached(fingerprint: FileFingerprint, lastCompleteLineOffset?: number): CachedFile {
  return {
    fingerprint,
    ...(lastCompleteLineOffset === undefined ? {} : { lastCompleteLineOffset }),
    mcpInventory: [],
    turns: [],
  }
}

describe('SQLite source path authority', () => {
  it.each(['usage.db', 'usage.sqlite', 'usage.sqlite3', 'state.vscdb'])(
    'recognizes %s as SQLite',
    path => expect(isSQLiteSourcePath(path)).toBe(true),
  )

  it('does not classify arbitrary append-only sources as SQLite', () => {
    expect(isSQLiteSourcePath('events.jsonl')).toBe(false)
    expect(isSQLiteSourcePath('events.jsonl-wal')).toBe(false)
  })

  it('preserves Windows drive letters while stripping a virtual colon suffix', () => {
    expect(sourcePathCandidates('C:\\Users\\me\\state.db')).toEqual([
      'C:\\Users\\me\\state.db',
    ])
    expect(sourcePathCandidates('C:\\Users\\me\\state.db:session-1')).toEqual([
      'C:\\Users\\me\\state.db:session-1',
      'C:\\Users\\me\\state.db',
    ])
    expect(sourcePathCandidates('C:/Users/me/state.sqlite3:session-2')).toEqual([
      'C:/Users/me/state.sqlite3:session-2',
      'C:/Users/me/state.sqlite3',
    ])
  })
})

describe('SQLite WAL-aware fingerprints', () => {
  it('preserves the previous main-file fingerprint when the WAL is absent', async () => {
    const dir = await root()
    const db = join(dir, 'usage.db')
    await writeFile(db, Buffer.alloc(32, 1))

    const direct = await fingerprintSourceFile(db)
    const publicAuthority = await fingerprintFile(db)

    expect(direct).toEqual(publicAuthority)
    expect(direct?.sizeBytes).toBe(32)
    expect(direct?.sqliteWal).toBeUndefined()
  })

  it('changes when the main file is unchanged and the WAL grows', async () => {
    const dir = await root()
    const db = join(dir, 'usage.sqlite')
    const wal = `${db}-wal`
    await writeFile(db, Buffer.alloc(64, 1))
    await writeFile(wal, Buffer.alloc(16, 2))

    const before = await fingerprintSourceFile(db)
    await appendFile(wal, Buffer.alloc(24, 3))
    const after = await fingerprintSourceFile(db)

    expect(before?.sizeBytes).toBe(80)
    expect(after?.sizeBytes).toBe(104)
    expect(before?.sqliteWal?.sizeBytes).toBe(16)
    expect(after?.sqliteWal?.sizeBytes).toBe(40)
    expect(after).not.toEqual(before)
  })

  it('detects checkpoint movement and WAL truncation even when aggregate fields collide', async () => {
    const dir = await root()
    const db = join(dir, 'usage.sqlite3')
    const wal = `${db}-wal`
    const fixed = new Date('2026-08-05T00:00:00.000Z')

    await writeFile(db, Buffer.alloc(100, 1))
    await writeFile(wal, Buffer.alloc(50, 2))
    await utimes(db, fixed, fixed)
    await utimes(wal, fixed, fixed)
    const before = await fingerprintSourceFile(db)

    await writeFile(db, Buffer.alloc(150, 3))
    await truncate(wal, 0)
    await utimes(db, fixed, fixed)
    await utimes(wal, fixed, fixed)
    const after = await fingerprintSourceFile(db)

    expect(before?.mtimeMs).toBe(after?.mtimeMs)
    expect(before?.sizeBytes).toBe(after?.sizeBytes)
    expect(before?.sqliteWal?.sizeBytes).toBe(50)
    expect(after?.sqliteWal?.sizeBytes).toBe(0)
    expect(reconcileFile(after!, cached(before!))).toEqual({ action: 'modified' })
  })

  it('detects WAL removal after checkpoint', async () => {
    const dir = await root()
    const db = join(dir, 'usage.db')
    const wal = `${db}-wal`
    const fixed = new Date('2026-08-05T00:00:00.000Z')

    await writeFile(db, Buffer.alloc(100, 1))
    await writeFile(wal, Buffer.alloc(50, 2))
    await utimes(db, fixed, fixed)
    await utimes(wal, fixed, fixed)
    const before = await fingerprintSourceFile(db)

    await writeFile(db, Buffer.alloc(150, 3))
    await rm(wal)
    await utimes(db, fixed, fixed)
    const after = await fingerprintSourceFile(db)

    expect(before?.sizeBytes).toBe(after?.sizeBytes)
    expect(before?.sqliteWal).toBeDefined()
    expect(after?.sqliteWal).toBeUndefined()
    expect(reconcileFile(after!, cached(before!))).toEqual({ action: 'modified' })
  })

  it('ignores SHM-only mutation', async () => {
    const dir = await root()
    const db = join(dir, 'usage.db')
    const shm = `${db}-shm`
    await writeFile(db, Buffer.alloc(64, 1))
    await writeFile(shm, Buffer.alloc(16, 2))

    const before = await fingerprintSourceFile(db)
    await appendFile(shm, Buffer.alloc(64, 3))
    const after = await fingerprintSourceFile(db)

    expect(after).toEqual(before)
  })

  it('does not fold an arbitrary -wal sibling into a JSONL fingerprint', async () => {
    const dir = await root()
    const source = join(dir, 'events.jsonl')
    await writeFile(source, 'one\n')
    await writeFile(`${source}-wal`, Buffer.alloc(32, 1))

    const before = await fingerprintSourceFile(source)
    await appendFile(`${source}-wal`, Buffer.alloc(32, 2))
    const after = await fingerprintSourceFile(source)

    expect(after).toEqual(before)
    expect(after?.sizeBytes).toBe(4)
  })

  it.each([
    (path: string) => `${path}#cursor-ws=workspace-a`,
    (path: string) => `${path}:session-a`,
  ])('resolves virtual suffixes before locating the WAL', async virtualize => {
    const dir = await root()
    const db = join(dir, 'state.db')
    await writeFile(db, Buffer.alloc(20, 1))
    await writeFile(`${db}-wal`, Buffer.alloc(12, 2))

    const fingerprint = await fingerprintSourceFile(virtualize(db))
    expect(fingerprint?.sizeBytes).toBe(32)
    expect(fingerprint?.sqliteWal?.sizeBytes).toBe(12)
  })

  it('turns a disappearing main file between stat operations into a skipped source', async () => {
    let mainStats = 0
    const fakeStat: SourceStat = async path => {
      if (path.endsWith('-wal')) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      mainStats++
      if (mainStats === 1) return { dev: 1, ino: 2, mtimeMs: 3, size: 4 }
      throw Object.assign(new Error('rotated'), { code: 'ENOENT' })
    }

    expect(await fingerprintSourceFile('/tmp/racy.db', fakeStat)).toBeNull()
  })

  it('treats a WAL disappearing during fingerprinting as an absent WAL, not a failure', async () => {
    let walStats = 0
    const fakeStat: SourceStat = async path => {
      if (path.endsWith('-wal')) {
        walStats++
        throw Object.assign(new Error(`wal missing ${walStats}`), { code: 'ENOENT' })
      }
      return { dev: 1, ino: 2, mtimeMs: 3, size: 4 }
    }

    expect(await fingerprintSourceFile('/tmp/racy.db', fakeStat)).toEqual({
      dev: 1,
      ino: 2,
      mtimeMs: 3,
      sizeBytes: 4,
    })
  })
})

describe('reconciliation compatibility', () => {
  it('naturally invalidates a warm main-only SQLite cache when a WAL exists', async () => {
    const dir = await root()
    const db = join(dir, 'warm.db')
    await writeFile(db, Buffer.alloc(40, 1))
    const legacyMainOnly = await fingerprintSourceFile(db)

    await writeFile(`${db}-wal`, Buffer.alloc(8, 2))
    const current = await fingerprintSourceFile(db)

    expect(legacyMainOnly?.sqliteWal).toBeUndefined()
    expect(current?.sqliteWal).toBeDefined()
    expect(reconcileFile(current!, cached(legacyMainOnly!))).toEqual({ action: 'modified' })
  })

  it('preserves JSONL append detection and offsets exactly', async () => {
    const dir = await root()
    const jsonl = join(dir, 'events.jsonl')
    await writeFile(jsonl, 'one\n')
    const before = await fingerprintSourceFile(jsonl)
    await appendFile(jsonl, 'two\n')
    const after = await fingerprintSourceFile(jsonl)

    expect(reconcileFile(after!, cached(before!, 4))).toEqual({
      action: 'appended',
      readFromOffset: 4,
    })
  })
})
