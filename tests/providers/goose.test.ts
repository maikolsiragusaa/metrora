import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'node:module'

import { createGooseProvider } from '../../src/providers/goose.js'
import { isSqliteAvailable } from '../../src/sqlite.js'

const requireForTest = createRequire(import.meta.url)

type TestDb = {
  exec(sql: string): void
  prepare(sql: string): { run(...params: unknown[]): void }
  close(): void
}

let root: string
let previousRoot: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'goose-test-'))
  previousRoot = process.env['GOOSE_PATH_ROOT']
  process.env['GOOSE_PATH_ROOT'] = root
})

afterEach(async () => {
  if (previousRoot === undefined) delete process.env['GOOSE_PATH_ROOT']
  else process.env['GOOSE_PATH_ROOT'] = previousRoot
  await rm(root, { recursive: true, force: true })
})

describe('goose provider', () => {
  it('retains the session billing provider', async () => {
    if (!isSqliteAvailable()) return

    const dbPath = join(root, 'data', 'sessions', 'sessions.db')
    await mkdir(join(root, 'data', 'sessions'), { recursive: true })
    const { DatabaseSync } = requireForTest('node:sqlite') as { DatabaseSync: new (path: string) => TestDb }
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        working_dir TEXT,
        created_at TEXT,
        updated_at TEXT,
        accumulated_input_tokens INTEGER,
        accumulated_output_tokens INTEGER,
        provider_name TEXT,
        model_config_json TEXT
      );
      CREATE TABLE messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT,
        role TEXT,
        content_json TEXT,
        created_timestamp INTEGER
      );
    `)
    db.prepare(`
      INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-1', 'Goose test', '/Users/test/project',
      '2026-06-03T10:00:00.000Z', '2026-06-03T10:01:00.000Z',
      100, 20, 'OpenAI-Codex', JSON.stringify({ model_name: 'gpt-5.4' }),
    )
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(
      'message-1', 'session-1', 'user', JSON.stringify([{ type: 'text', text: 'hello' }]), 1,
    )
    db.close()

    const provider = createGooseProvider()
    const sources = await provider.discoverSessions()
    expect(sources).toHaveLength(1)
    const calls: any[] = []
    for await (const call of provider.createSessionParser(sources[0]!, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0].modelProvider).toBe('openai-codex')
  })
})
