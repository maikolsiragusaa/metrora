import { describe, expect, it } from 'vitest'

import { dateKeyInTz } from '../src/day-aggregator.js'

describe('dateKeyInTz', () => {
  it('buckets the same instant on opposite sides of local midnight', () => {
    const instant = '2026-08-11T00:30:00.000Z'
    expect(dateKeyInTz(instant, 'Europe/Rome')).toBe('2026-08-11')
    expect(dateKeyInTz(instant, 'America/New_York')).toBe('2026-08-10')
  })
})
