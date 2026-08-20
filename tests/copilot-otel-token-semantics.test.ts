import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'node:module'

import { createCopilotProvider } from '../src/providers/copilot.js'
import { isSqliteAvailable } from '../src/sqlite.js'
import { calculateCost } from '../src/models.js'
import { buildReasoningMix } from '../src/reasoning-level.js'
import type { ParsedProviderCall } from '../src/providers/types.js'

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

function insertChatSpan(dbPath: string, attrs: Record<string, string | number>): void {
  const { DatabaseSync } = requireForTest('node:sqlite') as { DatabaseSync: new (path: string) => TestDb }
  const db = new DatabaseSync(dbPath)
  db.prepare(
    `INSERT INTO spans (span_id, trace_id, operation_name, start_time_ms, response_model)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('span-otel-semantics', 'trace-otel-semantics', 'chat', 1_774_000_000_000, null)
  const attrStmt = db.prepare(`INSERT INTO span_attributes (span_id, key, value) VALUES (?, ?, ?)`)
  for (const [key, value] of Object.entries(attrs)) attrStmt.run('span-otel-semantics', key, String(value))
  db.close()
}

describe('Copilot OTel token semantics', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metrora-copilot-otel-semantics-'))
    dbPath = join(tempDir, 'agent-traces.db')
    vi.stubEnv('METRORA_COPILOT_OTEL_DB', dbPath)
    vi.stubEnv('METRORA_COPILOT_DISABLE_OTEL', '')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  async function parseCall(overrides: Record<string, string | number> = {}): Promise<ParsedProviderCall> {
    await rm(dbPath, { force: true })
    createOtelDb(dbPath)
    insertChatSpan(dbPath, {
      'gen_ai.conversation.id': 'conversation-otel-semantics',
      'gen_ai.response.model': 'gpt-4.1',
      'gen_ai.usage.input_tokens': 1000,
      'gen_ai.usage.output_tokens': 100,
      ...overrides,
    })
    const provider = createCopilotProvider('/missing-jsonl', '/missing-workspace', '/missing-global', '/missing-jetbrains')
    const source = (await provider.discoverSessions()).find(candidate => candidate.path === dbPath)
    if (!source) throw new Error('Synthetic OTel source was not discovered')
    const calls: ParsedProviderCall[] = []
    for await (const call of provider.createSessionParser(source, new Set()).parse()) calls.push(call)
    if (calls.length !== 1) throw new Error('Expected one synthetic OTel call, got ' + calls.length)
    return calls[0]!
  }

  it('normalizes complete, partial, explicit-zero, and absent cache evidence', async () => {
    if (!isSqliteAvailable()) return

    const cases = [
      {
        name: 'complete read plus creation',
        attrs: { 'gen_ai.usage.cache_read.input_tokens': 300, 'gen_ai.usage.cache_creation.input_tokens': 200 },
        input: 500, read: 300, creation: 200, evidence: 'complete',
      },
      {
        name: 'read only',
        attrs: { 'gen_ai.usage.cache_read.input_tokens': 300 },
        input: 700, read: 300, creation: 0, evidence: 'partial',
      },
      {
        name: 'creation only',
        attrs: { 'gen_ai.usage.cache_creation.input_tokens': 200 },
        input: 800, read: 0, creation: 200, evidence: 'partial',
      },
      {
        name: 'explicit zeros',
        attrs: { 'gen_ai.usage.cache_read.input_tokens': 0, 'gen_ai.usage.cache_creation.input_tokens': 0 },
        input: 1000, read: 0, creation: 0, evidence: 'complete',
      },
      {
        name: 'absent cache detail',
        attrs: {},
        input: 1000, read: 0, creation: 0, evidence: 'unavailable',
      },
    ] as const

    for (const fixture of cases) {
      const call = await parseCall(fixture.attrs)
      expect(call.inputTokens, fixture.name).toBe(fixture.input)
      expect(call.cacheReadInputTokens, fixture.name).toBe(fixture.read)
      expect(call.cacheCreationInputTokens, fixture.name).toBe(fixture.creation)
      expect(call.cacheTokenEvidence, fixture.name).toBe(fixture.evidence)
      expect(call.outputTokens, fixture.name).toBe(100)
      expect(
        call.inputTokens + call.cacheReadInputTokens + call.cacheCreationInputTokens + call.outputTokens,
        fixture.name,
      ).toBe(1100)
    }

    const complete = await parseCall({
      'gen_ai.usage.cache_read.input_tokens': 300,
      'gen_ai.usage.cache_creation.input_tokens': 200,
    })
    expect(complete.inputTokens + complete.cacheReadInputTokens + complete.cacheCreationInputTokens + complete.outputTokens).toBe(1100)
    expect(complete.inputTokens + complete.cacheReadInputTokens + complete.cacheCreationInputTokens + complete.outputTokens).not.toBe(1600)
  })

  it('handles malformed and inconsistent evidence deterministically without negative input', async () => {
    if (!isSqliteAvailable()) return

    const malformed = await parseCall({
      'gen_ai.usage.cache_read.input_tokens': 'not-a-number',
      'gen_ai.usage.cache_creation.input_tokens': -1,
    })
    expect(malformed.inputTokens).toBe(1000)
    expect(malformed.cacheReadInputTokens).toBe(0)
    expect(malformed.cacheCreationInputTokens).toBe(0)
    expect(malformed.cacheTokenEvidence).toBe('inconsistent')
    expect(malformed.inputTokens).toBeGreaterThanOrEqual(0)
    expect(malformed.inputTokens + malformed.cacheReadInputTokens + malformed.cacheCreationInputTokens + malformed.outputTokens).toBe(1100)

    const validReadMalformedCreation = await parseCall({
      'gen_ai.usage.cache_read.input_tokens': 300,
      'gen_ai.usage.cache_creation.input_tokens': 'garbage',
    })
    expect(validReadMalformedCreation.inputTokens).toBe(700)
    expect(validReadMalformedCreation.cacheReadInputTokens).toBe(300)
    expect(validReadMalformedCreation.cacheCreationInputTokens).toBe(0)
    expect(validReadMalformedCreation.cacheTokenEvidence).toBe('inconsistent')
    expect(validReadMalformedCreation.inputTokens + validReadMalformedCreation.cacheReadInputTokens + validReadMalformedCreation.cacheCreationInputTokens + validReadMalformedCreation.outputTokens).toBe(1100)

    const validCreationMalformedRead = await parseCall({
      'gen_ai.usage.cache_read.input_tokens': 'garbage',
      'gen_ai.usage.cache_creation.input_tokens': 200,
    })
    expect(validCreationMalformedRead.inputTokens).toBe(800)
    expect(validCreationMalformedRead.cacheReadInputTokens).toBe(0)
    expect(validCreationMalformedRead.cacheCreationInputTokens).toBe(200)
    expect(validCreationMalformedRead.cacheTokenEvidence).toBe('inconsistent')
    expect(validCreationMalformedRead.inputTokens + validCreationMalformedRead.cacheReadInputTokens + validCreationMalformedRead.cacheCreationInputTokens + validCreationMalformedRead.outputTokens).toBe(1100)

    const invalidInput = await parseCall({
      'gen_ai.usage.input_tokens': 'garbage',
      'gen_ai.usage.cache_read.input_tokens': 300,
    })
    expect(invalidInput.inputTokens).toBe(0)
    expect(invalidInput.cacheReadInputTokens).toBe(0)
    expect(invalidInput.cacheTokenEvidence).toBe('inconsistent')
    expect(invalidInput.inputTokens + invalidInput.cacheReadInputTokens + invalidInput.cacheCreationInputTokens + invalidInput.outputTokens).toBe(100)

    const invalidOutput = await parseCall({
      'gen_ai.usage.cache_read.input_tokens': 300,
      'gen_ai.usage.cache_creation.input_tokens': 200,
      'gen_ai.usage.output_tokens': 'garbage',
    })
    expect(invalidOutput.inputTokens).toBe(500)
    expect(invalidOutput.cacheTokenEvidence).toBe('complete')
    expect(invalidOutput.outputTokens).toBe(0)
    expect(invalidOutput.inputTokens + invalidOutput.cacheReadInputTokens + invalidOutput.cacheCreationInputTokens + invalidOutput.outputTokens).toBe(1000)

    const inconsistent = await parseCall({
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.cache_read.input_tokens': 80,
      'gen_ai.usage.cache_creation.input_tokens': 30,
    })
    expect(inconsistent.inputTokens).toBe(100)
    expect(inconsistent.cacheReadInputTokens).toBe(0)
    expect(inconsistent.cacheCreationInputTokens).toBe(0)
    expect(inconsistent.cacheTokenEvidence).toBe('inconsistent')
    expect(inconsistent.inputTokens).toBeGreaterThanOrEqual(0)
    expect(inconsistent.inputTokens + inconsistent.cacheReadInputTokens + inconsistent.cacheCreationInputTokens + inconsistent.outputTokens).toBe(200)
  })

  it('prefers canonical reasoning evidence and marks OTel output as aggregate', async () => {
    if (!isSqliteAvailable()) return

    const canonical = await parseCall({
      'gen_ai.usage.cache_read.input_tokens': 0,
      'gen_ai.usage.cache_creation.input_tokens': 0,
      'gen_ai.usage.reasoning.output_tokens': 20,
    })
    expect(canonical.reasoningTokens).toBe(20)
    expect(canonical.reasoningSemantics).toBe('aggregate-output')

    const legacy = await parseCall({
      'gen_ai.usage.cache_read.input_tokens': 0,
      'gen_ai.usage.cache_creation.input_tokens': 0,
      'gen_ai.usage.reasoning_tokens': 12,
    })
    expect(legacy.reasoningTokens).toBe(12)
    expect(legacy.reasoningSemantics).toBe('aggregate-output')

    const both = await parseCall({
      'gen_ai.usage.cache_read.input_tokens': 0,
      'gen_ai.usage.cache_creation.input_tokens': 0,
      'gen_ai.usage.reasoning.output_tokens': 20,
      'gen_ai.usage.reasoning_tokens': 99,
    })
    expect(both.reasoningTokens).toBe(20)
    expect(both.reasoningSemantics).toBe('aggregate-output')
  })

  it('keeps reasoning inside inclusive output totals and preserves response-model precedence', async () => {
    if (!isSqliteAvailable()) return

    const call = await parseCall({
      'gen_ai.request.model': 'claude-sonnet-4-6',
      'gen_ai.usage.cache_read.input_tokens': 0,
      'gen_ai.usage.cache_creation.input_tokens': 0,
      'gen_ai.usage.reasoning.output_tokens': 20,
    })
    expect(call.model).toBe('gpt-4.1')
    expect(call.costUSD).toBe(calculateCost('gpt-4.1', 1000, 100, 0, 0, 0))

    const mix = buildReasoningMix([{
      outputTokens: 100,
      reasoningTokens: 20,
      reasoningSemantics: 'aggregate-output',
      costUSD: call.costUSD,
    }])
    expect(mix.rows[0]!.generatedTokens).toBe(100)
    expect(mix.rows[0]!.generatedTokens).not.toBe(120)
  })
})
