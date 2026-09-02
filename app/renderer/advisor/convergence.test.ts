import { describe, expect, it } from 'vitest'

import { createAdvisorActionProposalV1 } from './action'
import { buildSpendEvidence } from './evidence'
import { buildAdvisorVerifiedClaimAtoms } from './claim-atoms'
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

  it.each(['Hello', 'How are you?'])('keeps English social fallback in English: %s', async question => {
    const resolved = resolveAdvisorQuestion(question, scope)
    const answer = await new DeterministicAdvisorRuntime().generate({ question, evidence: { ...buildSocialEvidence(question, scope), plan: resolved.plan, understanding: resolved.understanding }, plan: resolved.plan })
    expect(resolved.intent).toBe('social')
    expect(answer.conclusion).toMatch(/\b(?:Hello|I’m|help|well)\b/u)
    expect(answer.conclusion).not.toContain('Buongiorno')
    expect(answer.evidence).toEqual([])
  })

  it('keeps Italian boundary and clarification copy coherent', () => {
    const action = resolveAdvisorQuestion('Avvia questo benchmark', scope)
    expect(action.understanding.boundary).toContain('Ho capito')
    const clarification = resolveAdvisorQuestion('Qual è il mio limite?', scope)
    expect(clarification.intent).toBe('clarification')
    expect(clarification.understanding.clarification).toContain('Intendi')
  })

  it('keeps English boundary and clarification copy coherent', () => {
    const action = resolveAdvisorQuestion('Run this benchmark', scope)
    expect(action.understanding.boundary).toContain('I understand')
    const clarification = resolveAdvisorQuestion('What is my limit?', scope)
    expect(clarification.intent).toBe('clarification')
    expect(clarification.understanding.clarification).toContain('Do you mean')
  })

  it('keeps operational requests at the proposal-only boundary', () => {
    const resolved = resolveAdvisorQuestion('Run this benchmark', scope)
    expect(resolved.intent).toBe('action-proposal')
    expect(resolved.plan.authorization).toBe('proposal-required')
    const proposal = createAdvisorActionProposalV1({ kind: 'run-bench', summary: 'Run the selected task pack', target: 'selected-model', scope })
    expect(proposal.status).toBe('proposal-only')
    expect(proposal.budget.maxCalls).toBe(0)
  })

  it('verifies factual synthesis selections against typed semantic atoms', () => {
    const fixture = createAdvisorConformanceFixture()
    const evidence = buildSpendEvidence('What changed in spend?', fixture.scope, fixture.overview)
    const draft = parseAdvisorSynthesisDraft(JSON.stringify({
      contractVersion: 'advisor-synthesis-draft-v1',
      schemaVersion: 1,
      conclusion: { claimIds: ['measured-total-cost'] },
      why: [{ claimIds: ['observed-calls'] }],
      details: [{ claimIds: ['observed-sessions'] }],
      claims: [{ id: 'measured-total-cost' }, { id: 'observed-calls' }, { id: 'observed-sessions' }],
      presentationRequests: [{ kind: 'metric-cards' }],
    }))
    expect(draft).not.toBeNull()
    expect(verifyAdvisorSynthesis(draft!, evidence).valid).toBe(true)
    expect(verifyAdvisorSynthesis(draft!, evidence).claims[0]?.id).toBe('measured-total-cost')

    const atoms = buildAdvisorVerifiedClaimAtoms(evidence)
    expect(atoms.find(atom => atom.id === 'measured-total-cost')?.value).toBe(12)
  })

  it('builds chart values from evidence rather than model-authored chart data', () => {
    const fixture = createAdvisorConformanceFixture()
    const base = buildSpendEvidence('Show me the spend trend', fixture.scope, fixture.overview)
    const evidence: AdvisorEvidence = { ...base, spend: { ...base.spend!, history: [{ date: '2026-08-01', costUSD: 3, calls: 1, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null }], modelHistory: [] } }
    const plan = resolveAdvisorQuestion('Show me the spend trend', scope).plan
    const block = buildAdvisorPresentationBlocks(evidence, plan, 'Show me the spend trend').find(item => item.kind === 'line-chart')
    expect(block).toMatchObject({ kind: 'line-chart', series: [{ points: [{ value: 3 }] }] })
  })

  it('keeps a plain factual conversation compact without automatic analytics cards', () => {
    const fixture = createAdvisorConformanceFixture()
    const question = 'How much did I spend?'
    const evidence = buildSpendEvidence(question, fixture.scope, fixture.overview)
    const plan = resolveAdvisorQuestion(question, scope).plan
    const blocks = buildAdvisorPresentationBlocks(evidence, plan, question)
    expect(blocks.some(block => block.kind === 'metric-cards')).toBe(false)
    expect(blocks.some(block => block.kind === 'line-chart' || block.kind === 'bar-chart' || block.kind === 'comparison-table')).toBe(false)
  })

  it('keeps missing Project cost unavailable instead of rendering a synthetic zero', () => {
    const fixture = createAdvisorConformanceFixture()
    const base = buildSpendEvidence('Compare Projects', fixture.scope, fixture.overview)
    const evidence: AdvisorEvidence = {
      ...base,
      spend: {
        ...base.spend!,
        projects: [{ name: 'Unknown cost project', calls: 2, costUSD: null as unknown as number }],
      },
    }
    const plan = resolveAdvisorQuestion('Compare Projects', scope).plan
    const block = buildAdvisorPresentationBlocks(evidence, plan, 'Compare Projects').find(item => item.kind === 'comparison-table')
    expect(block).toMatchObject({ kind: 'comparison-table', table: { rows: [['Unknown cost project', 'Project', '2', 'Unavailable', 'unavailable']] } })
  })

  it('keeps a model action request out of the Advisor read-tool contract', () => {
    const evidence = buildActionProposalEvidence('Launch five agents', scope, 'Launching agents requires authorization.')
    expect(evidence.intent).toBe('action-proposal')
    expect(evidence.refs).toEqual([])
  })
})
