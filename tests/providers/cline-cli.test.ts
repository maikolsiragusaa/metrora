import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { createClineCliProvider } from '../../src/providers/cline-cli.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'metrora-cline-cli-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

type SessionOptions = {
  dirName?: string
  sessionId?: string
  model?: string
  workspace?: string
  messages?: unknown[]
  usage?: Record<string, unknown>
  aggregateUsage?: Record<string, unknown>
  metadataTotalCost?: number
}

async function writeSession(options: SessionOptions = {}): Promise<void> {
  const dirName = options.dirName ?? options.sessionId ?? 'sess-a'
  const sessionId = options.sessionId ?? dirName
  const dir = join(root, dirName)
  await mkdir(dir, { recursive: true })

  const metadata: Record<string, unknown> = {}
  if (options.usage) metadata['usage'] = options.usage
  if (options.aggregateUsage) metadata['aggregateUsage'] = options.aggregateUsage
  if (options.metadataTotalCost !== undefined) metadata['totalCost'] = options.metadataTotalCost

  await writeFile(join(dir, `${dirName}.json`), JSON.stringify({
    version: 1,
    session_id: sessionId,
    source: 'cli',
    status: 'completed',
    provider: 'cline-pass',
    model: options.model ?? 'claude-sonnet-4-5',
    cwd: options.workspace ?? '/Users/dev/work/app',
    workspace_root: options.workspace ?? '/Users/dev/work/app',
    started_at: '2026-08-02T20:04:18.628Z',
    ended_at: '2026-08-02T20:08:27.768Z',
    metadata,
    messages_path: join(dir, `${dirName}.messages.json`),
  }))

  if (options.messages) {
    await writeFile(join(dir, `${dirName}.messages.json`), JSON.stringify({
      version: 1,
      sessionId,
      messages: options.messages,
    }))
  }
}

function assistant(
  id: string,
  metrics: Record<string, unknown>,
  content: unknown[] = [{ type: 'text', text: 'done' }],
  ts: number = 1785701064304,
): Record<string, unknown> {
  return {
    id,
    role: 'assistant',
    content,
    ts,
    metrics,
    modelInfo: { id: 'claude-sonnet-4-5', provider: 'cline-pass' },
  }
}

async function collect(seen = new Set<string>()): Promise<ParsedProviderCall[]> {
  const provider = createClineCliProvider(root)
  const sources = await provider.discoverSessions()
  const calls: ParsedProviderCall[] = []
  for (const source of sources) {
    for await (const call of provider.createSessionParser(source, seen).parse()) calls.push(call)
  }
  return calls
}

describe('cline-cli provider', () => {
  it('discovers only CLI session metadata under the isolated sessions root', async () => {
    await writeSession({ sessionId: 'sess-a', workspace: '/Users/dev/work/example' })
    await mkdir(join(root, 'not-a-session'), { recursive: true })
    await writeFile(join(root, 'not-a-session', 'other.json'), '{}')

    const provider = createClineCliProvider(root)
    const sources = await provider.discoverSessions()

    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ provider: 'cline-cli', project: 'example' })
    expect(sources[0]!.path).toBe(join(root, 'sess-a', 'sess-a.json'))
    await expect(provider.probeRoots!()).resolves.toEqual([{ path: root, label: 'Cline CLI sessions' }])
  })

  it('emits one call per assistant metrics block and binds reported cost as client-metered evidence', async () => {
    await writeSession({
      messages: [
        { id: 'u1', role: 'user', content: [{ type: 'text', text: 'fix the tests' }], ts: 1785701060000 },
        assistant('a1', {
          inputTokens: 6937,
          outputTokens: 213,
          cacheReadTokens: 17,
          cacheWriteTokens: 23,
          cost: 0.012345,
        }, [
          { type: 'text', text: 'working' },
          { type: 'tool_use', name: 'run_commands', input: { commands: '["npm test","git status"]' } },
          { type: 'tool_use', name: 'read_files', input: { path: 'src/main.ts' } },
          { type: 'tool_use', name: 'spawn_agent', input: { agent_type: 'reviewer' } },
        ]),
      ],
    })

    const calls = await collect()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      provider: 'cline-cli',
      model: 'claude-sonnet-4-5',
      inputTokens: 6937,
      outputTokens: 213,
      cacheReadInputTokens: 17,
      cacheCreationInputTokens: 23,
      costUSD: 0.012345,
      costIsEstimated: false,
      userMessage: 'fix the tests',
      tools: ['Bash', 'Read', 'Agent'],
      subagentTypes: ['reviewer'],
      sessionId: 'sess-a',
      project: 'app',
      projectPath: '/Users/dev/work/app',
    })
    expect(calls[0]!.costAssignment).toMatchObject({ kind: 'metered', source: 'client' })
    expect(calls[0]!.deduplicationKey).toBe('cline-cli:sess-a:a1')
    expect(calls[0]!.bashCommands.length).toBeGreaterThan(0)
  })

  it('keeps an explicit metered zero distinct from estimated or unavailable pricing', async () => {
    await writeSession({
      messages: [assistant('free', { inputTokens: 0, outputTokens: 0, cost: 0 })],
    })

    const [call] = await collect()
    expect(call).toBeDefined()
    expect(call!.costUSD).toBe(0)
    expect(call!.costIsEstimated).toBe(false)
    expect(call!.costAssignment).toMatchObject({ kind: 'metered', source: 'client', amountMicrosUsd: 0 })
  })

  it('falls back to Metrora pricing only when the CLI did not report a cost', async () => {
    await writeSession({
      messages: [assistant('estimated', { inputTokens: 1000, outputTokens: 200 })],
    })

    const [call] = await collect()
    expect(call).toBeDefined()
    expect(call!.costIsEstimated).toBe(true)
    expect(call!.costUSD).toBeGreaterThan(0)
    expect(call!.costAssignment).toBeUndefined()
  })

  it('uses the parent usage rollup only when no per-message metrics exist and ignores aggregate subagent usage', async () => {
    await writeSession({
      messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      usage: { inputTokens: 300, outputTokens: 40, cacheReadTokens: 20, cacheWriteTokens: 10, totalCost: 0.02 },
      aggregateUsage: { inputTokens: 9999, outputTokens: 9999, totalCost: 9.99 },
    })

    const [call] = await collect()
    expect(call).toMatchObject({
      inputTokens: 300,
      outputTokens: 40,
      cacheReadInputTokens: 20,
      cacheCreationInputTokens: 10,
      costUSD: 0.02,
      costIsEstimated: false,
      deduplicationKey: 'cline-cli:sess-a:rollup',
    })
    expect(call!.costAssignment).toMatchObject({ kind: 'metered', source: 'client' })
  })

  it('does not re-count a duplicated session through the rollup after all message calls dedup', async () => {
    for (const [dirName, withRollup] of [['aaa', false], ['bbb', true]] as const) {
      await writeSession({
        dirName,
        sessionId: 'shared',
        messages: [assistant('msg-0', { inputTokens: 100, outputTokens: 10, cost: 0.01 })],
        ...(withRollup ? { usage: { inputTokens: 100, outputTokens: 10, totalCost: 0.01 } } : {}),
      })
    }

    const calls = await collect()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.deduplicationKey).toBe('cline-cli:shared:msg-0')
    expect(calls.reduce((sum, call) => sum + call.costUSD, 0)).toBeCloseTo(0.01, 8)
  })

  it('promotes seconds-resolution timestamps instead of silently producing a 1970 date', async () => {
    await writeSession({
      messages: [assistant('seconds', { inputTokens: 10, outputTokens: 5, cost: 0.001 }, [], 1785701064)],
    })

    const [call] = await collect()
    expect(call!.timestamp.startsWith('2026-')).toBe(true)
  })
})
