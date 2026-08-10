import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { createCodexProvider } from '../../src/providers/codex.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'codex-legacy-meta-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function cumulativeTokenCount(
  timestamp: string,
  total: { input: number; cached: number; output: number; reasoning: number },
): string {
  return JSON.stringify({
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'token_count',
      info: {
        model: 'gpt-5.4',
        total_token_usage: {
          input_tokens: total.input,
          cached_input_tokens: total.cached,
          output_tokens: total.output,
          reasoning_output_tokens: total.reasoning,
          total_tokens: total.input + total.output + total.reasoning,
        },
      },
    },
  })
}

describe('codex provider - legacy session_meta identity', () => {
  it('discovers payload.id sessions and preserves cumulative token deltas', async () => {
    const sessionDir = join(tmpDir, 'sessions', '2026', '02', '23')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(
      join(sessionDir, 'rollout-legacy.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-02-23T10:00:00Z',
          payload: {
            id: 'legacy-session-001',
            cwd: '/Users/test/legacy-project',
            originator: 'codex-cli',
            model: 'gpt-5.4',
          },
        }),
        cumulativeTokenCount('2026-02-23T10:01:00Z', {
          input: 100,
          cached: 20,
          output: 50,
          reasoning: 10,
        }),
        cumulativeTokenCount('2026-02-23T10:02:00Z', {
          input: 160,
          cached: 30,
          output: 80,
          reasoning: 20,
        }),
      ].join('\n') + '\n',
    )

    const provider = createCodexProvider(tmpDir)
    const sessions = await provider.discoverSessions()

    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.project).toBe('Users-test-legacy-project')

    const calls: ParsedProviderCall[] = []
    const seenKeys = new Set<string>()
    for await (const call of provider.createSessionParser(sessions[0]!, seenKeys).parse()) {
      calls.push(call)
    }

    expect(calls).toHaveLength(2)
    expect(calls.every(call => call.sessionId === 'legacy-session-001')).toBe(true)
    expect(calls.reduce((sum, call) => sum + call.inputTokens, 0)).toBe(130)
    expect(calls.reduce((sum, call) => sum + call.cacheReadInputTokens, 0)).toBe(30)
    expect(calls.reduce((sum, call) => sum + call.outputTokens, 0)).toBe(80)
    expect(calls.reduce((sum, call) => sum + call.reasoningTokens, 0)).toBe(20)
  })
})
