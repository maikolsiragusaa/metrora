import { describe, expect, it } from 'vitest'

import { createAdvisorConformanceFixture } from './conformance'
import { buildSpendEvidence } from './evidence'
import { hasMixedEvidenceScopes, mergeEvidence } from './merge-evidence'

describe('Advisor canonical turn coverage', () => {
  it('derives one coverage state from all requested canonical reads', () => {
    const fixture = createAdvisorConformanceFixture()
    const high = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const partial = { ...high, coverage: { level: 'partial' as const, label: 'Partial coverage', detail: 'One requested evidence dimension is limited.' } }
    const unavailable = { ...high, coverage: { level: 'unavailable' as const, label: 'Unavailable', detail: 'The requested read was unavailable.' } }

    expect(mergeEvidence([high], high).coverage.level).toBe('high')
    expect(mergeEvidence([high, partial], high).coverage.level).toBe('partial')
    expect(mergeEvidence([high, unavailable], high).coverage.level).toBe('partial')
    expect(mergeEvidence([unavailable, { ...unavailable }], high).coverage.level).toBe('unavailable')
  })

  it('does not award High coverage to a nominal model response without canonical refs', () => {
    const fixture = createAdvisorConformanceFixture()
    const high = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const modelOnly = { ...high, refs: [], coverage: { level: 'high' as const, label: 'High coverage', detail: 'The model returned a non-empty answer.' } }
    expect(mergeEvidence([modelOnly], high).coverage.level).toBe('unavailable')
  })

  it('keeps an explicit bounded period comparison usable without mixing provider or project scopes', () => {
    const fixture = createAdvisorConformanceFixture()
    const week = buildSpendEvidence('Show spend for this week and lifetime.', fixture.scope, fixture.overview)
    const lifetime = { ...week, scope: { ...week.scope, period: 'lifetime' as const } }
    expect(hasMixedEvidenceScopes([week, lifetime])).toBe(false)
    expect(mergeEvidence([week, lifetime], week).coverage.level).toBe('high')

    const otherProvider = { ...week, scope: { ...week.scope, provider: 'codex' } }
    expect(hasMixedEvidenceScopes([week, otherProvider])).toBe(true)
    expect(mergeEvidence([week, otherProvider], week).coverage).toMatchObject({ level: 'unavailable', label: 'Conflicting evidence scopes' })
  })

  it('accepts the bounded today aggregate plus the explicit yesterday day range', () => {
    const fixture = createAdvisorConformanceFixture()
    const today = { ...fixture.scope, period: 'today' as const }
    const yesterdayDate = new Date()
    yesterdayDate.setHours(0, 0, 0, 0)
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)
    const date = yesterdayDate.getFullYear() + '-' + String(yesterdayDate.getMonth() + 1).padStart(2, '0') + '-' + String(yesterdayDate.getDate()).padStart(2, '0')
    const yesterday = { ...today, range: { from: date, to: date } }
    const todayEvidence = buildSpendEvidence('Show today and yesterday.', today, fixture.overview)
    const yesterdayEvidence = buildSpendEvidence('Show today and yesterday.', yesterday, fixture.overview)
    expect(hasMixedEvidenceScopes([todayEvidence, yesterdayEvidence])).toBe(false)
    expect(mergeEvidence([todayEvidence, yesterdayEvidence], todayEvidence).coverage.level).toBe('high')
  })
})
