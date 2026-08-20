import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'node:module'

import { getDailyCacheConfigHash } from '../src/daily-cache-config.js'
import { parseAllSessions, clearSessionCache } from '../src/parser.js'
import { isSqliteAvailable } from '../src/sqlite.js'
import { loadCache, saveCache, PROVIDER_PARSE_VERSIONS } from '../src/session-cache.js'

const requireForTest = createRequire(import.meta.url)

type TestDb = {
  exec(sql: string): void
  prepare(sql: string): { run(...params: unknown[]): void }
  close(): void
}

function createOtelDb(dbPath: string): void {
  const { DatabaseSync } = requireForTest('node:sqlite') as { DatabaseSync: new (path: string) => TestDb }
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE spans (
      span_id TEXT PRIMARY KEY NOT NULL,
      trace_id TEXT NOT NULL,
      operation_name TEXT,
      start_time_ms INTEGER NOT NULL DEFAULT 0,
      response_model TEXT
    );
    CREATE TABLE span_attributes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      span_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT
    );
  `)
  db.close()
}

function insertChatSpan(dbPath: string): void {
  const { DatabaseSync } = requireForTest('node:sqlite') as { DatabaseSync: new (path: string) => TestDb }
  const db = new DatabaseSync(dbPath)
  db.prepare(
    `INSERT INTO spans (span_id, trace_id, operation_name, start_time_ms, response_model)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('span-history', 'trace-history', 'chat', Date.now() - 60_000, null)
  const attrs: Record<string, number | string> = {
    'gen_ai.conversation.id': 'conversation-history',
    'gen_ai.response.model': 'gpt-4.1',
    'gen_ai.usage.input_tokens': 1000,
    'gen_ai.usage.output_tokens': 100,
    'gen_ai.usage.cache_read.input_tokens': 300,
    'gen_ai.usage.cache_creation.input_tokens': 200,
    'gen_ai.usage.reasoning.output_tokens': 20,
  }
  const attrStmt = db.prepare(`INSERT INTO span_attributes (span_id, key, value) VALUES (?, ?, ?)`)
  for (const [key, value] of Object.entries(attrs)) attrStmt.run('span-history', key, String(value))
  db.close()
}

describe('Copilot OTel history migration policy', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(async () => {
    clearSessionCache()
    tempDir = await mkdtemp(join(tmpdir(), 'metrora-copilot-otel-history-'))
    dbPath = join(tempDir, 'agent-traces.db')
    vi.stubEnv('METRORA_CACHE_DIR', join(tempDir, 'metrora-cache'))
    vi.stubEnv('METRORA_COPILOT_OTEL_DB', dbPath)
    vi.stubEnv('METRORA_COPILOT_DISABLE_OTEL', '')
    vi.stubEnv('METRORA_COPILOT_SESSION_STATE_DIR', join(tempDir, 'missing-session-state'))
    vi.stubEnv('METRORA_COPILOT_WS_STORAGE_DIR', join(tempDir, 'missing-workspace-storage'))
    vi.stubEnv('METRORA_COPILOT_GLOBAL_STORAGE_DIR', join(tempDir, 'missing-global-storage'))
    vi.stubEnv('METRORA_COPILOT_JETBRAINS_DIR', join(tempDir, 'missing-jetbrains'))
  })

  afterEach(async () => {
    clearSessionCache()
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  function firstCall(projects: Awaited<ReturnType<typeof parseAllSessions>>) {
    const call = projects.flatMap(project => project.sessions.flatMap(session => session.turns.flatMap(turn => turn.assistantCalls)))[0]
    if (!call) throw new Error('Expected one synthetic Copilot call')
    return call
  }

  async function parseSyntheticSource() {
    createOtelDb(dbPath)
    insertChatSpan(dbPath)
    return parseAllSessions(undefined, 'copilot')
  }

  it('reparses a surviving OTel source when Copilot parse authority changes', async () => {
    if (!isSqliteAvailable()) return

    const initial = await parseSyntheticSource()
    expect(firstCall(initial).usage).toMatchObject({ inputTokens: 500, cacheReadInputTokens: 300, cacheCreationInputTokens: 200 })

    const cache = await loadCache()
    const cached = cache.providers.copilot?.files[dbPath]?.turns[0]?.calls[0]
    if (!cached) throw new Error('Expected the synthetic OTel call in session cache')
    cached.usage.inputTokens = 1000
    delete cached.cacheTokenEvidence
    delete cached.reasoningSemantics
    delete cached.costAssignment
    await saveCache(cache)

    const authority = PROVIDER_PARSE_VERSIONS.copilot
    try {
      PROVIDER_PARSE_VERSIONS.copilot = authority + '-test-reparse'
      clearSessionCache()
      const reparsed = await parseAllSessions(undefined, 'copilot')
      const call = firstCall(reparsed)
      expect(call.usage.inputTokens).toBe(500)
      expect(call.usage.cacheReadInputTokens).toBe(300)
      expect(call.usage.cacheCreationInputTokens).toBe(200)
      expect(call.reasoningSemantics).toBe('aggregate-output')
    } finally {
      PROVIDER_PARSE_VERSIONS.copilot = authority
    }
  })

  it('changes the daily cache hash with the Copilot provider authority only', () => {
    const authority = PROVIDER_PARSE_VERSIONS.copilot
    const before = getDailyCacheConfigHash()
    try {
      PROVIDER_PARSE_VERSIONS.copilot = authority + '-test-daily-hash'
      expect(getDailyCacheConfigHash()).not.toBe(before)
    } finally {
      PROVIDER_PARSE_VERSIONS.copilot = authority
    }
  })

  it('preserves durable-cache-only history and does not fabricate discarded reasoning after restart', async () => {
    if (!isSqliteAvailable()) return

    await parseSyntheticSource()
    const cache = await loadCache()
    const cached = cache.providers.copilot?.files[dbPath]?.turns[0]?.calls[0]
    if (!cached) throw new Error('Expected the synthetic OTel call in session cache')
    cached.usage.inputTokens = 1000
    cached.usage.reasoningTokens = 0
    delete cached.reasoningSemantics
    delete cached.cacheTokenEvidence
    delete cached.costAssignment
    await saveCache(cache)

    await rm(dbPath, { force: true })
    clearSessionCache()
    const afterRestart = await parseAllSessions(undefined, 'copilot')
    const carried = firstCall(afterRestart)
    expect(carried.usage.inputTokens).toBe(500)
    expect(carried.cacheTokenEvidence).toBe('complete')
    expect(carried.usage.reasoningTokens).toBe(0)
    expect(carried.reasoningSemantics).toBeUndefined()
    expect(afterRestart.length).toBeGreaterThan(0)
    const partialCache = await loadCache()
    const partial = partialCache.providers.copilot?.files[dbPath]?.turns[0]?.calls[0]
    if (!partial) throw new Error('Expected carried OTel call for partial-evidence check')
    partial.usage.inputTokens = 1000
    partial.usage.cacheReadInputTokens = 300
    partial.usage.cacheCreationInputTokens = 0
    delete partial.reasoningSemantics
    delete partial.cacheTokenEvidence
    delete partial.costUSD
    delete partial.costAssignment
    delete partial.legacyCostUSD
    await saveCache(partialCache)
    clearSessionCache()
    const partialAfterRestart = await parseAllSessions(undefined, 'copilot')
    const partialCall = firstCall(partialAfterRestart)
    expect(partialCall.usage.inputTokens).toBe(1000)
    expect(partialCall.cacheTokenEvidence).toBeUndefined()
  })

  it('retains durable OTel calls when an authority-triggered raw reparse fails', async () => {
    if (!isSqliteAvailable()) return

    await parseSyntheticSource()
    const authority = PROVIDER_PARSE_VERSIONS.copilot
    await writeFile(dbPath, 'not a sqlite database')
    try {
      PROVIDER_PARSE_VERSIONS.copilot = authority + '-test-failed-reparse'
      clearSessionCache()
      const afterFailure = await parseAllSessions(undefined, 'copilot')
      const carried = firstCall(afterFailure)
      expect(carried.usage.inputTokens).toBe(500)
      expect(carried.usage.cacheReadInputTokens).toBe(300)
      expect(carried.usage.cacheCreationInputTokens).toBe(200)
      expect(carried.reasoningSemantics).toBe('aggregate-output')
      const failedCache = await loadCache()
      expect(failedCache.providers.copilot?.files[dbPath]?.failed).toBe(true)
      expect(failedCache.providers.copilot?.files[dbPath]?.turns).toHaveLength(1)
    } finally {
      PROVIDER_PARSE_VERSIONS.copilot = authority
    }
  })

})
