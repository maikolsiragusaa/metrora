import { describe, expect, it } from 'vitest'

import {
  apiCallToCachedCall,
  compactEntry,
  dedupeStreamingMessageIds,
  getClaudeNativeIdentity,
  parseApiCall,
  reconcileClaudeNativeCalls,
} from '../src/parser.js'
import { getDailyCacheConfigHash } from '../src/daily-cache-config.js'
import { computeEnvFingerprint, PROVIDER_PARSE_VERSIONS, type CachedCall } from '../src/session-cache.js'
import type { JournalEntry } from '../src/types.js'

function makeCall(overrides: Partial<CachedCall> = {}): CachedCall {
  const timestamp = overrides.timestamp ?? '2026-04-03T13:30:36.680Z'
  return {
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    usage: {
      inputTokens: 2506,
      outputTokens: 6,
      cacheCreationInputTokens: 11729,
      cacheReadInputTokens: 38903,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      webSearchRequests: 0,
      cacheCreationOneHourTokens: 0,
    },
    speed: 'standard',
    timestamp,
    tools: [],
    bashCommands: [],
    skills: [],
    subagentTypes: [],
    deduplicationKey: 'native-message-1',
    nativeMessageId: 'native-message-1',
    nativeEmissionTimestamp: timestamp,
    ...overrides,
  }
}

function outputOf(files: ReadonlyArray<{ filePath: string; calls: readonly CachedCall[] }>): number {
  const result = reconcileClaudeNativeCalls(files)
  return [...result.winners.values()].reduce((sum, candidate) => sum + candidate.call.usage.outputTokens, 0)
}

function withOutput(call: CachedCall, outputTokens: number): CachedCall {
  return { ...call, usage: { ...call.usage, outputTokens } }
}

function assistantEntry(timestamp: string, outputTokens: number, stopReason?: string): JournalEntry {
  return {
    type: 'assistant',
    timestamp,
    message: {
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'streamed-message-1',
      usage: {
        input_tokens: 100,
        output_tokens: outputTokens,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 30,
      },
      content: [],
      ...(stopReason ? { stop_reason: stopReason } : {}),
    },
  }
}

describe('R2 Claude native message identity reconciliation', () => {
  it('counts an exact duplicate across two files once', () => {
    const call = makeCall()
    const result = reconcileClaudeNativeCalls([
      { filePath: 'parent.jsonl', calls: [call] },
      { filePath: 'mirror.jsonl', calls: [{ ...call, project: 'same-project' }] },
    ])
    expect(result.winners.size).toBe(1)
    expect(outputOf([
      { filePath: 'parent.jsonl', calls: [call] },
      { filePath: 'mirror.jsonl', calls: [{ ...call, project: 'same-project' }] },
    ])).toBe(6)
  })

  it('selects a later cumulative snapshot independent of discovery order', () => {
    const partial = makeCall({ nativeEmissionTimestamp: '2026-04-03T13:30:36.680Z', timestamp: '2026-04-03T13:30:35.212Z' })
    const final = withOutput(makeCall({ nativeEmissionTimestamp: '2026-04-03T13:30:37.000Z', timestamp: '2026-04-03T13:30:35.212Z', nativeSnapshotTerminal: true }), 376)
    const first = reconcileClaudeNativeCalls([
      { filePath: 'a.jsonl', calls: [partial] },
      { filePath: 'b.jsonl', calls: [final] },
    ])
    const reversed = reconcileClaudeNativeCalls([
      { filePath: 'b.jsonl', calls: [final] },
      { filePath: 'a.jsonl', calls: [partial] },
    ])
    expect(first.winners.get('native-message-1')?.call.usage.outputTokens).toBe(376)
    expect(reversed.winners.get('native-message-1')?.call.usage.outputTokens).toBe(376)
    expect(outputOf([
      { filePath: 'a.jsonl', calls: [partial] },
      { filePath: 'b.jsonl', calls: [final] },
    ])).toBe(outputOf([
      { filePath: 'b.jsonl', calls: [final] },
      { filePath: 'a.jsonl', calls: [partial] },
    ]))
  })

  it('repairs a warm partial cache when the final mirror appears later', () => {
    const partial = makeCall()
    const final = withOutput(makeCall({ nativeSnapshotTerminal: true }), 376)
    expect(outputOf([{ filePath: 'parent.jsonl', calls: [partial] }])).toBe(6)
    expect(outputOf([
      { filePath: 'parent.jsonl', calls: [partial] },
      { filePath: 'mirror.jsonl', calls: [final] },
    ])).toBe(376)
  })

  it('uses a terminal native marker when two files share the emission timestamp', () => {
    const partial = makeCall({ nativeSnapshotTerminal: false })
    const final = withOutput(makeCall({ nativeSnapshotTerminal: true }), 376)
    const result = reconcileClaudeNativeCalls([
      { filePath: 'parent.jsonl', calls: [partial] },
      { filePath: 'sidechain.jsonl', calls: [final] },
    ])
    expect(result.ambiguities).toHaveLength(0)
    expect(result.winners.get('native-message-1')?.call.nativeSnapshotTerminal).toBe(true)
    expect(result.winners.get('native-message-1')?.call.usage.outputTokens).toBe(376)
  })

  it('keeps within-file streaming final payload and first logical timestamp', () => {
    const entries = dedupeStreamingMessageIds([
      compactEntry(assistantEntry('2026-04-03T13:30:35.212Z', 5)),
      compactEntry(assistantEntry('2026-04-03T13:30:36.680Z', 376, 'tool_use')),
    ])
    expect(entries).toHaveLength(1)
    const parsed = parseApiCall(entries[0]!)
    expect(parsed).not.toBeNull()
    const call = apiCallToCachedCall(parsed!)
    expect(call.usage.outputTokens).toBe(376)
    expect(call.timestamp).toBe('2026-04-03T13:30:35.212Z')
    expect(call.nativeEmissionTimestamp).toBe('2026-04-03T13:30:36.680Z')
    expect(call.nativeSnapshotTerminal).toBe(true)
  })

  it('does not field-wise merge incomparable snapshots and reports ambiguity', () => {
    const a = withOutput(makeCall({ nativeSnapshotTerminal: false }), 9)
    const b = withOutput(makeCall({ nativeSnapshotTerminal: false }), 11)
    const result = reconcileClaudeNativeCalls([
      { filePath: 'a.jsonl', calls: [a] },
      { filePath: 'b.jsonl', calls: [b] },
    ])
    expect(result.ambiguities).toHaveLength(1)
    expect(result.winners.size).toBe(1)
    expect(result.winners.get('native-message-1')?.call.usage.outputTokens).not.toBe(20)
  })

  it('keeps exact duplicate metadata differences deterministic across restart/order', () => {
    const a = makeCall({ project: 'project-a', projectPath: '/a' })
    const b = makeCall({ project: 'project-b', projectPath: '/b' })
    const first = reconcileClaudeNativeCalls([
      { filePath: 'z.jsonl', calls: [a] },
      { filePath: 'a.jsonl', calls: [b] },
    ])
    const restarted = reconcileClaudeNativeCalls([
      { filePath: 'a.jsonl', calls: [b] },
      { filePath: 'z.jsonl', calls: [a] },
    ])
    expect(first.winners.get('native-message-1')?.call.usage).toEqual(restarted.winners.get('native-message-1')?.call.usage)
    expect(first.winners.get('native-message-1')?.filePath).toBe('a.jsonl')
    expect(getClaudeNativeIdentity(first.winners.get('native-message-1')!.call)).toBe('native-message-1')
  })

  it('preserves an unrelated identity while deduplicating the repaired identity', () => {
    const duplicate = makeCall()
    const unrelated = makeCall({ nativeMessageId: 'unrelated-message', deduplicationKey: 'unrelated-message', timestamp: '2026-04-03T13:31:00.000Z' })
    const result = reconcileClaudeNativeCalls([
      { filePath: 'parent.jsonl', calls: [duplicate, unrelated] },
      { filePath: 'mirror.jsonl', calls: [{ ...duplicate }] },
    ])
    expect(result.winners.size).toBe(2)
    expect(outputOf([
      { filePath: 'parent.jsonl', calls: [duplicate, unrelated] },
      { filePath: 'mirror.jsonl', calls: [{ ...duplicate }] },
    ])).toBe(12)
  })

  it('is stable across a restart and never sums the same native identity twice', () => {
    const call = makeCall()
    const files = [
      { filePath: 'parent.jsonl', calls: [call] },
      { filePath: 'mirror.jsonl', calls: [{ ...call }] },
    ]
    expect(outputOf(files)).toBe(6)
    expect(outputOf(files)).toBe(6)
  })

  it('bumps both Claude parse and daily authorities for stale-cache self-healing', () => {
    const version = PROVIDER_PARSE_VERSIONS['claude']!
    const before = getDailyCacheConfigHash()
    const envBefore = computeEnvFingerprint('claude')
    expect(version).toContain('native-id-reconciliation-v1')
    expect(computeEnvFingerprint('claude')).toBeTypeOf('string')
    expect(before).toContain(`claudeCollector=${version}`)
    const original = PROVIDER_PARSE_VERSIONS['claude']
    PROVIDER_PARSE_VERSIONS['claude'] = `${original}-test-change`
    try {
      expect(getDailyCacheConfigHash()).not.toBe(before)
      expect(computeEnvFingerprint('claude')).not.toBe(envBefore)
    } finally {
      PROVIDER_PARSE_VERSIONS['claude'] = original
    }
  })
})
