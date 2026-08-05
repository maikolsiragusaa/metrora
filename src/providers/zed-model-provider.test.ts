import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'

import { isSqliteAvailable } from '../sqlite.js'
import { createZedProvider } from './zed.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function createThreadsDb(path: string, provider: unknown): void {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      summary TEXT,
      updated_at TEXT,
      data_type TEXT,
      data BLOB
    )
  `)
  const payload = JSON.stringify({
    model: { provider, model: 'claude-sonnet-4-6' },
    request_token_usage: {
      request_1: { input_tokens: 100, output_tokens: 20 },
    },
    cumulative_token_usage: { input_tokens: 100, output_tokens: 20 },
  })
  db.prepare('INSERT INTO threads (id, summary, updated_at, data_type, data) VALUES (?, ?, ?, ?, ?)')
    .run('thread-1', 'fixture', '2026-07-31T18:00:00.000Z', 'json', Buffer.from(payload))
  db.close()
}

const sqliteDescribe = isSqliteAvailable() ? describe : describe.skip

sqliteDescribe('Zed model provider provenance', () => {
  it('preserves an explicit provider recorded by Zed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'metrora-zed-provider-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'threads.db')
    createThreadsDb(dbPath, 'Anthropic')

    const provider = createZedProvider(dbPath)
    const [source] = await provider.discoverSessions()
    expect(source).toBeDefined()

    const calls = []
    for await (const call of provider.createSessionParser(source!, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.provider).toBe('zed')
    expect(calls[0]!.model).toBe('claude-sonnet-4-6')
    expect(calls[0]!.modelProvider).toBe('anthropic')
  })

  it('omits malformed provider claims instead of inferring one from the model', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'metrora-zed-provider-invalid-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'threads.db')
    createThreadsDb(dbPath, 'anthropic/claude')

    const provider = createZedProvider(dbPath)
    const [source] = await provider.discoverSessions()
    const calls = []
    for await (const call of provider.createSessionParser(source!, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.modelProvider).toBeUndefined()
  })
})
