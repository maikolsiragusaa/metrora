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

  it('uses ECMAScript JSON number serialization for RFC 8785 vectors', () => {
    expect(canonicalizeRfc8785({ numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27] }))
      .toBe('{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}')
  })

  it('rejects negative zero at every nesting level while preserving positive zero', () => {
    expect(() => canonicalizeRfc8785(-0)).toThrow(/negative zero/)
    expect(() => canonicalizeRfc8785({ value: -0 })).toThrow(/negative zero/)
    expect(() => canonicalizeRfc8785([1, { nested: -0 }])).toThrow(/negative zero/)
    expect(() => canonicalizeRfc8785({ toJSON: () => -0 })).toThrow(/negative zero/)

    expect(canonicalizeRfc8785(+0)).toBe('0')
    expect(canonicalizeRfc8785({ value: +0 })).toBe('{"value":0}')
  })

  it('sorts object properties by UTF-16 code units', () => {
    expect(canonicalizeRfc8785({
      '\u20ac': 'Euro Sign',
      '\r': 'Carriage Return',
      '\ufb33': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '\ud83d\ude00': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      '\u00f6': 'Latin Small Letter O With Diaeresis',
    })).toBe('{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}')
  })

  it('accepts valid surrogate pairs in keys and values', () => {
    expect(canonicalizeRfc8785({ 'emoji_😀': 'value_😀' }))
      .toBe('{"emoji_😀":"value_😀"}')
  })

  it('rejects leading, trailing, isolated and keyed lone surrogates', () => {
    const invalidStrings = [
      '\ud800',
      '\udfff',
      '\ud800a',
      'a\ud800',
      '\udfffA',
      'A\udfff',
    ]

    for (const value of invalidStrings) {
      expect(() => canonicalizeRfc8785(value)).toThrow(/lone surrogate/)
      expect(() => canonicalizeRfc8785({ value })).toThrow(/lone surrogate/)
    }
    expect(() => canonicalizeRfc8785({ ['\ud800']: 'value' })).toThrow(/lone surrogate/)
    expect(() => canonicalizeRfc8785({ ['\udfff']: 'value' })).toThrow(/lone surrogate/)
  })

  it('rejects circular arrays, objects and toJSON recursion', () => {
    const circularObject: Record<string, unknown> = {}
    circularObject.self = circularObject
    expect(() => canonicalizeRfc8785(circularObject)).toThrow(/circular/)

    const circularArray: unknown[] = []
    circularArray.push(circularArray)
    expect(() => canonicalizeRfc8785(circularArray)).toThrow(/circular/)

    const recursiveToJson: { toJSON: () => unknown } = {
      toJSON: () => recursiveToJson,
    }
    expect(() => canonicalizeRfc8785(recursiveToJson)).toThrow(/circular/)
  })

  it('allows repeated non-cyclic references', () => {
    const shared = { value: 7 }
    expect(canonicalizeRfc8785({ first: shared, second: shared }))
      .toBe('{"first":{"value":7},"second":{"value":7}}')
  })

  it('cleans cycle state after a failing toJSON call', () => {
    const seen = new Set<object>()
    const value: { toJSON: () => unknown } = {
      toJSON: () => { throw new Error('toJSON failed') },
    }

    expect(() => canonicalizeRfc8785(value, seen)).toThrow(/toJSON failed/)
    expect(seen.size).toBe(0)

    value.toJSON = () => ({ recovered: true })
    expect(canonicalizeRfc8785(value, seen)).toBe('{"recovered":true}')
    expect(seen.size).toBe(0)
  })

  it('rejects values outside the RFC/I-JSON boundary', () => {
    expect(() => canonicalizeRfc8785(Number.NaN)).toThrow(/NaN/)
    expect(() => canonicalizeRfc8785(Number.POSITIVE_INFINITY)).toThrow(/Infinity/)
    expect(() => canonicalizeRfc8785(Number.NEGATIVE_INFINITY)).toThrow(/Infinity/)
    expect(() => canonicalizeRfc8785(1n)).toThrow(/not JSON serializable/)
    expect(() => canonicalizeRfc8785(Symbol('unsupported'))).toThrow(/not JSON serializable/)
    expect(() => canonicalizeRfc8785(() => undefined)).toThrow(/not JSON serializable/)
  })

  it('normalizes undefined and symbols in arrays and omits them in objects', () => {
    expect(canonicalizeRfc8785([undefined, Symbol('x'), 1])).toBe('[null,null,1]')
    expect(canonicalizeRfc8785({ omitted: undefined, symbol: Symbol('x'), kept: 1 }))
      .toBe('{"kept":1}')
  })
})
