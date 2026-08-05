import { describe, expect, it } from 'vitest'

import { FractionSchema, NonNegativeIntegerSchema } from './common.js'

describe('canonical evidence number schemas', () => {
  it('rejects negative zero while preserving positive zero', () => {
    expect(() => NonNegativeIntegerSchema.parse(-0)).toThrow(/negative zero/)
    expect(() => FractionSchema.parse(-0)).toThrow(/negative zero/)

    expect(NonNegativeIntegerSchema.parse(+0)).toBe(0)
    expect(FractionSchema.parse(+0)).toBe(0)
  })
})
