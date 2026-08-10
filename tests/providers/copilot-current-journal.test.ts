import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { createCopilotProvider } from '../../src/providers/copilot.js'
import {
  replayCopilotChatJournal,
  withCopilotChatJournalAccounting,
} from '../../src/providers/copilot-chat-journal.js'
import type { ParsedProviderCall, SessionSource } from '../../src/providers/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function writeJournal(lines: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'metrora-copilot-journal-'))
  tempDirs.push(dir)
  const path = join(dir, 'session.jsonl')
  await writeFile(path, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`, 'utf-8')
  return path
}

function request(
  requestId: string,
  promptTokens: number,
  completionTokens: number,
  reasoningTokens = 0,
): Record<string, unknown> {
  return {
    requestId,
    timestamp: 1_784_000_000_000,
    modelId: 'copilot/gpt-5.4',
    promptTokens,
    completionTokens,
    result: {
      metadata: {
        resolvedModel: 'gpt-5.4',
        toolCallRounds: reasoningTokens > 0
          ? [{ thinking: { tokens: reasoningTokens } }]
          : [],
      },
    },
  }
}

describe('Copilot current VS Code chat journal accounting', () => {
  it('replays kind=2 splice semantics instead of retaining stale request versions', () => {
    const oldRequest = request('request-1', 100, 10)
    const freshRequest = request('request-1', 120, 20, 5)

    const replayed = replayCopilotChatJournal([
      { kind: 0, v: { sessionId: 'session-1', requests: [oldRequest] } },
      { kind: 2, k: ['requests'], i: 0, v: [freshRequest] },
    ].map(line => JSON.stringify(line)).join('\n')) as { requests: Array<Record<string, unknown>> }

    expect(replayed.requests).toHaveLength(1)
    expect(replayed.requests[0]?.['promptTokens']).toBe(120)
    expect(replayed.requests[0]?.['completionTokens']).toBe(20)
  })

  it('accounts top-level usage and separately observed reasoning from the final request state', async () => {
    const path = await writeJournal([
      {
        kind: 0,
        v: {
          sessionId: 'session-2',
          creationDate: 1_784_000_000_000,
          requests: [request('request-2', 100, 10)],
        },
      },
      {
        kind: 2,
        k: ['requests'],
        i: 0,
        v: [request('request-2', 120, 20, 5)],
      },
    ])

    const provider = withCopilotChatJournalAccounting(createCopilotProvider())
    const source = {
      path,
      project: 'fixture',
      provider: 'copilot',
      sourceType: 'chatsession',
    } as SessionSource & { sourceType: 'chatsession' }

    const calls: ParsedProviderCall[] = []
    for await (const call of provider.createSessionParser(source, new Set()).parse()) {
      calls.push(call)
    }

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      deduplicationKey: 'copilot-chatsession:session-2:request-2',
      model: 'gpt-5.4',
      inputTokens: 120,
      outputTokens: 20,
      reasoningTokens: 5,
    })
  })

  it('honors kind=1 updates and kind=3 deletes during reconstruction', () => {
    const replayed = replayCopilotChatJournal([
      { kind: 0, v: { requests: [request('request-3', 100, 10)] } },
      { kind: 1, k: ['requests', 0, 'promptTokens'], v: 140 },
      { kind: 3, k: ['requests', 0, 'completionTokens'] },
    ].map(line => JSON.stringify(line)).join('\n')) as { requests: Array<Record<string, unknown>> }

    expect(replayed.requests[0]?.['promptTokens']).toBe(140)
    expect(replayed.requests[0]?.['completionTokens']).toBeUndefined()
  })
})
