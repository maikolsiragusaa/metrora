import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { clearSessionCache, parseAllSessions } from '../src/parser.js'
import { isSqliteAvailable } from '../src/sqlite.js'

type TestDb = {
  exec(sql: string): void
  prepare(sql: string): { run(...params: unknown[]): void }
  close(): void
}

const skipUnlessSqlite = isSqliteAvailable() ? describe : describe.skip

function createDb(dbPath: string): void {
  mkdirSync(join(dbPath, '..'), { recursive: true })
  const { DatabaseSync: Database } = require('node:sqlite')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT,
      slug TEXT NOT NULL, directory TEXT NOT NULL, title TEXT NOT NULL,
      version TEXT NOT NULL, time_created INTEGER, time_updated INTEGER,
      time_archived INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      time_created INTEGER, time_updated INTEGER, data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
      session_id TEXT NOT NULL, time_created INTEGER,
      time_updated INTEGER, data TEXT NOT NULL
    )
  `)
  db.close()
}

function withDb(dbPath: string, fn: (db: TestDb) => void): void {
  const { DatabaseSync: Database } = require('node:sqlite')
  const db = new Database(dbPath)
  fn(db)
  db.close()
}

function insertCall(db: TestDb, sessionId: string, messageId: string, timeCreated: number): void {
  db.prepare(`
    INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
  `).run(sessionId, 'project', sessionId, '/tmp/opencode-union', 'Union fixture', '1.0', timeCreated)
  db.prepare(`
    INSERT INTO message (id, session_id, time_created, data)
    VALUES (?, ?, ?, ?)
  `).run(messageId, sessionId, timeCreated, JSON.stringify({
    role: 'assistant',
    providerID: 'openai',
    modelID: 'gpt-4o-mini',
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
  }))
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(`${messageId}-part`, messageId, sessionId, timeCreated, JSON.stringify({ type: 'text', text: 'ok' }))
}

function deleteCall(db: TestDb, sessionId: string, messageId: string): void {
  db.prepare('DELETE FROM part WHERE message_id = ?').run(messageId)
  db.prepare('DELETE FROM message WHERE id = ?').run(messageId)
  db.prepare('DELETE FROM session WHERE id = ?').run(sessionId)
}

function callKeys(projects: Awaited<ReturnType<typeof parseAllSessions>>): string[] {
  return projects
    .flatMap(project => project.sessions)
    .flatMap(session => session.turns)
    .flatMap(turn => turn.assistantCalls)
    .map(call => call.deduplicationKey)
    .sort()
}

skipUnlessSqlite('OpenCode source union cache authority', () => {
  it('unions standalone and owned stores, deduplicates overlap, and retains overlap when a sibling disappears', async () => {
    const root = mkdtempSync(join(tmpdir(), 'metrora-opencode-union-'))
    const cacheDir = join(root, 'cache')
    const primaryDir = join(root, 'standalone')
    const extraDir = join(root, 'owned')
    const primaryDb = join(primaryDir, 'opencode.db')
    const extraDb = join(extraDir, 'opencode.db')

    try {
      createDb(primaryDb)
      createDb(extraDb)
      withDb(primaryDb, db => {
        insertCall(db, 'shared-session', 'shared-message', 1_700_000_000_000)
        insertCall(db, 'primary-session', 'primary-message', 1_700_000_001_000)
      })
      withDb(extraDb, db => {
        insertCall(db, 'shared-session', 'shared-message', 1_700_000_000_000)
        insertCall(db, 'extra-session', 'extra-message', 1_700_002_000_000)
      })

      process.env.METRORA_CACHE_DIR = cacheDir
      process.env.OPENCODE_DATA_DIR = primaryDir
      process.env.METRORA_OPENCODE_EXTRA_DATA_DIRS = JSON.stringify([extraDir])

      const primaryBefore = statSync(primaryDb)
      const extraBefore = statSync(extraDb)

      clearSessionCache()
      const initial = await parseAllSessions(undefined, 'opencode')
      expect(callKeys(initial)).toEqual([
        'opencode:extra-session:extra-message',
        'opencode:primary-session:primary-message',
        'opencode:shared-session:shared-message',
      ])
      expect(statSync(primaryDb)).toMatchObject({ size: primaryBefore.size, mtimeMs: primaryBefore.mtimeMs })
      expect(statSync(extraDb)).toMatchObject({ size: extraBefore.size, mtimeMs: extraBefore.mtimeMs })

      // Clear the process-local result cache so the next pass must use the
      // persisted source cache, matching a Desktop/CLI process restart.
      clearSessionCache()
      const diskCacheReuse = await parseAllSessions(undefined, 'opencode')
      expect(callKeys(diskCacheReuse)).toHaveLength(3)

      // Change only the standalone store. Its refreshed cache must retain the
      // shared logical message even though the owned store is still unchanged.
      withDb(primaryDb, db => insertCall(db, 'primary-new-session', 'primary-new-message', 1_700_000_003_000))
      clearSessionCache()
      const afterPrimaryChange = await parseAllSessions(undefined, 'opencode')
      expect(callKeys(afterPrimaryChange)).toHaveLength(4)

      // The owned store can add a genuinely new session after the import.
      withDb(extraDb, db => insertCall(db, 'extra-new-session', 'extra-new-message', 1_700_000_004_000))
      clearSessionCache()
      const afterOwnedChange = await parseAllSessions(undefined, 'opencode')
      expect(callKeys(afterOwnedChange)).toHaveLength(5)

      // Remove the owned source. The retained standalone cache must still
      // account for the overlap; old shared-dedup cache authority lost it here.
      rmSync(extraDir, { recursive: true, force: true })
      clearSessionCache()
      const afterOwnedRemoval = await parseAllSessions(undefined, 'opencode')
      expect(callKeys(afterOwnedRemoval)).toEqual([
        'opencode:primary-new-session:primary-new-message',
        'opencode:primary-session:primary-message',
        'opencode:shared-session:shared-message',
      ])

      // A source mutation is still read-only from the collector's perspective.
      expect(statSync(primaryDb)).toMatchObject({ size: expect.any(Number), mtimeMs: expect.any(Number) })
    } finally {
      clearSessionCache()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('discovers a Metrora-Code-only root under the canonical opencode identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'metrora-opencode-owned-only-'))
    const ownedDir = join(root, 'owned')
    const ownedDb = join(ownedDir, 'opencode.db')
    try {
      createDb(ownedDb)
      withDb(ownedDb, db => insertCall(db, 'owned-only-session', 'owned-only-message', 1_700_000_000_000))
      process.env.OPENCODE_DATA_DIR = join(root, 'no-standalone-store')
      process.env.METRORA_OPENCODE_EXTRA_DATA_DIRS = JSON.stringify([ownedDir])

      const provider = (await import('../src/providers/opencode.js')).createOpenCodeProvider()
      const sessions = await provider.discoverSessions()
      expect(sessions).toEqual([{
        path: `${ownedDb}:owned-only-session`,
        project: 'tmp-opencode-union',
        provider: 'opencode',
      }])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignores malformed or relative additive roots without widening discovery', async () => {
    const root = mkdtempSync(join(tmpdir(), 'metrora-opencode-union-roots-'))
    const primaryDir = join(root, 'primary')
    const primaryDb = join(primaryDir, 'opencode.db')
    try {
      createDb(primaryDb)
      withDb(primaryDb, db => insertCall(db, 'primary-session', 'primary-message', 1_700_000_000_000))
      process.env.OPENCODE_DATA_DIR = primaryDir
      process.env.METRORA_OPENCODE_EXTRA_DATA_DIRS = JSON.stringify(['relative/path', 'not-json-root'])
      const provider = (await import('../src/providers/opencode.js')).createOpenCodeProvider()
      const sessions = await provider.discoverSessions()
      expect(sessions.map(session => session.path)).toEqual([`${primaryDb}:primary-session`])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
