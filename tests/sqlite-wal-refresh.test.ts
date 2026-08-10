import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRequire } from 'node:module'

import { clearSessionCache, parseAllSessions } from '../src/parser.js'
import { isSqliteAvailable } from '../src/sqlite.js'

const requireForTest = createRequire(import.meta.url)

type Statement = { run(...params: unknown[]): void }
type TestDb = {
  exec(sql: string): void
  prepare(sql: string): Statement
  close(): void
}

function openWalDatabase(path: string): TestDb {
  const { DatabaseSync } = requireForTest('node:sqlite') as {
    DatabaseSync: new (path: string) => TestDb
  }
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode=WAL;')
  db.exec('PRAGMA wal_autocheckpoint=0;')
  db.exec(`
    CREATE TABLE spans (
      span_id        TEXT PRIMARY KEY NOT NULL,
      trace_id       TEXT NOT NULL,
      operation_name TEXT,
      start_time_ms  INTEGER NOT NULL DEFAULT 0,
      response_model TEXT
    );
    CREATE TABLE span_attributes (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      span_id TEXT NOT NULL,
      key     TEXT NOT NULL,
      value   TEXT
    );
  `)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  return db
}

function insertConversation(db: TestDb, ordinal: number): void {
  const spanId = `span-${ordinal}`
  const traceId = `trace-${ordinal}`
  const conversationId = `conversation-${ordinal}`
  const model = 'claude-haiku-4-5-20251001'

  db.prepare(
    `INSERT INTO spans (span_id, trace_id, operation_name, start_time_ms, response_model)
     VALUES (?, ?, ?, ?, ?)`
  ).run(spanId, traceId, 'chat', Date.now() + ordinal, model)

  const insertAttribute = db.prepare(
    'INSERT INTO span_attributes (span_id, key, value) VALUES (?, ?, ?)'
  )
  const attributes: Record<string, string | number> = {
    'gen_ai.conversation.id': conversationId,
    'gen_ai.response.model': model,
    'gen_ai.usage.input_tokens': 1000 * ordinal,
    'gen_ai.usage.output_tokens': 100 * ordinal,
    'gen_ai.usage.cache_read.input_tokens': 10_000 * ordinal,
    'gen_ai.usage.cache_creation.input_tokens': 100 * ordinal,
  }
  for (const [key, value] of Object.entries(attributes)) {
    insertAttribute.run(spanId, key, String(value))
  }
}

function calls(projects: Awaited<ReturnType<typeof parseAllSessions>>) {
  return projects
    .flatMap(project => project.sessions)
    .flatMap(session => session.turns)
    .flatMap(turn => turn.assistantCalls)
}

describe.skipIf(!isSqliteAvailable())('warm SQLite WAL refresh', () => {
  let home: string
  let cache: string
  let dbPath: string
  let db: TestDb | null

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'metrora-wal-home-'))
    cache = await mkdtemp(join(tmpdir(), 'metrora-wal-cache-'))
    dbPath = join(home, 'agent-traces.db')
    db = openWalDatabase(dbPath)

    vi.stubEnv('HOME', home)
    vi.stubEnv('METRORA_CACHE_DIR', cache)
    vi.stubEnv('METRORA_COPILOT_OTEL_DB', dbPath)
    vi.stubEnv('METRORA_COPILOT_DISABLE_OTEL', '')
    vi.stubEnv('METRORA_COPILOT_SESSION_STATE_DIR', join(home, 'no-jsonl'))
    vi.stubEnv('METRORA_COPILOT_WS_STORAGE_DIR', join(home, 'no-workspaces'))
  })

  afterEach(async () => {
    db?.close()
    db = null
    clearSessionCache()
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
    await rm(cache, { recursive: true, force: true })
  })

  it('re-parses committed rows when only agent-traces.db-wal grows', async () => {
    insertConversation(db!, 1)

    const first = calls(await parseAllSessions(undefined, 'copilot'))
    expect(first).toHaveLength(1)

    const mainBefore = await stat(dbPath)
    const walBefore = await stat(`${dbPath}-wal`)

    // Keep the disk cache warm but clear the short-lived process cache.
    clearSessionCache()
    insertConversation(db!, 2)

    const mainAfter = await stat(dbPath)
    const walAfter = await stat(`${dbPath}-wal`)

    // With WAL auto-checkpointing disabled, committed rows land in the WAL while
    // the main database remains unchanged. The fingerprint must still invalidate.
    expect(mainAfter.size).toBe(mainBefore.size)
    expect(mainAfter.mtimeMs).toBe(mainBefore.mtimeMs)
    expect(walAfter.size).toBeGreaterThan(walBefore.size)

    const refreshed = calls(await parseAllSessions(undefined, 'copilot'))
    expect(refreshed).toHaveLength(2)
    // Copilot's OTel parser binds deduplication to the stable span id, while the
    // conversation id scopes the discovered source. Both fresh spans must appear.
    expect(refreshed.map(call => call.deduplicationKey).sort()).toEqual([
      'copilot-otel:span-1',
      'copilot-otel:span-2',
    ])
  })
})
