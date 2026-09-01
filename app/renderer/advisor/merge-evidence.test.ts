import { describe, expect, it } from 'vitest'

import { buildSpendEvidence } from './evidence'
import { mergeEvidence } from './merge-evidence'
import { createAdvisorConformanceFixture } from './conformance'

describe('Advisor canonical turn coverage', () => {
  it('derives one evidence coverage state from all requested canonical reads', () => {
    const fixture = createAdvisorConformanceFixture()
    const high = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const partial = {
      ...high,
      coverage: { level: 'partial' as const, label: 'Partial coverage', detail: 'One requested evidence dimension is limited.' },
    }

    expect(mergeEvidence([high], high).coverage).toEqual({
      level: 'high',
      label: 'High coverage',
      detail: 'All requested evidence tools returned usable canonical records.',
    })
    expect(mergeEvidence([high, partial], high).coverage).toEqual({
      level: 'partial',
      label: 'Partial coverage',
      detail: 'Some requested evidence is usable; other dimensions remain limited or unavailable.',
    })
  })
})
