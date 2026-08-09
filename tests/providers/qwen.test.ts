import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { createQwenProvider } from '../../src/providers/qwen.js'

describe('qwen provider', () => {
  it('retains reasoning/cache-only usage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qwen-test-'))
    try {
      const path = join(root, 'session.jsonl')
      await writeFile(path, [
        JSON.stringify({
          uuid: 'user-1', sessionId: 'session-1', timestamp: '2026-05-12T10:00:00.000Z', type: 'user',
          message: { role: 'user', parts: [{ text: 'hello' }] },
        }),
        JSON.stringify({
          uuid: 'assistant-1', sessionId: 'session-1', timestamp: '2026-05-12T10:00:01.000Z', type: 'assistant', model: 'qwen3',
          usageMetadata: {
            promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 7,
            totalTokenCount: 18, cachedContentTokenCount: 11,
          },
          message: { role: 'model', parts: [{ text: 'done', thought: true }] },
        }),
      ].join('\n') + '\n')

      const provider = createQwenProvider(root)
      const calls: any[] = []
      for await (const call of provider.createSessionParser({ path, project: 'qwen', provider: 'qwen' }, new Set()).parse()) {
        calls.push(call)
      }

      expect(calls).toHaveLength(1)
      expect(calls[0].inputTokens).toBe(0)
      expect(calls[0].outputTokens).toBe(0)
      expect(calls[0].reasoningTokens).toBe(7)
      expect(calls[0].cacheReadInputTokens).toBe(11)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
