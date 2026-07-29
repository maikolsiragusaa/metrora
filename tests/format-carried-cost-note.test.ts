import { describe, it, expect } from 'vitest'

import { carriedCostNote } from '../src/format.js'

// Issue #767 item 3: the dashboard TUI's Daily Activity panel counts active
// days from a bounded live scan while the Overview headline (durable cache)
// can include cost from days whose session files have since expired. The two
// numbers are each internally consistent but read as a contradiction with no
// explanation. overview.ts already has a footnote for exactly this case
// ("includes $X preserved from expired session logs"); this helper is the
// shared, testable piece of that same wording so dashboard.tsx can reuse it.
describe('carriedCostNote', () => {
  it('is null when nothing was carried forward', () => {
    expect(carriedCostNote(0)).toBeNull()
  })

  it('explains carried cost when present', () => {
    expect(carriedCostNote(1.23)).toBe('includes $1.23 preserved from expired session logs')
  })
})
