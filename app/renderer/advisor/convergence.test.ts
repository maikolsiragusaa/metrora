import { describe, expect, it } from 'vitest'

import { createAdvisorActionProposalV1 } from './action'
import { buildSpendEvidence } from './evidence'
import { createAdvisorConformanceFixture } from './conformance'
import { resolveAdvisorQuestion } from './comprehension'
import { buildAdvisorPresentationBlocks } from './presentation'
import { DeterministicAdvisorRuntime } from './runtime'
import { buildActionProposalEvidence, buildSocialEvidence } from './special-evidence'
import { parseAdvisorSynthesisDraft, verifyAdvisorSynthesis } from './synthesis'
import { type AdvisorEvidence, type AdvisorScope } from './types'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

describe('Advisor mainstream convergence contracts', () => {
  it('keeps social turns conversational and evidence-free', async () => {
    const resolved = resolveAdvisorQuestion('Ciao', scope)
    expect(resolved.intent).toBe('social')
    expect(resolved.needsEvidence).toBe(false)
    const answer = await new DeterministicAdvisorRuntime().generate({ question: 'Ciao', evidence: { ...buildSocialEvidence('Ciao', scope), plan: resolved.plan, understanding: resolved.understanding }, plan: resolved.plan })
    expect(answer.conclusion).toContain('Buongiorno')
    expect(answer.evidence).toEqual([])
  })

  it('keeps operational requests at the proposal-only boundary', () => {
    const resolved = resolveAdvisorQuestion('Run this benchmark', scope)
    expect(resolved.intent).toBe('action-proposal')
    expect(resolved.plan.authorization).toBe('proposal-required')
    const proposal = createAdvisorActionProposalV1({ kind: 'run-bench', summary: 'Run the selected task pack', target: 'selected-model', scope })
    expect(proposal.status).toBe('proposal-only')
    expect(proposal.budget.maxCalls).toBe(0)
  })

  it('verifies factual synthesis claims against deterministic evidence paths', () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const draft = parseAdvisorSynthesisDraft(JSON.stringify({
      contractVersion: 'advisor-synthesis-draft-v1',
      schemaVersion: 1,
      conclusion: 'Metrora measured the selected spend.',
      why: ['The selected evidence includes the spend total.'],
      details: ['Measured spend is the canonical total.'],
      claims: [{ contractVersion: 'advisor-claim-v1', schemaVersion: 1, id: 'claim-1', class: 'numeric', text: 'Measured spend is 12.', value: 12, evidenceRefs: ['overview.current'], evidencePaths: ['spend.measuredCostUSD'] }],
      presentationRequests: [{ kind: 'metric-cards' }],
    }))
    expect(draft).not.toBeNull()
    expect(verifyAdvisorSynthesis(draft!, evidence)).toMatchObject({ valid: true, claims: [{ status: 'verified' }] })

    const invented = parseAdvisorSynthesisDraft(JSON.stringify({ ...draft, claims: [{ ...draft!.claims[0], value: 999 }] }))!
    expect(verifyAdvisorSynthesis(invented, evidence).valid).toBe(false)
  })

  it('builds chart values from evidence rather than model-authored chart data', () => {
    const fixture = createAdvisorConformanceFixture()
    const base = buildSpendEvidence('Show me the spend trend', fixture.scope, fixture.overview)
    const evidence: AdvisorEvidence = { ...base, spend: { ...base.spend!, history: [{ date: '2026-08-01', costUSD: 3, calls: 1, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null }], modelHistory: [] } }
    const plan = resolveAdvisorQuestion('Show me the spend trend', scope).plan
    const block = buildAdvisorPresentationBlocks(evidence, plan, 'Show me the spend trend').find(item => item.kind === 'line-chart')
    expect(block).toMatchObject({ kind: 'line-chart', series: [{ points: [{ value: 3 }] }] })
  })

  it('keeps a model action request out of the Advisor read-tool contract', () => {
    const evidence = buildActionProposalEvidence('Launch five agents', scope, 'Launching agents requires authorization.')
    expect(evidence.intent).toBe('action-proposal')
    expect(evidence.refs).toEqual([])
  })
})
