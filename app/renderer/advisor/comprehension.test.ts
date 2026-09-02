import { describe, expect, it } from 'vitest'

import { resolveAdvisorQuestion } from './comprehension'
import { advisorScopeForRequestedPeriod } from './turn-plan'
import { advisorScopeFingerprint, type AdvisorScope } from './types'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

describe('Advisor deterministic comprehension', () => {
  it.each([
    ['Why did I spend more this week?', 'spend-change'],
    ['How much did I spend with Claude?', 'spend-change'],
    ['Why did Codex cost more this week?', 'spend-change'],
    ['Quanto ho speso con Claude?', 'spend-change'],
    ['Perché Codex mi è costato di più questa settimana?', 'spend-change'],
    ['Am I close to my Codex limit?', 'quota-capacity'],
    ['How much Codex quota remains?', 'quota-capacity'],
    ['What is my limit?', 'clarification'],
    ['What model cost me the most?', 'spend-change'],
    ['What is the observed cost per call?', 'model-efficiency'],
    ['Which tasks failed in the latest Bench run?', 'bench-result'],
    ['Can these runs be compared?', 'bench-result'],
    ['Which model is best?', 'unsupported'],
    ['What is the weather today?', 'unsupported'],
    ['What changed?', 'spend-change'],
    ['How much did I spend before my quota reset?', 'spend-change'],
    ['Why did Codex spend increase before the reset?', 'spend-change'],
    ['Quanto ho speso prima del reset della quota?', 'spend-change'],
    ['Perché la spesa Codex è aumentata prima del reset?', 'spend-change'],
    ['How much quota remains?', 'quota-capacity'],
    ['When does my quota reset?', 'quota-capacity'],
    ['Quanta quota mi rimane?', 'quota-capacity'],
    ['Quando si resetta la quota?', 'quota-capacity'],
  ] as const)('resolves %s as %s', (question, intent) => {
    expect(resolveAdvisorQuestion(question, scope).intent).toBe(intent)
  })

  it.each(['Run Core Compatibility', 'Esegui il pack Core Compatibility'])('recognizes the single accepted Harness action as proposal-only: %s', question => {
    const result = resolveAdvisorQuestion(question, scope)
    expect(result.intent).toBe('action-proposal')
    expect(result.plan.authorization).toBe('proposal-required')
    expect(result.understanding.boundary).toMatch(/Core Compatibility|Compatibilita/u)
  })

  it.each(['Claude', 'Codex'])('does not infer quota from a provider name alone: %s', question => {
    expect(resolveAdvisorQuestion(question, scope).intent).toBe('unknown')
  })

  it('continues an unambiguous follow-up only within the same scope', () => {
    const fingerprint = advisorScopeFingerprint(scope)
    const result = resolveAdvisorQuestion('and sessions?', scope, [{ role: 'user', content: 'What changed in my spend?', scopeFingerprint: fingerprint }])
    expect(result.intent).toBe('spend-change')
    expect(result.needsEvidence).toBe(true)
  })

  it('asks one clarification for an ambiguous follow-up across prior intents', () => {
    const fingerprint = advisorScopeFingerprint(scope)
    const result = resolveAdvisorQuestion('what about that?', scope, [
      { role: 'user', content: 'What changed in my spend?', scopeFingerprint: fingerprint },
      { role: 'user', content: 'What provider quota remains?', scopeFingerprint: fingerprint },
    ])
    expect(result.intent).toBe('clarification')
    expect(result.understanding.clarification).toContain('Which should I continue with')
  })

  it('does not carry a prior intent across a scope change', () => {
    const oldScope = { ...scope, projectId: 'project-a', projectName: 'Project A' }
    const result = resolveAdvisorQuestion('and sessions?', scope, [{ role: 'user', content: 'What changed in my spend?', scopeFingerprint: advisorScopeFingerprint(oldScope) }])
    expect(result.intent).toBe('unknown')
    expect(result.needsEvidence).toBe(false)
  })

  it.each([
    ['How much have I spent in total?', 'today', 'lifetime'],
    ['quanto ho speso da sempre?', 'today', 'lifetime'],
    ['How much did I spend yesterday?', 'lifetime', 'yesterday'],
    ['What did I spend this week?', 'today', 'week'],
  ] as const)('keeps an explicit %s period from silently using %s', (question, currentPeriod, requestedPeriod) => {
    const result = resolveAdvisorQuestion(question, { ...scope, period: currentPeriod })
    expect(result.plan.scopeConflict).toMatchObject({ currentPeriod, requestedPeriod })
    expect(result.plan.scopeIntent).toBe('ambiguous')
    expect(result.needsEvidence).toBe(false)
  })

  it('turns a confirmed Yesterday choice into a bounded date range', () => {
    const next = advisorScopeForRequestedPeriod({ ...scope, period: 'today' }, 'yesterday', new Date(2026, 8, 2, 15, 0, 0))
    expect(next).toMatchObject({ period: 'today', range: { from: '2026-09-01', to: '2026-09-01' } })
  })
})
