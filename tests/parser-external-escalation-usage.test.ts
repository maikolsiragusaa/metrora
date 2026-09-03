import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { parseApiCall, parseExternalEscalationCalls, compactEntry, parseAllSessions, clearSessionCache } from '../src/parser.js'
import { legacyExternalEscalationDeduplicationKey, legacyExternalEscalationMessageType } from '../src/compat/legacy-migration-identifiers.js'
import { calculateCost, loadPricing } from '../src/models.js'
import type { JournalEntry } from '../src/types.js'

const MAIN_MODEL = 'claude-sonnet-4-20250514'
const ESCALATION_MODEL = 'claude-opus-4-20250514'

// Shape mirrors a real external Claude Code escalation turn: the top-level
// usage covers only the main model, and the escalation tokens live in a legacy
// wire iteration under their own model. The two `message` iterations sum to the
// top-level usage (verified against real Claude Code session data).
function escalationEntry(): JournalEntry {
  return {
    type: 'assistant',
    timestamp: '2026-07-10T10:00:00.000Z',
    sessionId: 's1',
    message: {
      type: 'message',
      role: 'assistant',
      model: MAIN_MODEL,
      id: 'msg-escalation-1',
      content: [],
      usage: {
        input_tokens: 2,
        output_tokens: 491,
        cache_creation_input_tokens: 7853,
        cache_read_input_tokens: 226584,
        iterations: [
          { type: 'message', input_tokens: 1, output_tokens: 45, cache_creation_input_tokens: 7192, cache_read_input_tokens: 109696 },
          { type: legacyExternalEscalationMessageType(), model: ESCALATION_MODEL, input_tokens: 159419, output_tokens: 7805, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          { type: 'message', input_tokens: 1, output_tokens: 446, cache_creation_input_tokens: 661, cache_read_input_tokens: 116888 },
        ],
      },
    },
  } as unknown as JournalEntry
}

describe('external escalation usage parsing', () => {
  beforeAll(async () => {
    await loadPricing()
  })

  it('leaves the main-model call attributed to the main model and its top-level totals', () => {
    const call = parseApiCall(escalationEntry())
    expect(call).not.toBeNull()
    expect(call!.model).toBe(MAIN_MODEL)
    expect(call!.usage.inputTokens).toBe(2)
    expect(call!.usage.outputTokens).toBe(491)
    expect(call!.usage.cacheReadInputTokens).toBe(226584)
    expect(call!.deduplicationKey).toBe('msg-escalation-1')
  })

  it('emits a separate call for the escalation iteration, priced under its model', () => {
    const escalationCalls = parseExternalEscalationCalls(escalationEntry())
    expect(escalationCalls).toHaveLength(1)
    const a = escalationCalls[0]!
    expect(a.model).toBe(ESCALATION_MODEL)
    expect(a.usage.inputTokens).toBe(159419)
    expect(a.usage.outputTokens).toBe(7805)
    expect(a.deduplicationKey).toBe(legacyExternalEscalationDeduplicationKey('msg-escalation-1', 0))

    const expectedCost = calculateCost(ESCALATION_MODEL, 159419, 7805, 0, 0, 0, 'standard', 0)
    expect(a.costUSD).toBeCloseTo(expectedCost, 10)
    expect(a.costUSD).toBeGreaterThan(0)
  })

  it('does not double-count: escalation tokens are absent from the main call', () => {
    const call = parseApiCall(escalationEntry())!
    // 159419 is the escalation input; it must never appear on the main call.
    expect(call.usage.inputTokens).not.toBe(159419)
  })

  it('returns no escalation calls when iterations hold only main-model messages', () => {
    const entry = escalationEntry()
    // Strip the legacy escalation iteration.
    const usage = (entry.message as { usage: { iterations: unknown[] } }).usage
    usage.iterations = usage.iterations.filter((it: unknown) => (it as { type?: string }).type !== legacyExternalEscalationMessageType())
    expect(parseExternalEscalationCalls(entry)).toHaveLength(0)
  })

  it('returns no escalation calls when there is no iterations array', () => {
    const entry = escalationEntry()
    delete (entry.message as { usage: { iterations?: unknown } }).usage.iterations
    expect(parseExternalEscalationCalls(entry)).toHaveLength(0)
  })

  it('survives compaction: compactEntry keeps escalation iterations so the call is still emitted', () => {
    const compacted = compactEntry(escalationEntry())
    const escalationCalls = parseExternalEscalationCalls(compacted)
    expect(escalationCalls).toHaveLength(1)
    expect(escalationCalls[0]!.model).toBe(ESCALATION_MODEL)
    expect(escalationCalls[0]!.usage.inputTokens).toBe(159419)
    expect(escalationCalls[0]!.deduplicationKey).toBe(legacyExternalEscalationDeduplicationKey('msg-escalation-1', 0))
  })
})

describe('external escalation usage end-to-end through parseAllSessions', () => {
  let tmpDir: string | null = null
  const savedEnv = { config: process.env['CLAUDE_CONFIG_DIR'], cache: process.env['METRORA_CACHE_DIR'] }

  beforeAll(async () => {
    await loadPricing()
  })

  afterEach(async () => {
    clearSessionCache()
    if (savedEnv.config === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = savedEnv.config
    if (savedEnv.cache === undefined) delete process.env['METRORA_CACHE_DIR']
    else process.env['METRORA_CACHE_DIR'] = savedEnv.cache
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  it('attributes escalation spend to the escalation model in the session breakdown', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'metrora-escalation-'))
    process.env['CLAUDE_CONFIG_DIR'] = tmpDir
    process.env['METRORA_CACHE_DIR'] = join(tmpDir, 'cache')
    const proj = join(tmpDir, 'projects', 'p')
    await mkdir(proj, { recursive: true })
    const user = JSON.stringify({ type: 'user', timestamp: '2026-07-10T09:59:59.000Z', sessionId: 's1', message: { role: 'user', content: 'hi' } })
    const assistant = JSON.stringify(escalationEntry())
    await writeFile(join(proj, 's1.jsonl'), `${user}\n${assistant}\n`)

    clearSessionCache()
    const projects = await parseAllSessions(undefined, 'claude')
    const inputByModel: Record<string, number> = {}
    for (const p of projects) {
      for (const s of p.sessions) {
        for (const [model, b] of Object.entries(s.modelBreakdown ?? {})) {
          inputByModel[model] = (inputByModel[model] ?? 0) + (b.tokens?.inputTokens ?? 0)
        }
      }
    }
    // Main model keeps only its top-level tokens; escalation model carries its own.
    const escalationModelKey = Object.keys(inputByModel).find(m => m.toLowerCase().includes('opus'))
    expect(escalationModelKey).toBeDefined()
    expect(inputByModel[escalationModelKey!]).toBe(159419)
    const mainModelKey = Object.keys(inputByModel).find(m => m.toLowerCase().includes('sonnet'))
    expect(inputByModel[mainModelKey!]).toBe(2)
  })

  it('counts escalation spend even when the assistant line exceeds the large-line (32KB) threshold', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'metrora-escalation-big-'))
    process.env['CLAUDE_CONFIG_DIR'] = tmpDir
    process.env['METRORA_CACHE_DIR'] = join(tmpDir, 'cache')
    const proj = join(tmpDir, 'projects', 'p')
    await mkdir(proj, { recursive: true })

    // Pad the content past 32KB so parseJsonlLine routes to the large-line
    // byte-scanner path (which previously dropped iterations entirely).
    const entry = escalationEntry()
    ;(entry.message as { content: unknown[] }).content = [{ type: 'text', text: 'x'.repeat(40_000) }]
    const assistant = JSON.stringify(entry)
    expect(Buffer.byteLength(assistant, 'utf8')).toBeGreaterThan(32 * 1024)
    const user = JSON.stringify({ type: 'user', timestamp: '2026-07-10T09:59:59.000Z', sessionId: 's1', message: { role: 'user', content: 'hi' } })
    await writeFile(join(proj, 's1.jsonl'), `${user}\n${assistant}\n`)

    clearSessionCache()
    const projects = await parseAllSessions(undefined, 'claude')
    const inputByModel: Record<string, number> = {}
    for (const p of projects) {
      for (const s of p.sessions) {
        for (const [model, b] of Object.entries(s.modelBreakdown ?? {})) {
          inputByModel[model] = (inputByModel[model] ?? 0) + (b.tokens?.inputTokens ?? 0)
        }
      }
    }
    const escalationModelKey = Object.keys(inputByModel).find(m => m.toLowerCase().includes('opus'))
    expect(escalationModelKey).toBeDefined()
    expect(inputByModel[escalationModelKey!]).toBe(159419)
  })
})
