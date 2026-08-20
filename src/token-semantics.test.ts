import { describe, expect, it } from 'vitest'

import { combineReasoningSemantics, providerHasSeparateReasoning, reasoningSemanticsForProviders, reasoningTokenTotals, separatelyReportedReasoningTokens } from './token-semantics.js'

describe('reasoning token semantics', () => {
  it('recognizes providers whose parser contract carries reasoning separately', () => {
    for (const provider of ['codex', 'antigravity', 'opencode', 'zcode', 'cursor-agent', 'gemini']) {
      expect(providerHasSeparateReasoning(provider)).toBe(true)
      expect(reasoningSemanticsForProviders([provider])).toBe('separate')
    }
  })

  it('keeps sources without independent evidence unavailable and out of totals', () => {
    expect(providerHasSeparateReasoning('zed')).toBe(false)
    expect(reasoningSemanticsForProviders(['zed'])).toBe('unavailable')
    expect(separatelyReportedReasoningTokens(123, 'unavailable')).toBe(0)
    expect(separatelyReportedReasoningTokens(123, 'separate')).toBe(123)
  })

  it('marks mixed delivery evidence instead of silently treating unavailable constituents as separate', () => {
    expect(combineReasoningSemantics(['separate'])).toBe('separate')
    expect(combineReasoningSemantics(['unavailable', 'unavailable'])).toBe('unavailable')
    expect(combineReasoningSemantics(['separate', 'unavailable'])).toBe('mixed')
    expect(reasoningSemanticsForProviders(['gemini', 'zed'])).toBe('mixed')
    expect(reasoningSemanticsForProviders(['gemini', 'zed'], true)).toBe('mixed')
    expect(separatelyReportedReasoningTokens(123, 'mixed')).toBe(0)
    expect(separatelyReportedReasoningTokens(undefined, 'mixed')).toBe(0)
  })

  it('keeps observed reasoning separate from the additive subtotal', () => {
    expect(reasoningTokenTotals(20, 'aggregate-output')).toEqual({ observedReasoningTokens: 20, additiveReasoningTokens: 0 })
    expect(reasoningTokenTotals(30, 'separate')).toEqual({ observedReasoningTokens: 30, additiveReasoningTokens: 30 })
    expect(reasoningTokenTotals(50, 'mixed')).toEqual({ observedReasoningTokens: 50, additiveReasoningTokens: 0 })
  })
})
