import { describe, expect, it } from 'vitest'

import { canonicalizeRfc8785 } from './rfc8785-canonicalize.js'

describe('RFC 8785 canonicalization', () => {
  it('matches the canonical property ordering examples', () => {
    expect(canonicalizeRfc8785({
      from_account: '543 232 625-3',
      to_account: '321 567 636-4',
      amount: 500,
      currency: 'USD',
    })).toBe('{"amount":500,"currency":"USD","from_account":"543 232 625-3","to_account":"321 567 636-4"}')

    expect(canonicalizeRfc8785({
      '1': { f: { f: 'hi', F: 5 }, '\n': 56.0 },
      '10': {},
      '': 'empty',
      a: {},
      '111': [{ e: 'yes', E: 'no' }],
      A: {},
    })).toBe('{"":"empty","1":{"\\n":56,"f":{"F":5,"f":"hi"}},"10":{},"111":[{"E":"no","e":"yes"}],"A":{},"a":{}}')
  })

  it('uses ECMAScript JSON number serialization', () => {
    expect(canonicalizeRfc8785({ numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27] }))
      .toBe('{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}')
  })

  it('rejects values outside the RFC/I-JSON boundary', () => {
    expect(() => canonicalizeRfc8785(Number.NaN)).toThrow(/NaN/)
    expect(() => canonicalizeRfc8785(Number.POSITIVE_INFINITY)).toThrow(/Infinity/)
    expect(() => canonicalizeRfc8785('\ud800')).toThrow(/lone surrogate/)
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => canonicalizeRfc8785(circular)).toThrow(/circular/)
  })
})
