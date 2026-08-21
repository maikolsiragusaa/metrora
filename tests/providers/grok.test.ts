import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { createGrokProvider } from '../../src/providers/grok.js'
import { calculateCost } from '../../src/models.js'
import { billableOutputTokens, generatedTokensForReasoningMix } from '../../src/token-semantics.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

// Pin the unpriced attribution branch without depending on whichever mutable
// LiteLLM snapshot happens to be bundled on a future test run. The real pricing
// implementation remains in use for settlement and cost assertions.
vi.mock('../../src/models.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/models.js')>()
  return {
    ...actual,
    getModelCosts: (model: string) => model === 'grok-unpriced-test' ? null : actual.getModelCosts(model),
  }
})

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'grok-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// Mirrors the real on-disk layout:
// <sessionsDir>/<url-encoded-cwd>/<uuid>/{summary.json, signals.json, updates.jsonl}
async function writeSession(opts: {
  cwdEncoded?: string
  uuid?: string
  cwd?: string
  model?: string
  turns?: Array<{ promptId: string; totals: number[] }>
  completedTurns?: Array<{ promptId?: string; usage: unknown }>
  toolCalls?: Array<{ title: string; rawInput: Record<string, unknown> }>
  toolsUsed?: string[]
} = {}) {
  const cwdEncoded = opts.cwdEncoded ?? '%2FUsers%2Ftest'
  const uuid = opts.uuid ?? '019edf9c-0000-7000-8000-000000000001'
  const cwd = opts.cwd ?? '/Users/test/myproject'
  const model = opts.model ?? 'grok-build'
  const dir = join(tmpDir, cwdEncoded, uuid)
  await mkdir(dir, { recursive: true })

  await writeFile(join(dir, 'summary.json'), JSON.stringify({
    info: { id: uuid, cwd },
    created_at: '2026-06-19T11:20:40.686261Z',
    updated_at: '2026-06-19T11:31:12.282793Z',
    last_active_at: '2026-06-19T11:31:12.222328Z',
    num_messages: 42,
    current_model_id: model,
    session_summary: 'User asks about the repo',
    generated_title: 'User asks about the repo',
  }))

  await writeFile(join(dir, 'signals.json'), JSON.stringify({
    primaryModelId: model,
    modelsUsed: [model],
    toolsUsed: opts.toolsUsed ?? ['read_file', 'run_terminal_command', 'grep'],
    contextTokensUsed: 40000,
    contextWindowTokens: 512000,
  }))

  const turns = opts.turns ?? [
    { promptId: 'p1', totals: [20000, 25000] },
    { promptId: 'p2', totals: [30000, 35000] },
    { promptId: 'p3', totals: [40000, 45000] },
  ]
  const lines: string[] = []
  for (const turn of turns) {
    for (const total of turn.totals) {
      lines.push(JSON.stringify({
        timestamp: '2026-06-19T11:30:00.000Z',
        method: 'session/update',
        params: {
          sessionId: uuid,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
          _meta: { totalTokens: total, promptId: turn.promptId, updateType: 'AgentMessageChunk', modelId: model },
        },
      }))
    }
  }
  for (const completed of opts.completedTurns ?? []) {
    lines.push(JSON.stringify({
      timestamp: '2026-06-19T11:30:04.000Z',
      method: '_x.ai/session/update',
      params: {
        sessionId: uuid,
        update: {
          sessionUpdate: 'turn_completed',
          ...(completed.promptId === undefined ? {} : { prompt_id: completed.promptId }),
          usage: completed.usage,
        },
      },
    }))
  }
  for (const tc of opts.toolCalls ?? [
    { title: 'read_file', rawInput: { target_directory: '.' } },
    { title: 'grep', rawInput: { pattern: 'x' } },
    { title: 'run_terminal_command', rawInput: { command: 'git status' } },
    { title: 'spawn_subagent', rawInput: { subagent_type: 'general-purpose', prompt: 'x' } },
  ]) {
    lines.push(JSON.stringify({
      timestamp: '2026-06-19T11:30:05.000Z',
      method: 'session/update',
      params: { sessionId: uuid, update: { sessionUpdate: 'tool_call', toolCallId: 'c1', title: tc.title, rawInput: tc.rawInput } },
    }))
  }
  await writeFile(join(dir, 'updates.jsonl'), lines.join('\n') + '\n')

  return { dir, uuid }
}

function authoritativeUsage(opts: {
  input?: number
  output?: number
  cacheRead?: number
  cacheCreation?: number
  reasoning?: number
  modelUsage?: Record<string, unknown>
} = {}): Record<string, unknown> {
  const input = opts.input ?? 1000
  const output = opts.output ?? 200
  const cacheRead = opts.cacheRead ?? 0
  const cacheCreation = opts.cacheCreation ?? 0
  const reasoning = opts.reasoning ?? 0
  return {
    inputTokens: input,
    outputTokens: output,
    cachedReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
    reasoningTokens: reasoning,
    costUsdTicks: 999_999_999,
    modelUsage: opts.modelUsage ?? {
      'grok-build': { inputTokens: input, outputTokens: output },
    },
  }
}

describe('grok provider - discovery', () => {
  it('discovers each session dir and derives project from cwd', async () => {
    await writeSession({ cwd: '/Users/test/myproject' })
    const sessions = await createGrokProvider(tmpDir).discoverSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.provider).toBe('grok')
    expect(sessions[0]!.project).toBe('myproject')
    expect(sessions[0]!.path).toMatch(/updates\.jsonl$/)
  })

  it('returns empty for a non-existent sessions dir', async () => {
    const sessions = await createGrokProvider('/nope/does/not/exist').discoverSessions()
    expect(sessions).toEqual([])
  })

  it('skips directories without a summary.json', async () => {
    await mkdir(join(tmpDir, '%2Ftmp', 'not-a-session'), { recursive: true })
    const sessions = await createGrokProvider(tmpDir).discoverSessions()
    expect(sessions).toEqual([])
  })
})

describe('grok provider - parsing', () => {
  async function parse(seen = new Set<string>()) {
    const provider = createGrokProvider(tmpDir)
    const [source] = await provider.discoverSessions()
    const calls: ParsedProviderCall[] = []
    if (!source) return calls
    for await (const call of provider.createSessionParser(source, seen).parse()) {
      calls.push(call)
    }
    return calls
  }

  it('emits one estimated call per session from the totalTokens curve', async () => {
    await writeSession()
    const calls = await parse()
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.model).toBe('grok-build')
    // input = peak context (max totalTokens across the session)
    expect(call.inputTokens).toBe(45000)
    // cache reads = re-sent context (sum of per-turn starts 90000 minus peak 45000)
    expect(call.cacheReadInputTokens).toBe(45000)
    // output = sum of per-turn growth (3 turns x 5000)
    expect(call.outputTokens).toBe(15000)
    expect(call.costIsEstimated).toBe(true)
    expect(call.costUSD).toBeGreaterThan(0)
    expect(call.tools).toEqual(['Read', 'Grep', 'Bash', 'Agent'])
    expect(call.bashCommands).toContain('git')
    expect(call.subagentTypes).toEqual(['general-purpose'])
    expect(call.project).toBe('myproject')
    expect(call.deduplicationKey).toContain('grok:')
  })

  it('uses provider-reported completed-turn usage with inclusive output semantics', async () => {
    await writeSession({
      turns: [],
      completedTurns: [{
        promptId: 'authoritative-1',
        usage: authoritativeUsage({ input: 1000, output: 200, cacheRead: 500, cacheCreation: 100, reasoning: 150 }),
      }],
    })

    const [call] = await parse()
    expect(call).toMatchObject({
      inputTokens: 400,
      cacheReadInputTokens: 500,
      cacheCreationInputTokens: 100,
      outputTokens: 200,
      reasoningTokens: 150,
      reasoningSemantics: 'aggregate-output',
      cacheTokenEvidence: 'complete',
      costIsEstimated: false,
    })
    expect(generatedTokensForReasoningMix(call!.outputTokens, call!.reasoningTokens, call!.reasoningSemantics)).toBe(200)
    expect(billableOutputTokens('grok', call!.outputTokens, call!.reasoningTokens, call!.reasoningSemantics)).toBe(200)
    expect(call!.costUSD).toBe(calculateCost('grok-build', 400, 200, 100, 500, 0))
    expect(call!.costUSD).not.toBe(calculateCost('grok-build', 400, 350, 100, 500, 0))
  })

  it('normalizes multiple completed turns independently before summing', async () => {
    await writeSession({
      turns: [],
      completedTurns: [
        { promptId: 'p1', usage: authoritativeUsage({ input: 1000, output: 100, cacheRead: 600, cacheCreation: 50, reasoning: 10 }) },
        { promptId: 'p2', usage: authoritativeUsage({ input: 2000, output: 200, cacheRead: 1000, cacheCreation: 100, reasoning: 20 }) },
      ],
    })

    const [call] = await parse()
    expect(call).toMatchObject({
      inputTokens: 1250,
      cacheReadInputTokens: 1600,
      cacheCreationInputTokens: 150,
      outputTokens: 300,
      reasoningTokens: 30,
      cacheTokenEvidence: 'complete',
    })
  })

  it('uses the last completed record for a repeated prompt id', async () => {
    await writeSession({
      turns: [],
      completedTurns: [
        { promptId: 'same-prompt', usage: authoritativeUsage({ input: 500, output: 50, cacheRead: 100, reasoning: 5 }) },
        { promptId: 'same-prompt', usage: authoritativeUsage({ input: 800, output: 80, cacheRead: 200, cacheCreation: 25, reasoning: 8 }) },
      ],
    })

    const [call] = await parse()
    expect(call).toMatchObject({
      inputTokens: 575,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: 25,
      outputTokens: 80,
      reasoningTokens: 8,
    })
  })

  it('falls back when a valid duplicate is superseded by all-zero usage', async () => {
    await writeSession({
      turns: [{ promptId: 'same-prompt', totals: [10000, 15000] }],
      completedTurns: [
        { promptId: 'same-prompt', usage: authoritativeUsage({ input: 500, output: 50, cacheRead: 100 }) },
        { promptId: 'same-prompt', usage: authoritativeUsage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, reasoning: 0 }) },
      ],
    })

    const [call] = await parse()
    expect(call).toMatchObject({ inputTokens: 15000, outputTokens: 5000, costIsEstimated: true })
    expect(call).not.toHaveProperty('reasoningSemantics')
  })

  it('falls back when a valid duplicate is superseded by malformed usage', async () => {
    await writeSession({
      turns: [{ promptId: 'same-prompt', totals: [10000, 15000] }],
      completedTurns: [
        { promptId: 'same-prompt', usage: authoritativeUsage({ input: 500, output: 50, cacheRead: 100 }) },
        { promptId: 'same-prompt', usage: { inputTokens: 'bad', outputTokens: 'bad', modelUsage: { 'grok-build': {} } } },
      ],
    })

    const [call] = await parse()
    expect(call).toMatchObject({ inputTokens: 15000, outputTokens: 5000, costIsEstimated: true })
  })

  it('does not treat modelUsage-only records as accounting authority', async () => {
    await writeSession({
      turns: [{ promptId: 'streaming', totals: [10000, 12000] }],
      completedTurns: [{ promptId: 'streaming', usage: { modelUsage: { 'grok-build': { outputTokens: 200 } } } }],
    })

    const [call] = await parse()
    expect(call).toMatchObject({ inputTokens: 12000, outputTokens: 2000, costIsEstimated: true })
  })

  it('uses only the authoritative subtotal for mixed coverage and marks it estimated', async () => {
    await writeSession({
      turns: [
        { promptId: 'covered', totals: [10000, 12000] },
        { promptId: 'uncovered', totals: [14000, 17000] },
      ],
      completedTurns: [{
        promptId: 'covered',
        usage: authoritativeUsage({ input: 1000, output: 200, cacheRead: 500, cacheCreation: 100, reasoning: 150 }),
      }],
    })

    const [call] = await parse()
    expect(call).toMatchObject({
      inputTokens: 400,
      cacheReadInputTokens: 500,
      cacheCreationInputTokens: 100,
      outputTokens: 200,
      reasoningTokens: 150,
      costIsEstimated: true,
    })
  })

  it('preserves cache evidence quality for complete, partial, unavailable, and inconsistent records', async () => {
    await writeSession({
      turns: [],
      completedTurns: [{
        promptId: 'partial',
        usage: { inputTokens: 1000, outputTokens: 200, cachedReadTokens: 500, reasoningTokens: 0 },
      }],
    })
    let [call] = await parse()
    expect(call).toMatchObject({ inputTokens: 500, cacheReadInputTokens: 500, cacheCreationInputTokens: 0, cacheTokenEvidence: 'partial', costIsEstimated: true })

    await writeSession({
      uuid: '019edf9c-0000-7000-8000-000000000002',
      turns: [],
      completedTurns: [{ promptId: 'unavailable', usage: { inputTokens: 1000, outputTokens: 200, reasoningTokens: 0 } }],
    })
    const provider = createGrokProvider(tmpDir)
    const sources = await provider.discoverSessions()
    const unavailableCalls: ParsedProviderCall[] = []
    const unavailableSource = sources.find(source => source.path.includes('000000000002'))!
    for await (const item of provider.createSessionParser(unavailableSource, new Set()).parse()) unavailableCalls.push(item)
    expect(unavailableCalls[0]).toMatchObject({ inputTokens: 1000, cacheTokenEvidence: 'unavailable', costIsEstimated: true })

    await writeSession({
      uuid: '019edf9c-0000-7000-8000-000000000003',
      turns: [],
      completedTurns: [{ promptId: 'inconsistent', usage: { inputTokens: 100, outputTokens: 200, cachedReadTokens: 80, cacheCreationTokens: 50, reasoningTokens: 20 } }],
    })
    const after = await provider.discoverSessions()
    const inconsistentCalls: ParsedProviderCall[] = []
    const inconsistentSource = after.find(source => source.path.includes('000000000003'))!
    for await (const item of provider.createSessionParser(inconsistentSource, new Set()).parse()) inconsistentCalls.push(item)
    expect(inconsistentCalls[0]).toMatchObject({ inputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheTokenEvidence: 'inconsistent', costIsEstimated: true })
  })

  it('bounds reasoning to inclusive output and keeps absent reasoning at zero', async () => {
    await writeSession({
      turns: [],
      completedTurns: [
        { promptId: 'bounded', usage: authoritativeUsage({ input: 1000, output: 200, reasoning: 350 }) },
      ],
    })
    const [bounded] = await parse()
    expect(bounded).toMatchObject({ outputTokens: 200, reasoningTokens: 200, reasoningSemantics: 'aggregate-output' })
    expect(generatedTokensForReasoningMix(bounded!.outputTokens, bounded!.reasoningTokens, bounded!.reasoningSemantics)).toBe(200)

    await writeSession({
      uuid: '019edf9c-0000-7000-8000-000000000004',
      turns: [],
      completedTurns: [{ promptId: 'absent', usage: { inputTokens: 1000, outputTokens: 200, cachedReadTokens: 0, cacheCreationTokens: 0 } }],
    })
    const provider = createGrokProvider(tmpDir)
    const sources = await provider.discoverSessions()
    const calls: ParsedProviderCall[] = []
    const absentSource = sources.find(source => source.path.includes('000000000004'))!
    for await (const item of provider.createSessionParser(absentSource, new Set()).parse()) calls.push(item)
    expect(calls[0]).toMatchObject({ reasoningTokens: 0, reasoningSemantics: 'aggregate-output' })
  })

  it('keeps one top-level call for multi-model usage and chooses a bounded priced attribution', async () => {
    await writeSession({
      turns: [],
      model: 'grok-build',
      completedTurns: [{
        promptId: 'multi-model',
        usage: authoritativeUsage({
          input: 3000,
          output: 300,
          cacheRead: 600,
          cacheCreation: 100,
          reasoning: 30,
          modelUsage: {
            'grok-unpriced-test': { inputTokens: 1000, outputTokens: 100 },
            'grok-build': { inputTokens: 2000, outputTokens: 200 },
          },
        }),
      }],
    })

    const calls = await parse()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ model: 'grok-build', inputTokens: 2300, outputTokens: 300, reasoningTokens: 30 })
  })

  it('skips a session with no token growth', async () => {
    await writeSession({ turns: [{ promptId: 'p1', totals: [0, 0] }] })
    expect(await parse()).toHaveLength(0)
  })

  it('deduplicates across repeated parses', async () => {
    await writeSession()
    const seen = new Set<string>()
    expect(await parse(seen)).toHaveLength(1)
    expect(await parse(seen)).toHaveLength(0)
  })

  it('sums fresh input across a compaction instead of only the last peak', async () => {
    await writeSession({ turns: [
      { promptId: 'p1', totals: [100000, 400000] },
      { promptId: 'p2', totals: [20000, 50000] },
    ] })
    const calls = await parse()
    expect(calls).toHaveLength(1)
    // 400k (segment 1 peak) + 50k (post-compaction segment), not just the 400k global peak
    expect(calls[0]!.inputTokens).toBe(450000)
  })
})

describe('grok provider - display names', () => {
  const provider = createGrokProvider('/tmp')

  it('has the right name and displayName', () => {
    expect(provider.name).toBe('grok')
    expect(provider.displayName).toBe('Grok Build')
  })

  it('labels grok-build', () => {
    expect(provider.modelDisplayName('grok-build')).toBe('Grok Build')
  })

  it('normalizes tool names', () => {
    expect(provider.toolDisplayName('run_terminal_command')).toBe('Bash')
    expect(provider.toolDisplayName('mystery_tool')).toBe('mystery_tool')
  })
})
