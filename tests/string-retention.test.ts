import { describe, expect, it } from 'vitest'

import {
  flattenParsedProviderCall,
  flattenString,
  flattenStringPrefix,
  flattenToolSequence,
} from '../src/string-retention.js'

function codeUnits(value: string): number[] {
  return Array.from({ length: value.length }, (_, index) => value.charCodeAt(index))
}

describe('string retention flattening', () => {
  it('preserves empty, short, multibyte, and lone-surrogate strings exactly', () => {
    const samples = [
      '',
      'short',
      `café ${String.fromCodePoint(0x1f600)}`,
      String.fromCharCode(0xd800),
      String.fromCharCode(0xdc00),
      `A${String.fromCharCode(0xd800)}B${String.fromCodePoint(0x1f600)}é`,
    ]

    for (const sample of samples) {
      const flattened = flattenString(sample)
      expect(flattened).toBe(sample)
      expect(codeUnits(flattened)).toEqual(codeUnits(sample))
    }
  })

  it('keeps exact JavaScript code-unit prefix semantics', () => {
    const source = `A${String.fromCodePoint(0x1f600)}B${String.fromCharCode(0xd800)}C`
    for (const limit of [0, 1, 2, 3, 4, 5, source.length + 10]) {
      const expected = source.slice(0, limit)
      expect(flattenStringPrefix(source, limit)).toBe(expected)
      expect(codeUnits(flattenStringPrefix(source, limit))).toEqual(codeUnits(expected))
    }
  })

  it('detaches tool names, commands, and provider preview fields without changing values', () => {
    const sequence = flattenToolSequence([[{
      tool: 'mcp__server__tool',
      file: 'src/é.ts',
      command: `echo ${String.fromCharCode(0xd800)}`,
    }]])
    expect(sequence).toEqual([[{
      tool: 'mcp__server__tool',
      file: 'src/é.ts',
      command: `echo ${String.fromCharCode(0xd800)}`,
    }]])

    const call = flattenParsedProviderCall({
      provider: 'codex',
      model: 'gpt-5',
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      webSearchRequests: 0,
      costUSD: 0,
      tools: ['mcp__server__tool'],
      bashCommands: ['echo hi'],
      skills: ['skill'],
      subagentTypes: ['worker'],
      timestamp: '2026-08-13T00:00:00.000Z',
      speed: 'standard',
      deduplicationKey: 'call-1',
      userMessage: 'preview',
      sessionId: 'session-1',
      toolSequence: sequence,
    })
    expect(call.userMessage).toBe('preview')
    expect(call.tools).toEqual(['mcp__server__tool'])
    expect(call.toolSequence).toEqual(sequence)
  })

  it('preserves serialized provider-call semantics at a local cache boundary', () => {
    const raw = {
      provider: 'codex',
      model: `model-${String.fromCharCode(0xd800)}`,
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 4,
      cachedInputTokens: 5,
      reasoningTokens: 6,
      webSearchRequests: 7,
      costUSD: 0.25,
      tools: ['tool'],
      bashCommands: ['echo'],
      skills: ['skill'],
      subagentTypes: ['worker'],
      timestamp: '2026-08-13T00:00:00.000Z',
      speed: 'standard' as const,
      deduplicationKey: 'key',
      userMessage: `prefix-${String.fromCharCode(0xdc00)}`,
      sessionId: 'session',
      project: 'project',
      projectPath: 'C:/project',
      workingDirectory: 'C:/project',
      toolSequence: [[{ tool: 'tool', command: 'echo' }]],
    }
    expect(JSON.stringify(flattenParsedProviderCall(raw))).toBe(JSON.stringify(raw))
  })
})
