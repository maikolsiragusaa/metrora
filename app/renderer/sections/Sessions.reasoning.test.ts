// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { reasoningMixLabel } from './Sessions'

describe('session reasoning mix label', () => {
  it('shows a single complete level without noise', () => {
    expect(reasoningMixLabel({
      totalCalls: 3,
      knownCalls: 3,
      coverage: 1,
      rows: [{ level: 'high', calls: 3, callShare: 1, generatedTokens: 100, reasoningTokens: 20, costUSD: 1, sources: ['explicit'] }],
    })).toBe('High')
  })

  it('keeps unknown calls visible in a mixed session', () => {
    expect(reasoningMixLabel({
      totalCalls: 3,
      knownCalls: 2,
      coverage: 2 / 3,
      rows: [
        { level: 'high', calls: 2, callShare: 2 / 3, generatedTokens: 100, reasoningTokens: 20, costUSD: 1, sources: ['explicit'] },
        { level: 'unknown', calls: 1, callShare: 1 / 3, generatedTokens: 40, reasoningTokens: 15, costUSD: 0.4, sources: [] },
      ],
    })).toBe('High 67% · Unknown 33%')
  })
})
