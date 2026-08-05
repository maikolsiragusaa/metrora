import { describe, expect, it } from 'vitest'

import {
  buildReasoningMix,
  findExplicitReasoningLevel,
  normalizeReasoningLevel,
  reasoningLevelFromModelLabel,
  resolveReasoningAttribution,
} from './reasoning-level.js'

describe('reasoning-level normalization', () => {
  it('normalizes supported aliases without collapsing none into minimal', () => {
    expect(normalizeReasoningLevel('none')).toBe('none')
    expect(normalizeReasoningLevel('off')).toBe('none')
    expect(normalizeReasoningLevel('minimum')).toBe('minimal')
    expect(normalizeReasoningLevel('extra-high')).toBe('xhigh')
    expect(normalizeReasoningLevel('maximum')).toBe('max')
    expect(normalizeReasoningLevel('automatic')).toBe('adaptive')
    expect(normalizeReasoningLevel('turbo')).toBeNull()
  })

  it('finds nested explicit settings within a bounded cyclic graph', () => {
    const root: Record<string, unknown> = {
      collaboration_mode: { settings: { reasoning_effort: 'High' } },
    }
    root.self = root
    expect(findExplicitReasoningLevel(root)).toBe('high')
    expect(findExplicitReasoningLevel({ a: { b: { thinking_level: 'adaptive' } } })).toBe('adaptive')
  })
})

describe('model-label attribution', () => {
  it('recognizes explicit reasoning labels and strict known-family suffixes', () => {
    expect(reasoningLevelFromModelLabel('GPT-5.3 Codex (extra high reasoning)')).toEqual({
      level: 'xhigh',
      source: 'model-label',
    })
    expect(reasoningLevelFromModelLabel('claude-4-7-opus-xhigh-fast')).toEqual({
      level: 'xhigh',
      source: 'model-label',
    })
    expect(reasoningLevelFromModelLabel('gpt-5.2-low')).toEqual({
      level: 'low',
      source: 'model-label',
    })
  })

  it('does not treat generic quality or latency words as reasoning levels', () => {
    expect(reasoningLevelFromModelLabel('generic-high')).toBeNull()
    expect(reasoningLevelFromModelLabel('generic (high)')).toBeNull()
    expect(reasoningLevelFromModelLabel('gpt-5-low-latency')).toBeNull()
    expect(reasoningLevelFromModelLabel('claude-high-speed')).toBeNull()
    expect(reasoningLevelFromModelLabel('gpt-5-auto')).toBeNull()
  })

  it('lets explicit evidence override a model label', () => {
    expect(resolveReasoningAttribution(
      { collaboration_mode: { settings: { reasoning_effort: 'medium' } } },
      'gpt-5.3-codex-high',
    )).toEqual({ level: 'medium', source: 'explicit' })
  })
})

describe('session reasoning mix', () => {
  it('is call-weighted and keeps unknown calls visible', () => {
    const mix = buildReasoningMix([
      { reasoningLevel: 'high', reasoningLevelSource: 'explicit', outputTokens: 30, reasoningTokens: 10, costUSD: 1 },
      { reasoningLevel: 'high', reasoningLevelSource: 'model-label', outputTokens: 20, reasoningTokens: 5, costUSD: 0.5 },
      { reasoningLevel: 'low', reasoningLevelSource: 'explicit', outputTokens: 15, reasoningTokens: 2, costUSD: 0.2 },
      { outputTokens: 100, reasoningTokens: 80, costUSD: 3 },
    ])

    expect(mix.totalCalls).toBe(4)
    expect(mix.knownCalls).toBe(3)
    expect(mix.coverage).toBe(0.75)
    expect(mix.rows.map(row => [row.level, row.calls, row.callShare])).toEqual([
      ['high', 2, 0.5],
      ['low', 1, 0.25],
      ['unknown', 1, 0.25],
    ])
    expect(mix.rows[0]?.generatedTokens).toBe(65)
    expect(mix.rows[0]?.reasoningTokens).toBe(15)
    expect(mix.rows[0]?.sources).toEqual(['explicit', 'model-label'])
  })

  it('never derives a level from reasoning-token volume', () => {
    const mix = buildReasoningMix([{ outputTokens: 1, reasoningTokens: 1_000_000, costUSD: 50 }])
    expect(mix.coverage).toBe(0)
    expect(mix.rows).toEqual([{
      level: 'unknown',
      calls: 1,
      callShare: 1,
      generatedTokens: 1_000_001,
      reasoningTokens: 1_000_000,
      costUSD: 50,
      sources: [],
    }])
  })
})
