import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ParsedProviderCall, Provider } from './types.js'
import {
  CodexModelProviderContradictionError,
  readCodexSessionModelProvider,
  withCodexModelProvider,
} from './codex-model-provider.js'

const roots: string[] = []

async function source(lines: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'metrora-codex-provider-'))
  roots.push(root)
  const path = join(root, 'rollout.jsonl')
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
  return path
}

function call(overrides: Partial<ParsedProviderCall> = {}): ParsedProviderCall {
  return {
    provider: 'codex',
    model: 'gpt-5.6-luna',
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 25,
    cachedInputTokens: 25,
    reasoningTokens: 5,
    webSearchRequests: 0,
    costUSD: 0,
    tools: [],
    bashCommands: [],
    timestamp: '2026-08-01T22:00:00.000Z',
    speed: 'standard',
    deduplicationKey: 'codex:call:1',
    userMessage: '',
    sessionId: 'session_1',
    ...overrides,
  }
}

function provider(calls: ParsedProviderCall[]): Provider {
  return {
    name: 'codex',
    displayName: 'Codex',
    modelDisplayName: model => model,
    toolDisplayName: tool => tool,
    discoverSessions: async () => [],
    createSessionParser: () => ({
      async *parse() {
        for (const value of calls) yield value
      },
    }),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Codex source-recorded model provider', () => {
  it('reads and normalizes only session_meta.model_provider', async () => {
    const path = await source([
      JSON.stringify({ type: 'event_msg', payload: { model_provider: 'anthropic' } }),
      JSON.stringify({ type: 'session_meta', payload: { id: 's1', model_provider: 'OpenAI' } }),
    ])
    await expect(readCodexSessionModelProvider(path)).resolves.toBe('openai')
  })

  it('keeps missing, malformed, and unsupported values unknown', async () => {
    const missing = await source([
      JSON.stringify({ type: 'session_meta', payload: { id: 's1' } }),
    ])
    const unsupported = await source([
      '{broken-json',
      JSON.stringify({ type: 'session_meta', payload: { model_provider: '../private' } }),
    ])
    await expect(readCodexSessionModelProvider(missing)).resolves.toBeUndefined()
    await expect(readCodexSessionModelProvider(unsupported)).resolves.toBeUndefined()
  })

  it('adds the explicit provider before fresh calls enter the canonical cache', async () => {
    const path = await source([
      JSON.stringify({ type: 'session_meta', payload: { model_provider: 'openai' } }),
    ])
    const decorated = withCodexModelProvider(provider([call()]))
    const parsed = decorated.createSessionParser({
      path,
      project: 'Codex',
      provider: 'codex',
    }, new Set()).parse()

    const values: ParsedProviderCall[] = []
    for await (const value of parsed) values.push(value)
    expect(values).toHaveLength(1)
    expect(values[0]?.modelProvider).toBe('openai')
  })

  it('never overwrites or hides a contradictory parser provider', async () => {
    const path = await source([
      JSON.stringify({ type: 'session_meta', payload: { model_provider: 'openai' } }),
    ])
    const decorated = withCodexModelProvider(provider([call({ modelProvider: 'anthropic' })]))
    const parsed = decorated.createSessionParser({
      path,
      project: 'Codex',
      provider: 'codex',
    }, new Set()).parse()

    await expect(parsed.next()).rejects.toBeInstanceOf(CodexModelProviderContradictionError)
  })
})
