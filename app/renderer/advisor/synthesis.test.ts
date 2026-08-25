import { describe, expect, it } from 'vitest'

import { buildSpendEvidence } from './evidence'
import { createAdvisorConformanceFixture } from './conformance'
import { parseAdvisorSynthesisDraft, verifyAdvisorSynthesis } from './synthesis'
import type { AdvisorEvidence, AdvisorScope } from './types'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

function claim(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    contractVersion: 'advisor-claim-v1',
    schemaVersion: 1,
    id: 'claim-1',
    class: 'numeric',
    text: 'Metrora measured 12.',
    value: 12,
    evidenceRefs: ['overview.current'],
    evidencePaths: ['spend.measuredCostUSD'],
    ...overrides,
  }
}

function parsedDraft(options: {
  claims?: Record<string, unknown>[]
  conclusionClaimIds?: string[]
  whyClaimIds?: string[][]
  detailsClaimIds?: string[][]
} = {}) {
  return parseAdvisorSynthesisDraft(JSON.stringify({
    contractVersion: 'advisor-synthesis-draft-v1',
    schemaVersion: 1,
    conclusion: { text: 'Metrora measured 12.', claimIds: options.conclusionClaimIds ?? ['claim-1'] },
    why: (options.whyClaimIds ?? [['claim-1']]).map((claimIds, index) => ({ text: index ? 'The returned evidence supports the scope.' : 'The selected evidence contains the measured total.', claimIds })),
    details: (options.detailsClaimIds ?? [['claim-1']]).map((claimIds, index) => ({ text: index ? 'The evidence remains bounded to this scope.' : 'Measured spend is the canonical total.', claimIds })),
    claims: options.claims ?? [claim()],
    presentationRequests: [],
  }))
}

describe('Advisor synthesis claim completeness', () => {
  const fixture = createAdvisorConformanceFixture()
  const evidence = buildSpendEvidence('What changed in spend?', scope, fixture.overview)

  it('rejects factual conclusion prose with no claims', () => {
    const draft = parsedDraft({ claims: [], conclusionClaimIds: [], whyClaimIds: [[]], detailsClaimIds: [[]] })
    expect(draft).not.toBeNull()
    expect(verifyAdvisorSynthesis(draft!, evidence).valid).toBe(false)
  })

  it('rejects factual WHY prose with no claim reference', () => {
    const draft = parsedDraft({ whyClaimIds: [[]] })
    expect(draft).not.toBeNull()
    expect(verifyAdvisorSynthesis(draft!, evidence).reason).toContain('no claim references')
  })

  it('rejects DETAILS that point at an invalid claim ID', () => {
    const draft = parsedDraft({ detailsClaimIds: [['missing-claim']] })
    expect(draft).not.toBeNull()
    expect(verifyAdvisorSynthesis(draft!, evidence).reason).toContain('unknown claim ID')
  })

  it('rejects qualitative hallucinations without exact evidence support', () => {
    const qualitative = parsedDraft({
      claims: [claim({ class: 'qualitative', text: 'Claude was the main driver.', value: 'Claude', evidenceRefs: [], evidencePaths: [] })],
    })
    expect(qualitative).not.toBeNull()
    expect(verifyAdvisorSynthesis(qualitative!, evidence).valid).toBe(false)
  })

  it('rejects invented drivers and trends even when they cite a real evidence item', () => {
    const inventedDriver = parsedDraft({
      claims: [claim({ class: 'qualitative', text: 'Claude was the main driver.', value: 'Claude', evidencePaths: ['spend.models.0.name'] })],
    })
    expect(verifyAdvisorSynthesis(inventedDriver!, evidence).valid).toBe(false)

    const inventedTrend = parsedDraft({
      claims: [claim({ class: 'trend', text: 'Spend fell.', value: 'down', evidenceRefs: ['overview.history.daily'], evidencePaths: ['spend.trend.direction'] })],
    })
    expect(verifyAdvisorSynthesis(inventedTrend!, evidence).valid).toBe(false)
  })

  it('accepts a block graph whose claims resolve to exact evidence paths', () => {
    const draft = parsedDraft()
    expect(verifyAdvisorSynthesis(draft!, evidence)).toMatchObject({ valid: true, claims: [{ id: 'claim-1', status: 'verified' }] })
  })

  it('accepts an exact path into a bounded canonical evidence row', () => {
    const draft = parsedDraft({
      claims: [claim({ class: 'model', text: 'The leading model is gpt-safe.', value: 'gpt-safe', evidencePaths: ['spend.models.0.name'] })],
    })
    expect(verifyAdvisorSynthesis(draft!, evidence)).toMatchObject({ valid: true, claims: [{ status: 'verified' }] })
  })

  it('accepts an unavailable factual state only when the unavailable status is itself evidenced', () => {
    const unavailable: AdvisorEvidence = { ...evidence, coverage: { ...evidence.coverage, level: 'unavailable', state: 'UNAVAILABLE' } }
    const draft = parsedDraft({
      claims: [claim({ class: 'status', text: 'Measured spend is unavailable for this scope.', value: 'unavailable', evidencePaths: ['coverage.level'] })],
    })
    expect(verifyAdvisorSynthesis(draft!, unavailable)).toMatchObject({ valid: true, claims: [{ status: 'verified' }] })
  })

  it('does not silently normalize a claim reference to another evidence item', () => {
    const draft = parsedDraft({ claims: [claim({ evidenceRefs: ['evidence-1'] })] })
    expect(verifyAdvisorSynthesis(draft!, evidence).valid).toBe(false)
  })
})
