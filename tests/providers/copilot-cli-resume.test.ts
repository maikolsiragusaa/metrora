import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import {
  COPILOT_CLI_RESUME_PROVIDER,
} from '../../src/provider-parse-authorities.js'
import {
  createCopilotCliResumeProvider,
  withCopilotCliResumeAccounting,
} from '../../src/providers/copilot-cli-resume.js'
import { allProviderNames, getProvider } from '../../src/providers/index.js'
import type { Provider, SessionSource } from '../../src/providers/types.js'

function fakeCopilot(source: SessionSource): Provider {
  return {
    name: 'copilot',
    displayName: 'GitHub Copilot',
    durableSources: true,
    modelDisplayName: model => model,
    toolDisplayName: tool => tool,
    discoverSessions: async () => [source],
    createSessionParser: () => ({
      async *parse() { /* canonical parser is outside this characterization */ },
    }),
  }
}

describe('Copilot CLI resumed shutdown supplemental authority', () => {
  it('adds an internal source without replacing canonical Copilot discovery', async () => {
    const source = {
      path: '/tmp/copilot/session-a/events.jsonl',
      project: 'demo',
      provider: 'copilot',
      sourceType: 'jsonl',
    } as SessionSource
    const base = fakeCopilot(source)
    const wrapped = withCopilotCliResumeAccounting(base)

    const discovered = await wrapped.discoverSessions()
    expect(discovered).toHaveLength(2)
    expect(discovered[0]?.provider).toBe('copilot')
    expect(discovered[1]?.provider).toBe(COPILOT_CLI_RESUME_PROVIDER)
    expect(discovered[1]?.path).toBe(source.path)
  })

  it('emits only later shutdown deltas, including a counter-reset leg', async () => {
    const root = await mkdtemp(join(tmpdir(), 'metrora-copilot-resume-'))
    const sessionDir = join(root, 'session-a')
    await mkdir(sessionDir, { recursive: true })
    const eventsPath = join(sessionDir, 'events.jsonl')

    const rows = [
      { type: 'session.start', data: { selectedModel: 'gpt-5.3' }, timestamp: '2026-08-10T10:00:00.000Z' },
      { type: 'session.shutdown', data: { modelMetrics: { 'gpt-5.3': { usage: { inputTokens: 100, outputTokens: 8, cacheReadTokens: 20, cacheWriteTokens: 10, reasoningTokens: 5 } } } }, timestamp: '2026-08-10T10:05:00.000Z' },
      { type: 'session.shutdown', data: { modelMetrics: { 'gpt-5.3': { usage: { inputTokens: 180, outputTokens: 14, cacheReadTokens: 40, cacheWriteTokens: 15, reasoningTokens: 9 } } } }, timestamp: '2026-08-10T11:05:00.000Z' },
      // Counter reset: input falls below the prior cumulative total, so this leg
      // is measured from zero rather than clamped away.
      { type: 'session.shutdown', data: { modelMetrics: { 'gpt-5.3': { usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 1 } } } }, timestamp: '2026-08-10T12:05:00.000Z' },
    ]
    await writeFile(eventsPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n')

    const source = {
      path: eventsPath,
      project: 'demo',
      provider: COPILOT_CLI_RESUME_PROVIDER,
      sourceType: 'jsonl',
    } as SessionSource
    const provider = createCopilotCliResumeProvider(fakeCopilot(source))
    const calls = []
    for await (const call of provider.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(2)
    expect(calls.map(call => call.deduplicationKey)).toEqual([
      'copilot:session-a:shutdown:gpt-5.3:resume:2',
      'copilot:session-a:shutdown:gpt-5.3:resume:3',
    ])

    expect(calls[0]).toMatchObject({
      provider: 'copilot',
      sessionId: 'session-a',
      inputTokens: 55,
      outputTokens: 0,
      cacheReadInputTokens: 20,
      cacheCreationInputTokens: 5,
      reasoningTokens: 4,
    })
    expect(calls[1]).toMatchObject({
      provider: 'copilot',
      sessionId: 'session-a',
      inputTokens: 10,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      reasoningTokens: 1,
    })
  })

  it('keeps the supplemental namespace internal to public provider selection', async () => {
    expect(allProviderNames()).not.toContain(COPILOT_CLI_RESUME_PROVIDER)
    const internal = await getProvider(COPILOT_CLI_RESUME_PROVIDER)
    expect(internal?.name).toBe(COPILOT_CLI_RESUME_PROVIDER)
    expect(internal?.durableSources).toBe(true)
    expect(internal?.durableFreshWins).toBe(true)
  })
})
