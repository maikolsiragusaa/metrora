import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createCodexProvider } from './codex.js'

let root: string | undefined
const savedCacheDir = process.env.METRORA_CACHE_DIR

afterEach(async () => {
  if (savedCacheDir === undefined) delete process.env.METRORA_CACHE_DIR
  else process.env.METRORA_CACHE_DIR = savedCacheDir
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

function usage(input: number, cached: number, output: number, reasoning: number) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + output + reasoning,
  }
}

describe('Codex reasoning attribution', () => {
  it('preserves effort changes per call, including a large compact turn_context line', async () => {
    root = await mkdtemp(join(tmpdir(), 'metrora-codex-reasoning-'))
    process.env.METRORA_CACHE_DIR = join(root, 'cache')
    const day = join(root, 'sessions', '2026', '07', '31')
    await mkdir(day, { recursive: true })
    const file = join(day, 'rollout-2026-07-31T00-00-00-session.jsonl')

    const first = usage(100, 20, 10, 5)
    const second = usage(220, 40, 25, 8)
    const lines = [
      { timestamp: '2026-07-31T00:00:00.000Z', type: 'session_meta', payload: { originator: 'codex_cli_rs', session_id: 'session', cwd: root, model: 'gpt-5.6-sol' } },
      { timestamp: '2026-07-31T00:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol', padding: 'x'.repeat(40_000), collaboration_mode: { settings: { reasoning_effort: 'high' } } } },
      { timestamp: '2026-07-31T00:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { model: 'gpt-5.6-sol', last_token_usage: first, total_token_usage: first } } },
      { timestamp: '2026-07-31T00:00:03.000Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol', collaboration_mode: { settings: { reasoning_effort: 'low' } } } },
      { timestamp: '2026-07-31T00:00:04.000Z', type: 'event_msg', payload: { type: 'token_count', info: { model: 'gpt-5.6-sol', last_token_usage: { ...second, input_tokens: 120, cached_input_tokens: 20, output_tokens: 15, reasoning_output_tokens: 3, total_tokens: 138 }, total_token_usage: second } } },
    ]
    await writeFile(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n')

    const provider = createCodexProvider(root)
    const sources = await provider.discoverSessions()
    expect(sources).toHaveLength(1)
    const calls = []
    for await (const call of provider.createSessionParser(sources[0]!, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(2)
    expect(calls.map(call => [call.reasoningLevel, call.reasoningLevelSource])).toEqual([
      ['high', 'explicit'],
      ['low', 'explicit'],
    ])
    expect(calls.map(call => call.model)).toEqual(['gpt-5.6-sol', 'gpt-5.6-sol'])
  })
})
