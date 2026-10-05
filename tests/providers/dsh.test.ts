import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import zlib from 'zlib'

import { createDshProvider } from '../../src/providers/dsh.js'
import { getHistoricalPricingModelKey, resolveAlias } from '../../src/models.js'
import { cachedCallToApiCall, providerCallToCachedCall } from '../../src/parser.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

const zstdCompress = (zlib as { zstdCompressSync?: (buf: Buffer) => Buffer }).zstdCompressSync
const zstdDecompress = (zlib as { zstdDecompressSync?: (buf: Buffer) => Buffer }).zstdDecompressSync
const skipZstd = !zstdCompress || !zstdDecompress
  ? 'zlib zstd not available — needs Node 22.15+; skipping'
  : null

let tmpDir: string
let home: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dsh-test-'))
  home = join(tmpDir, 'home')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ── fixtures ───────────────────────────────────────────────────────────
// Shapes condensed from real DSH session format v4 logs.

const CREATED_AT = Date.parse('2026-10-03T14:00:00.000Z')

function header(overrides: Record<string, unknown> = {}) {
  return {
    type: 'session',
    version: 4,
    id: 'session-a05b1930',
    createdAt: CREATED_AT,
    cwd: 'C:\\DEV\\metrora-dev',
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
    ...overrides,
  }
}

function assistantMessage(opts: {
  turn: number
  step: number
  seq: number
  time: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  model?: string
  provider?: string
  messageId?: string
  withStreamUsage?: boolean
  withUsage?: boolean
  withSource?: boolean
}) {
  const usage = {
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    cacheReadTokens: opts.cacheReadTokens ?? 0,
    cacheWriteTokens: opts.cacheWriteTokens ?? 0,
    ...(opts.reasoningTokens === undefined ? {} : { reasoningTokens: opts.reasoningTokens }),
    totalTokens: opts.inputTokens + opts.outputTokens + (opts.cacheReadTokens ?? 0) + (opts.cacheWriteTokens ?? 0),
  }
  return {
    type: 'assistant/message',
    seq: opts.seq,
    time: opts.time,
    data: {
      turn: opts.turn,
      step: opts.step,
      message: {
        role: 'assistant',
        id: opts.messageId ?? `msg-${opts.turn}-${opts.step}`,
        content: [{ type: 'text', text: 'IGNORED CONTENT: never decoded by the collector' }],
        ...(opts.withSource === false
          ? {}
          : { source: { kind: 'model', provider: opts.provider ?? 'deepseek-account', model: opts.model ?? 'deepseek-flash' } }),
      },
      ...(opts.withUsage === false ? {} : { usage }),
      stream: opts.withStreamUsage === false
        ? []
        : [{ type: 'chunk', time: opts.time, chunk: { type: 'usage', usage } }],
    },
  }
}

function stepStart(turn: number, step: number, seq: number, time: number) {
  return { type: 'step/start', seq, time, data: { turn, step } }
}

function toolCall(turn: number, step: number, name: string, seq: number, time: number, args?: unknown) {
  return {
    type: 'tool/call',
    seq,
    time,
    data: { turn, step, callId: `call-${seq}`, name, ...(args === undefined ? {} : { arguments: JSON.stringify(args) }) },
  }
}

async function writeLines(relative: string, lines: unknown[]): Promise<string> {
  const path = join(home, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`)
  return path
}

/** DSH's default artifact: independent zstd frames concatenated in one file. */
async function writeZstd(relative: string, lines: unknown[], frames = 2): Promise<string> {
  const path = join(home, relative)
  await mkdir(join(path, '..'), { recursive: true })
  const encoded = lines.map(line => `${JSON.stringify(line)}\n`)
  const perFrame = Math.ceil(encoded.length / frames)
  const parts: Buffer[] = []
  for (let index = 0; index < encoded.length; index += perFrame) {
    parts.push(zstdCompress!(Buffer.from(encoded.slice(index, index + perFrame).join(''), 'utf-8')))
  }
  await writeFile(path, Buffer.concat(parts))
  return path
}

async function parse(path: string, seen = new Set<string>()): Promise<ParsedProviderCall[]> {
  const provider = createDshProvider(home)
  const calls: ParsedProviderCall[] = []
  for await (const call of provider.createSessionParser({ path, project: 'fallback', provider: 'dsh' }, seen).parse()) {
    calls.push(call)
  }
  return calls
}

// ── discovery ──────────────────────────────────────────────────────────

describe('dsh provider - discovery', () => {
  it('discovers a session directory and takes the project from the header cwd', async () => {
    await writeLines(join('sessions', '--C-DEV-metrora-dev--', 'session-a05b1930', 'session.v4.jsonl'), [header()])
    const sessions = await createDshProvider(home).discoverSessions()
    expect(sessions).toEqual([
      {
        path: join(home, 'sessions', '--C-DEV-metrora-dev--', 'session-a05b1930', 'session.v4.jsonl'),
        project: 'metrora-dev',
        provider: 'dsh',
      },
    ])
  })

  it('selects the highest generation and never the snapshot beside it', async () => {
    const dir = join('sessions', '--proj--', 'session-1')
    await writeLines(join(dir, 'session.v3.jsonl'), [header({ version: 3 })])
    await writeLines(join(dir, 'session.v4.jsonl'), [header()])
    const sessions = await createDshProvider(home).discoverSessions()
    expect(sessions.map(s => s.path)).toEqual([join(home, dir, 'session.v4.jsonl')])
  })

  it('prefers the compressed spelling when both encodings share a generation', async () => {
    const dir = join('sessions', '--proj--', 'session-1')
    await writeLines(join(dir, 'session.v4.jsonl'), [header()])
    if (skipZstd) return
    await writeZstd(join(dir, 'session.v4.jsonl.zstd'), [header()])
    const sessions = await createDshProvider(home).discoverSessions()
    expect(sessions.map(s => s.path)).toEqual([join(home, dir, 'session.v4.jsonl.zstd')])
  })

  it('skips a generation this parser does not support instead of reporting zero usage', async () => {
    await writeLines(join('sessions', '--proj--', 'session-1', 'session.v9.jsonl'), [header({ version: 9 })])
    expect(await createDshProvider(home).discoverSessions()).toEqual([])
  })

  it('skips a log whose filename and header versions disagree', async () => {
    await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [header({ version: 3 })])
    expect(await createDshProvider(home).discoverSessions()).toEqual([])
  })

  it('returns nothing for a missing sessions root', async () => {
    expect(await createDshProvider(join(tmpDir, 'absent')).discoverSessions()).toEqual([])
  })

  it('reports the resolved sessions root for doctor', async () => {
    await expect(createDshProvider(home).probeRoots!()).resolves.toEqual([
      { path: join(home, 'sessions'), label: 'DSH sessions' },
    ])
  })
})

// ── parsing: session format v4 ─────────────────────────────────────────

describe('dsh provider - parsing session format v4', () => {
  it('maps the disjoint DSH counters onto the ledger', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header({ id: 'session-42' }),
      { type: 'turn/start', seq: 1, time: CREATED_AT + 1000, data: { turn: 1 } },
      stepStart(1, 1, 2, CREATED_AT + 1100),
      assistantMessage({
        turn: 1,
        step: 1,
        seq: 3,
        time: CREATED_AT + 2000,
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 10000,
        cacheWriteTokens: 50,
        reasoningTokens: 120,
      }),
    ])

    const calls = await parse(path)
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.provider).toBe('dsh')
    expect(call.model).toBe('deepseek-flash')
    expect(call.modelProvider).toBe('deepseek-account')
    expect(call.inputTokens).toBe(1000)
    expect(call.outputTokens).toBe(200)
    expect(call.cacheReadInputTokens).toBe(10000)
    expect(call.cachedInputTokens).toBe(10000)
    expect(call.cacheCreationInputTokens).toBe(50)
    // Reasoning is a subdivision of output at the source, never a second bucket.
    expect(call.reasoningTokens).toBe(120)
    expect(call.reasoningSemantics).toBe('aggregate-output')
    expect(call.cacheTokenEvidence).toBe('complete')
    expect(call.costIsEstimated).toBe(true)
    expect(call.timestamp).toBe(new Date(CREATED_AT + 2000).toISOString())
    expect(call.sessionId).toBe('session-42')
    expect(call.project).toBe('metrora-dev')
    expect(call.projectPath).toBe('C:\\DEV\\metrora-dev')
    expect(call.workingDirectory).toBe('C:\\DEV\\metrora-dev')
    expect(call.deduplicationKey).toBe('dsh:session-42:1:1')
  })

  it('counts a call once even though its packed stream repeats the usage', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 10, outputTokens: 5 }),
    ])
    const calls = await parse(path)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.inputTokens).toBe(10)
  })

  it('falls back to the stream usage when the message carries none', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 77, outputTokens: 7, withUsage: false }),
    ])
    const calls = await parse(path)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.inputTokens).toBe(77)
  })

  it('emits nothing for a message without usage', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 0, outputTokens: 0, withUsage: false, withStreamUsage: false }),
      { type: 'assistant/attempt', seq: 2, time: CREATED_AT, data: { turn: 1, step: 2, stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error' } } }] } },
    ])
    expect(await parse(path)).toEqual([])
  })

  it('attributes tools to their own step and normalizes their names', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      toolCall(1, 1, 'pwsh', 1, CREATED_AT, { command: 'npm test && npx vitest --run', description: 'run tests' }),
      toolCall(1, 1, 'read', 2, CREATED_AT, { file_path: 'src/app.ts' }),
      toolCall(1, 1, 'skill', 3, CREATED_AT, { name: 'office-xlsx' }),
      toolCall(1, 1, 'mcp__github__create_issue', 4, CREATED_AT, { title: 'secret title' }),
      toolCall(2, 1, 'grep', 5, CREATED_AT, { pattern: 'needle' }),
      assistantMessage({ turn: 1, step: 1, seq: 6, time: CREATED_AT + 1000, inputTokens: 10, outputTokens: 5 }),
      assistantMessage({ turn: 2, step: 1, seq: 7, time: CREATED_AT + 2000, inputTokens: 20, outputTokens: 5 }),
    ])

    const calls = await parse(path)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.tools).toEqual(['Bash', 'Read', 'Skill', 'mcp__github__create_issue'])
    expect(calls[0]!.skills).toEqual(['office-xlsx'])
    // extractBashCommands keeps the base program name of each segment (and
    // skips runner prefixes such as `npx`), exactly as for every other collector.
    expect(calls[0]!.bashCommands).toEqual(['npm', 'vitest'])
    expect(calls[1]!.tools).toEqual(['Grep'])
    expect(calls[1]!.bashCommands).toEqual([])
  })

  it('previews only real human prompts, never injected context', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      { type: 'turn/start', seq: 1, time: CREATED_AT, data: { turn: 1 } },
      { type: 'user/message', seq: 2, time: CREATED_AT, data: { content: [{ type: 'text', text: 'runtime snapshot text' }], source: { kind: 'runtime-context' } } },
      { type: 'user/message', seq: 3, time: CREATED_AT, data: { content: [{ type: 'text', text: 'fix the failing test' }], source: { kind: 'user' } } },
      { type: 'user/message', seq: 4, time: CREATED_AT, data: { content: [{ type: 'text', text: 'second prompt in the same turn' }], source: { kind: 'user' } } },
      assistantMessage({ turn: 1, step: 1, seq: 5, time: CREATED_AT + 1000, inputTokens: 10, outputTokens: 5 }),
    ])
    const calls = await parse(path)
    expect(calls[0]!.userMessage).toBe('fix the failing test')
  })

  it('falls back to the logged request route when a message records none', async () => {
    const message = assistantMessage({ turn: 1, step: 1, seq: 3, time: CREATED_AT, inputTokens: 10, outputTokens: 5, withSource: false })
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      { type: 'request/header', seq: 1, time: CREATED_AT, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-flash' } } } },
      message,
    ])
    const calls = await parse(path)
    expect(calls[0]!.model).toBe('deepseek-flash')
    expect(calls[0]!.modelProvider).toBe('deepseek-official')
    expect(calls[0]!.pricingContext).toEqual({ pricingAuthority: 'deepseek' })
  })

  it('leaves an unknown route without an invented price authority', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 10, outputTokens: 5, provider: 'acme-gateway' }),
    ])
    const calls = await parse(path)
    expect(calls[0]!.modelProvider).toBe('acme-gateway')
    expect(calls[0]!.pricingContext).toBeUndefined()
  })

  it('skips the replayed ancestor prefix of a fork seed', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-child', 'session.v4.jsonl'), [
      header({ id: 'session-child', isSeeded: true, parentSession: 'session-parent' }),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 999, outputTokens: 99, messageId: 'inherited-1' }),
      { type: 'session/end-seed', seq: 2, time: CREATED_AT, data: { inherited: true } },
      assistantMessage({ turn: 1, step: 2, seq: 3, time: CREATED_AT + 1000, inputTokens: 11, outputTokens: 2, messageId: 'own-1' }),
    ])
    const calls = await parse(path)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.inputTokens).toBe(11)
    expect(calls[0]!.sessionId).toBe('session-child')
  })

  it('treats an untagged end-seed marker as an ordinary boundary', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      { type: 'session/end-seed', seq: 1, time: CREATED_AT, data: {} },
      assistantMessage({ turn: 1, step: 1, seq: 2, time: CREATED_AT, inputTokens: 10, outputTokens: 5 }),
    ])
    expect(await parse(path)).toHaveLength(1)
  })

  it('skips a corrupt seeded session that has no inherited marker', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header({ isSeeded: true }),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 10, outputTokens: 5 }),
    ])
    expect(await parse(path)).toEqual([])
  })

  it('keeps a retried step additive after a retry event', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header({ id: 'session-r' }),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 10, outputTokens: 1, messageId: 'attempt-1' }),
      { type: 'llm/retry-started', seq: 2, time: CREATED_AT + 500, data: { turn: 1, step: 1 } },
      assistantMessage({ turn: 1, step: 1, seq: 3, time: CREATED_AT + 1000, inputTokens: 20, outputTokens: 2, messageId: 'attempt-2' }),
    ])
    const calls = await parse(path)
    expect(calls.map(call => [call.inputTokens, call.deduplicationKey])).toEqual([
      [10, 'dsh:session-r:1:1'],
      [20, 'dsh:session-r:1:1:attempt:2'],
    ])
  })

  it('replaces an unsettled observation in place instead of double counting it', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      { type: 'assistant/chunk', seq: 1, time: CREATED_AT, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } } } },
      assistantMessage({ turn: 1, step: 1, seq: 2, time: CREATED_AT + 100, inputTokens: 10, outputTokens: 9 }),
    ])
    const calls = await parse(path)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.outputTokens).toBe(9)
  })

  it('skips a session with a malformed interior row', async () => {
    const path = join(home, 'sessions', '--proj--', 'session-1', 'session.v4.jsonl')
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, [
      JSON.stringify(header()),
      '{ not json',
      JSON.stringify(assistantMessage({ turn: 1, step: 1, seq: 2, time: CREATED_AT, inputTokens: 10, outputTokens: 5 })),
      '',
    ].join('\n'))
    expect(await parse(path)).toEqual([])
  })

  it('deduplicates across repeated parses', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 10, outputTokens: 5 }),
    ])
    const seen = new Set<string>()
    expect(await parse(path, seen)).toHaveLength(1)
    expect(await parse(path, seen)).toHaveLength(0)
  })

  it('prices the DeepSeek route through the reviewed model identity', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 5_000_000 }),
    ])
    const calls = await parse(path)
    expect(getHistoricalPricingModelKey('deepseek-flash')).toBe('deepseek-v4-flash')
    expect(resolveAlias('deepseek-flash')).toBe('deepseek-v4-flash')
    expect(calls[0]!.costUSD).toBeGreaterThan(0)

    const cached = providerCallToCachedCall(calls[0]!)
    expect(cached.provider).toBe('dsh')
    expect(cached.isEstimated).toBe(true)
    expect(cached.modelProvider).toBe('deepseek-account')
    expect(cachedCallToApiCall(cached).costAssignment.kind).not.toBe('metered')
  })

  it('keeps missing cache fields distinct from a reported zero', async () => {
    // JSON.stringify drops absent keys, so each record below carries exactly
    // the cache fields a real log would: one partial, one with no cache
    // evidence at all, one that reports explicit zeros.
    const message = (turn: number, seq: number, usage: Record<string, unknown>) => ({
      type: 'assistant/message',
      seq,
      time: CREATED_AT + turn * 1000,
      data: {
        turn,
        step: 1,
        message: { role: 'assistant', id: `msg-${turn}`, content: [], source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-flash' } },
        usage,
        stream: [],
      },
    })
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      message(1, 1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 50 }),
      message(2, 2, { inputTokens: 100, outputTokens: 10, totalTokens: 110 }),
      message(3, 3, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 110 }),
    ])
    const calls = await parse(path)
    expect(calls).toHaveLength(3)
    expect(calls[0]!.cacheTokenEvidence).toBe('partial')
    expect(calls[1]!.cacheTokenEvidence).toBe('unavailable')
    expect(calls[2]!.cacheTokenEvidence).toBe('complete')
  })

  it('never lets non-numeric usage fields corrupt the ledger', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      {
        type: 'assistant/message',
        seq: 1,
        time: CREATED_AT,
        data: {
          turn: 1,
          step: 1,
          message: { role: 'assistant', id: 'msg-1', content: [], source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-flash' } },
          usage: { inputTokens: '1000', outputTokens: 5, cacheReadTokens: [1, 2], cacheWriteTokens: -3, reasoningTokens: 2.5 },
          stream: [],
        },
      },
    ])
    const calls = await parse(path)
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    // Strings and arrays never flow into the global totals: every malformed
    // counter degrades to a reported zero instead of string concatenation.
    expect(call.inputTokens).toBe(0)
    expect(call.outputTokens).toBe(5)
    expect(call.cacheReadInputTokens).toBe(0)
    expect(call.cacheCreationInputTokens).toBe(0)
    expect(call.reasoningTokens).toBe(0)
    expect(call.costIsEstimated).toBe(true)
    // A degraded counter is unknown, not an observed zero: the record's
    // primary-counter evidence stays partial even though costIsEstimated is
    // unconditionally true for DSH's derived cost.
    expect(call.usageEvidence).toBe('partial')
  })

  it('distinguishes missing primary counters from a reported zero across the cache boundary', async () => {
    const message = (turn: number, seq: number, usage: Record<string, unknown>) => ({
      type: 'assistant/message',
      seq,
      time: CREATED_AT + turn * 1000,
      data: {
        turn,
        step: 1,
        message: { role: 'assistant', id: `msg-${turn}`, content: [], source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-flash' } },
        usage,
        stream: [],
      },
    })
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      // Input missing, output valid: partial evidence, never a zero-input call.
      message(1, 1, { outputTokens: 5 }),
      // Output missing, input valid.
      message(2, 2, { inputTokens: 100 }),
      // A reported zero is valid evidence of zero: complete, not partial.
      message(3, 3, { inputTokens: 0, outputTokens: 5 }),
      // Both primary counters absent with cache evidence only: unavailable.
      message(4, 4, { cacheWriteTokens: 50 }),
    ])
    const calls = await parse(path)
    expect(calls).toHaveLength(4)
    expect(calls[0]!.inputTokens).toBe(0)
    expect(calls[0]!.usageEvidence).toBe('partial')
    expect(calls[1]!.outputTokens).toBe(0)
    expect(calls[1]!.usageEvidence).toBe('partial')
    expect(calls[2]!.inputTokens).toBe(0)
    expect(calls[2]!.usageEvidence).toBe('complete')
    expect(calls[3]!.inputTokens).toBe(0)
    expect(calls[3]!.usageEvidence).toBe('unavailable')
    expect(calls[3]!.cacheCreationInputTokens).toBe(50)

    // The distinction is part of the durable cache authority and comes back
    // on the API surface after a cache round trip.
    const cached = providerCallToCachedCall(calls[0]!)
    expect(cached.usageEvidence).toBe('partial')
    expect(cachedCallToApiCall(cached).usageEvidence).toBe('partial')
    const cachedComplete = providerCallToCachedCall(calls[2]!)
    expect(cachedComplete.usageEvidence).toBe('complete')
    expect(cachedCallToApiCall(cachedComplete).usageEvidence).toBe('complete')
    const cachedUnavailable = providerCallToCachedCall(calls[3]!)
    expect(cachedCallToApiCall(cachedUnavailable).usageEvidence).toBe('unavailable')
  })

  it('keeps the usage evidence through the durable cache file round trip', async () => {
    vi.stubEnv('METRORA_CONFIG_DIR', join(tmpDir, 'dsh-cache-roundtrip'))
    try {
      const { emptyCache, computeEnvFingerprint, saveCache, loadCache } = await import('../../src/session-cache.js')
      const { providerCallToCachedCall } = await import('../../src/parser.js')

      const message = (turn: number, seq: number, usage: Record<string, unknown>) => ({
        type: 'assistant/message',
        seq,
        time: CREATED_AT + turn * 1000,
        data: {
          turn,
          step: 1,
          message: { role: 'assistant', id: `msg-${turn}`, content: [], source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-flash' } },
          usage,
          stream: [],
        },
      })
      const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
        header(),
        message(1, 1, { outputTokens: 5 }),
      ])
      const [call] = await parse(path)
      const cached = providerCallToCachedCall(call!)
      expect(cached.usageEvidence).toBe('partial')

      const cache = emptyCache()
      cache.providers['dsh'] = {
        envFingerprint: computeEnvFingerprint('dsh'),
        files: {
          [path]: {
            fingerprint: { dev: 1, ino: 1, mtimeMs: 1, sizeBytes: 1 },
            mcpInventory: [],
            turns: [{ timestamp: cached.timestamp, sessionId: cached.sessionId ?? 'session-42', userMessage: '', calls: [cached] }],
          },
        },
      }
      expect(await saveCache(cache)).toBe(true)

      const reloaded = await loadCache()
      const reloadedCall = reloaded.providers['dsh']?.files[path]?.turns[0]?.calls[0]
      // The loaded cache is the JSON round trip through isValidCache: the
      // distinction survived serialization, not just the in-memory mapping.
      expect(reloadedCall?.usageEvidence).toBe('partial')
      expect(reloadedCall?.usage.inputTokens).toBe(0)
      expect(reloadedCall?.usage.outputTokens).toBe(5)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('retains what an incomplete usage record did report and says so', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
        header(),
        {
          type: 'assistant/message',
          seq: 1,
          time: CREATED_AT,
          data: {
            turn: 1,
            step: 1,
            message: { role: 'assistant', id: 'msg-1', content: [], source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-flash' } },
            usage: { inputTokens: 100 },
            stream: [],
          },
        },
      ])
      const calls = await parse(path)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.inputTokens).toBe(100)
      expect(calls[0]!.outputTokens).toBe(0)
      expect(calls[0]!.costIsEstimated).toBe(true)
      const notices = stderrSpy.mock.calls.map(call => String(call[0])).join('')
      expect(notices).toContain('incomplete or invalid usage')
    } finally {
      stderrSpy.mockRestore()
    }
  })
})

// ── parsing: legacy generations ────────────────────────────────────────

describe('dsh provider - parsing legacy generations', () => {
  it('reads v0 chunk usage and honours the seedLength cut', async () => {
    const chunk = (seq: number, turn: number, step: number, inputTokens: number) => ({
      type: 'assistant/chunk',
      seq,
      time: CREATED_AT,
      data: { turn, step, chunk: { type: 'usage', usage: { inputTokens, outputTokens: 0 } } },
    })
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.jsonl'), [
      { type: 'session', version: 0, id: 'legacy', createdAt: CREATED_AT, cwd: '/tmp/proj', parentSession: 'parent', seedLength: 2 },
      chunk(0, 1, 1, 999),
      { type: 'assistant/message', seq: 2, time: CREATED_AT, data: { turn: 1, step: 2, message: { id: 'own', source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: { inputTokens: 42, outputTokens: 4 } } },
    ])
    const calls = await parse(path)
    expect(calls.map(call => call.inputTokens)).toEqual([42])
    expect(calls[0]!.deduplicationKey).toBe('dsh:legacy:1:2')
  })

  it('reads the usage of an attempt that settled no surface message', async () => {
    const path = await writeLines(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl'), [
      header(),
      {
        type: 'assistant/attempt',
        seq: 1,
        time: CREATED_AT,
        data: { turn: 1, step: 1, stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 31, outputTokens: 3 } } }] },
      },
    ])
    const calls = await parse(path)
    expect(calls.map(call => call.inputTokens)).toEqual([31])
  })
})

// ── parsing: compressed artifacts ──────────────────────────────────────

describe('dsh provider - zstd artifacts', () => {
  it.skipIf(skipZstd)('reads usage from every frame, not only the first', async () => {
    const lines = [
      header({ id: 'session-zstd' }),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 111, outputTokens: 11 }),
      assistantMessage({ turn: 1, step: 2, seq: 2, time: CREATED_AT + 1000, inputTokens: 222, outputTokens: 22 }),
    ]
    const path = await writeZstd(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl.zstd'), lines, 3)

    // The trap this collector exists to avoid: one decode call sees the header
    // frame only, which is exactly what a naive reader would report as zero usage.
    const naive = zstdDecompress!(await readFile(path)).toString('utf-8')
    expect(naive.trim().split('\n')).toHaveLength(1)

    const calls = await parse(path)
    expect(calls.map(call => call.inputTokens)).toEqual([111, 222])
  })

  it.skipIf(skipZstd)('keeps the frames before a torn tail', async () => {
    const lines = [
      header(),
      assistantMessage({ turn: 1, step: 1, seq: 1, time: CREATED_AT, inputTokens: 50, outputTokens: 5 }),
    ]
    const path = await writeZstd(join('sessions', '--proj--', 'session-1', 'session.v4.jsonl.zstd'), lines, 2)
    const complete = await readFile(path)
    await writeFile(path, Buffer.concat([complete, complete.subarray(0, Math.floor(complete.length / 2))]))

    const calls = await parse(path)
    expect(calls.map(call => call.inputTokens)).toEqual([50])
  })

  it.skipIf(skipZstd)('skips a structurally corrupt log instead of counting a prefix', async () => {
    const path = join(home, 'sessions', '--proj--', 'session-1', 'session.v4.jsonl.zstd')
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, Buffer.concat([
      zstdCompress!(Buffer.from(`${JSON.stringify(header())}\n`, 'utf-8')),
      Buffer.from('not a zstd frame at all'),
    ]))
    expect(await parse(path)).toEqual([])
  })
})

// ── display names ──────────────────────────────────────────────────────

describe('dsh provider - display names', () => {
  const provider = createDshProvider('/tmp')

  it('names the collector and prices the route under its wire model', () => {
    expect(provider.name).toBe('dsh')
    expect(provider.displayName).toBe('DeepSeek Harness')
    expect(provider.modelDisplayName('deepseek-flash')).toBe('DeepSeek v4 Flash')
  })

  it('normalizes DSH tool names to the canonical set', () => {
    expect(provider.toolDisplayName('pwsh')).toBe('Bash')
    expect(provider.toolDisplayName('str_replace_editor')).toBe('Edit')
    expect(provider.toolDisplayName('mcp__github__create_issue')).toBe('mcp__github__create_issue')
    expect(provider.toolDisplayName('job_output')).toBe('job_output')
  })
})
