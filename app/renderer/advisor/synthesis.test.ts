import { describe, expect, it } from 'vitest'

import { buildSpendEvidence } from './evidence'
import { buildAdvisorVerifiedClaimAtoms, renderAdvisorVerifiedSynthesis, renderAdvisorVerifiedClaimAtom, verifyAdvisorVerifiedClaimAtom } from './claim-atoms'
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

function parsedDraft(options: {
  claims?: string[]
  conclusionClaimIds?: string[]
  whyClaimIds?: string[][]
  detailsClaimIds?: string[][]
  conclusion?: Record<string, unknown>
} = {}) {
  return parseAdvisorSynthesisDraft(JSON.stringify({
    contractVersion: 'advisor-synthesis-draft-v1',
    schemaVersion: 1,
    conclusion: options.conclusion ?? { claimIds: options.conclusionClaimIds ?? ['measured-total-cost'] },
    why: (options.whyClaimIds ?? [['observed-calls']]).map(claimIds => ({ claimIds })),
    details: (options.detailsClaimIds ?? [['observed-sessions']]).map(claimIds => ({ claimIds })),
    claims: (options.claims ?? ['measured-total-cost', 'observed-calls', 'observed-sessions']).map(id => ({ id })),
    presentationRequests: [],
  }))
}

describe('Advisor typed verified claim atoms', () => {
  const fixture = createAdvisorConformanceFixture()
  const evidence = buildSpendEvidence('What changed in spend?', scope, fixture.overview)

  it('rejects a material block with no selected claim atom', () => {
    const draft = parsedDraft({ claims: [], conclusionClaimIds: [], whyClaimIds: [[]], detailsClaimIds: [[]] })
    expect(draft).not.toBeNull()
    expect(verifyAdvisorSynthesis(draft!, evidence).valid).toBe(false)
  })

  it('rejects a block that points at an atom that was not selected', () => {
    const draft = parsedDraft({ detailsClaimIds: [['missing-atom']] })
    expect(draft).not.toBeNull()
    expect(verifyAdvisorSynthesis(draft!, evidence).reason).toContain('unselected claim atom')
  })

  it('rejects legacy or arbitrary factual block prose before verification', () => {
    expect(parseAdvisorSynthesisDraft(JSON.stringify({
      contractVersion: 'advisor-synthesis-draft-v1',
      schemaVersion: 1,
      conclusion: { text: 'Metrora measured $12 and Claude caused the increase.', claimIds: ['measured-total-cost'] },
      why: [],
      details: [],
      claims: [{ id: 'measured-total-cost' }],
      presentationRequests: [],
    }))).toBeNull()
  })

  it.each(['Claude is the cheapest model.', 'Claude is more efficient.'])('does not accept true model identity as unsupported semantic prose: %s', text => {
    const draft = parseAdvisorSynthesisDraft(JSON.stringify({
      contractVersion: 'advisor-synthesis-draft-v1',
      schemaVersion: 1,
      conclusion: { text, claimIds: ['model-identity-0'] },
      why: [],
      details: [],
      claims: [{ id: 'model-identity-0' }],
      presentationRequests: [],
    }))
    expect(draft).toBeNull()
  })

  it('rejects a claim-kind/path mismatch even when the value is real', () => {
    const atom = buildAdvisorVerifiedClaimAtoms(evidence).find(item => item.id === 'model-identity-0')!
    expect(verifyAdvisorVerifiedClaimAtom({ ...atom, claimKind: 'model_measured_cost', metric: 'cost', evidencePath: 'spend.models.0.costUSD', value: atom.value }, evidence)).toBe(false)
  })

  it('rejects an evidence reference that does not own the typed path', () => {
    const atom = buildAdvisorVerifiedClaimAtoms(evidence).find(item => item.id === 'measured-total-cost')!
    expect(verifyAdvisorVerifiedClaimAtom({ ...atom, evidenceRef: 'overview.projects' }, evidence)).toBe(false)
  })

  it('verifies and renders a measured-cost atom without model-authored factual prose', () => {
    const draft = parsedDraft({ claims: ['model-measured-cost-0'], conclusionClaimIds: ['model-measured-cost-0'], whyClaimIds: [], detailsClaimIds: [] })
    const atom = buildAdvisorVerifiedClaimAtoms(evidence).find(item => item.id === 'model-measured-cost-0')!
    expect(verifyAdvisorSynthesis(draft!, evidence).valid).toBe(true)
    expect(verifyAdvisorVerifiedClaimAtom(atom, evidence)).toBe(true)
    expect(renderAdvisorVerifiedClaimAtom(atom, 'en')).toContain('Observed spend for gpt-safe')
    expect(renderAdvisorVerifiedClaimAtom(atom, 'it')).toContain('spesa osservata')
  })

  it('renders multiple verified atoms in the model-selected order', () => {
    const draft = parsedDraft({
      claims: ['model-measured-cost-1', 'model-measured-cost-0'],
      conclusionClaimIds: ['model-measured-cost-1', 'model-measured-cost-0'],
      whyClaimIds: [],
      detailsClaimIds: [],
    })
    const verification = verifyAdvisorSynthesis(draft!, evidence)
    expect(verification.valid).toBe(true)
    expect(verification.claims.map(atom => atom.id)).toEqual(['model-measured-cost-1', 'model-measured-cost-0'])
    const rendered = renderAdvisorVerifiedSynthesis(draft!, verification.claims, 'Which model cost more?')
    expect(rendered.conclusion.indexOf('local-safe')).toBeLessThan(rendered.conclusion.indexOf('gpt-safe'))
  })

  it('renders the canonical measured total in both supported languages', () => {
    const draft = parsedDraft({ claims: ['measured-total-cost'], conclusionClaimIds: ['measured-total-cost'], whyClaimIds: [], detailsClaimIds: [] })
    const verification = verifyAdvisorSynthesis(draft!, evidence)
    expect(verification.valid).toBe(true)
    expect(renderAdvisorVerifiedSynthesis(draft!, verification.claims, 'What changed in spend?').conclusion).toContain('Metrora measured')
    expect(renderAdvisorVerifiedSynthesis(draft!, verification.claims, 'Quanto ho speso?').conclusion).toContain('Hai speso')
  })
})
