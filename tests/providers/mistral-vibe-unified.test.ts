import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { createMistralVibeProvider } from '../../src/providers/mistral-vibe.js'
import { calculateCost } from '../../src/models.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

let tmpDir: string

const PRICED_MODEL = 'mistral-medium-3.5'

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mistral-vibe-unified-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function unifiedMetadata(opts: {
  sessionId?: string
  cwd?: string
  title?: string
  modelName?: string
  activeModel?: string
} = {}) {
  return {
    session_id: opts.sessionId ?? 'unified-session-1',
    start_time: '2026-11-21T15:28:15.825000+00:00',
    end_time: '2026-11-21T22:55:35.027000+00:00',
    environment: {
      working_directory: opts.cwd ?? 'C:/Users/test/vibe-desktop-project',
    },
    config: {
      active_model: opts.activeModel ?? PRICED_MODEL,
      model_name: opts.modelName ?? PRICED_MODEL,
    },
    title: opts.title ?? 'measure desktop sessions',
  }
}

function turnStart(text: string) {
  return {
    type: 'command_reserved',
    payload: {
      method: 'turn/start',
      params: { entries: [{ role: 'user', content: [{ type: 'text', text }] }] },
    },
  }
}

function usage(
  input: number,
  output: number,
  cached: number,
  cacheWrite = 0,
  reasoning = 0,
) {
  return {
    input_tokens: input,
    output_tokens: output,
    cached_input_tokens: cached,
    cache_write_tokens: cacheWrite,
    reasoning_tokens: reasoning,
    total_tokens: input + output,
  }
}

function bashPart(command: string) {
  return { type: 'tool_call', name: 'bash', arguments_json: JSON.stringify({ command }) }
}

function completion(
  actionId: string,
  recordUsage: Record<string, number>,
  parts: Array<Record<string, unknown>> = [],
) {
  return {
    type: 'action_result',
    payload: {
      action_id: actionId,
      state: 'succeeded',
      result: {
        type: 'completion_succeeded',
        result: { finish_reason: 'tool_call', parts, usage: recordUsage },
      },
    },
  }
}

async function writeUnifiedSession(
  name: string,
  meta: Record<string, unknown>,
  journals: Record<string, Array<Record<string, unknown>>>,
  root = tmpDir,
): Promise<string> {
  const sessionDir = join(root, 'unified', name)
  await mkdir(join(sessionDir, 'journal'), { recursive: true })
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2))
  for (const [file, records] of Object.entries(journals)) {
    await writeFile(
      join(sessionDir, 'journal', file),
      records.map(record => JSON.stringify(record)).join('\n') + '\n',
    )
  }
  return sessionDir
}

async function collect(
  sourcePath: string,
  provider = createMistralVibeProvider(tmpDir),
  seen = new Set<string>(),
): Promise<ParsedProviderCall[]> {
  const calls: ParsedProviderCall[] = []
  for await (const call of provider.createSessionParser({
    path: sourcePath,
    project: 'vibe-desktop-project',
    provider: 'mistral-vibe',
  }, seen).parse()) {
    calls.push(call)
  }
  return calls
}

describe('mistral-vibe provider - unified store discovery', () => {
  it('discovers journal segments and derives the project from metadata cwd', async () => {
    const sessionDir = await writeUnifiedSession(
      'unified-session-1',
      unifiedMetadata({ cwd: 'C:/Users/test/desktop-project' }),
      { '0000000000010000.jsonl': [turnStart('hello'), completion('action-1', usage(1000, 100, 100))] },
    )

    const sessions = await createMistralVibeProvider(tmpDir).discoverSessions()

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toEqual({
      path: join(sessionDir, 'journal', '0000000000010000.jsonl'),
      project: 'desktop-project',
      provider: 'mistral-vibe',
    })
  })

  it('issues one source per journal segment so appends stay observable', async () => {
    const sessionDir = await writeUnifiedSession(
      'unified-session-2',
      unifiedMetadata({ sessionId: 'unified-session-2' }),
      {
        '0000000000010000.jsonl': [turnStart('first')],
        '0000000000020000.jsonl': [completion('action-2', usage(10, 5, 0))],
      },
    )

    const sessions = await createMistralVibeProvider(tmpDir).discoverSessions()

    expect(sessions.map(session => session.path).sort()).toEqual([
      join(sessionDir, 'journal', '0000000000010000.jsonl'),
      join(sessionDir, 'journal', '0000000000020000.jsonl'),
    ].sort())
  })

  it('ignores unified session directories without a journal store', async () => {
    const sessionDir = join(tmpDir, 'unified', 'no-journal')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(unifiedMetadata()))

    await expect(createMistralVibeProvider(tmpDir).discoverSessions()).resolves.toEqual([])
  })

  it('still discovers the legacy meta.json plus messages.jsonl layout', async () => {
    const legacyDir = join(tmpDir, 'session_legacy')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'meta.json'), JSON.stringify({
      session_id: 'legacy-session',
      start_time: '2026-05-11T10:00:00+00:00',
      end_time: '2026-05-11T10:05:00+00:00',
      environment: { working_directory: '/Users/test/legacy-project' },
      stats: { session_prompt_tokens: 10, session_completion_tokens: 20 },
      config: { active_model: PRICED_MODEL },
    }))
    await writeFile(join(legacyDir, 'messages.jsonl'), JSON.stringify({ role: 'user', content: 'hi' }) + '\n')

    const sessions = await createMistralVibeProvider(tmpDir).discoverSessions()

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toEqual({ path: legacyDir, project: 'legacy-project', provider: 'mistral-vibe' })
  })

  it('reports the unified probe root only when the store exists', async () => {
    await expect(createMistralVibeProvider(tmpDir).probeRoots!()).resolves.toEqual([
      { path: tmpDir, label: 'session' },
    ])

    await mkdir(join(tmpDir, 'unified'), { recursive: true })

    await expect(createMistralVibeProvider(tmpDir).probeRoots!()).resolves.toEqual([
      { path: tmpDir, label: 'session' },
      { path: join(tmpDir, 'unified'), label: 'unified' },
    ])
  })
})

describe('mistral-vibe provider - unified store parsing', () => {
  it('reads per-call usage, cache reads, tools and the turn prompt', async () => {
    const sessionDir = await writeUnifiedSession(
      'unified-session-1',
      unifiedMetadata(),
      {
        '0000000000010000.jsonl': [
          turnStart('check the desktop session'),
          completion('action-1', usage(1000, 100, 100, 50, 25), [
            bashPart('npm test && git status'),
            { type: 'reasoning' },
          ]),
        ],
      },
    )

    const calls = await collect(join(sessionDir, 'journal', '0000000000010000.jsonl'))

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.provider).toBe('mistral-vibe')
    expect(call.model).toBe(PRICED_MODEL)
    expect(call.inputTokens).toBe(900)
    expect(call.cacheReadInputTokens).toBe(100)
    expect(call.cachedInputTokens).toBe(100)
    expect(call.cacheCreationInputTokens).toBe(50)
    expect(call.outputTokens).toBe(100)
    expect(call.reasoningTokens).toBe(25)
    expect(call.webSearchRequests).toBe(0)
    expect(call.speed).toBe('standard')
    expect(call.costIsEstimated).toBe(true)
    expect(call.usageEvidence).toBe('complete')
    expect(call.cacheTokenEvidence).toBe('complete')
    expect(call.reasoningSemantics).toBe('aggregate-output')
    expect(call.tools).toEqual(['Bash'])
    expect(call.bashCommands).toEqual(['npm', 'git'])
    expect(call.userMessage).toBe('check the desktop session')
    expect(call.sessionId).toBe('unified-session-1')
    expect(call.deduplicationKey).toBe('mistral-vibe:unified-session-1:unified:action-1')
    expect(Number.isNaN(Date.parse(call.timestamp))).toBe(false)
    expect(call.timestamp).not.toBe('2026-11-21T22:55:35.027000+00:00')
  })

  it('never bills cached tokens again as fresh input', async () => {
    const sessionDir = await writeUnifiedSession(
      'unified-session-3',
      unifiedMetadata({ sessionId: 'unified-session-3' }),
      { '0000000000010000.jsonl': [completion('action-3', usage(100, 10, 500))] },
    )

    const calls = await collect(join(sessionDir, 'journal', '0000000000010000.jsonl'))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.inputTokens).toBe(0)
    expect(calls[0]!.cacheReadInputTokens).toBe(500)
  })

  it('does not re-bill reasoning that Vibe already counted inside output', async () => {
    const sessionDir = await writeUnifiedSession(
      'unified-session-4',
      unifiedMetadata({ sessionId: 'unified-session-4' }),
      { '0000000000010000.jsonl': [completion('action-4', usage(1000, 100, 100, 50, 40))] },
    )

    const calls = await collect(join(sessionDir, 'journal', '0000000000010000.jsonl'))

    expect(calls).toHaveLength(1)
    const cost = calls[0]!.costUSD
    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeCloseTo(calculateCost(PRICED_MODEL, 900, 100, 50, 100, 0), 12)
    expect(cost).not.toBeCloseTo(calculateCost(PRICED_MODEL, 900, 140, 50, 100, 0), 12)
  })

  it('deduplicates an action replayed into two journal segments', async () => {
    const sessionDir = await writeUnifiedSession(
      'unified-session-5',
      unifiedMetadata({ sessionId: 'unified-session-5' }),
      {
        '0000000000010000.jsonl': [completion('action-5', usage(500, 50, 100))],
        '0000000000020000.jsonl': [completion('action-5', usage(500, 50, 100))],
      },
    )

    const seen = new Set<string>()
    const first = await collect(join(sessionDir, 'journal', '0000000000010000.jsonl'), createMistralVibeProvider(tmpDir), seen)
    const second = await collect(join(sessionDir, 'journal', '0000000000020000.jsonl'), createMistralVibeProvider(tmpDir), seen)

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
  })

  it('re-parsing the same segment yields no duplicates', async () => {
    const sessionDir = await writeUnifiedSession(
      'unified-session-6',
      unifiedMetadata({ sessionId: 'unified-session-6' }),
      { '0000000000010000.jsonl': [completion('action-6', usage(200, 20, 50))] },
    )

    const provider = createMistralVibeProvider(tmpDir)
    const seen = new Set<string>()
    const journalPath = join(sessionDir, 'journal', '0000000000010000.jsonl')

    expect(await collect(journalPath, provider, seen)).toHaveLength(1)
    expect(await collect(journalPath, provider, seen)).toHaveLength(0)
  })

  it('skips a segment whose session metadata is missing', async () => {
    const sessionDir = join(tmpDir, 'unified', 'no-meta', 'journal')
    await mkdir(sessionDir, { recursive: true })
    const journalPath = join(sessionDir, '0000000000010000.jsonl')
    await writeFile(journalPath, JSON.stringify(completion('action-7', usage(10, 5, 0))) + '\n')

    await expect(collect(journalPath)).resolves.toEqual([])
  })

  it('ignores completions that carry no usage counters', async () => {
    const sessionDir = await writeUnifiedSession(
      'unified-session-8',
      unifiedMetadata({ sessionId: 'unified-session-8' }),
      {
        '0000000000010000.jsonl': [
          { type: 'action_result', payload: { action_id: 'action-8', result: { type: 'completion_succeeded', result: {} } } },
          completion('action-9', usage(0, 0, 0)),
          completion('action-10', usage(70, 7, 0)),
        ],
      },
    )

    const calls = await collect(join(sessionDir, 'journal', '0000000000010000.jsonl'))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.deduplicationKey).toBe('mistral-vibe:unified-session-8:unified:action-10')
  })

  it('falls back to session metadata when a segment cannot be stat-ed after discovery', async () => {
    const sessionDir = await writeUnifiedSession(
      'unified-session-9',
      unifiedMetadata({ sessionId: 'unified-session-9' }),
      { '0000000000010000.jsonl': [completion('action-11', usage(30, 3, 0))] },
    )

    const calls = await collect(join(sessionDir, 'journal', '0000000000010000.jsonl'))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.sessionId).toBe('unified-session-9')
  })
})
