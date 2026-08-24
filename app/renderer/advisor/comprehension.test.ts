import { describe, expect, it } from 'vitest'

import { resolveAdvisorQuestion } from './comprehension'
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
  ] as const)('resolves %s as %s', (question, intent) => {
    expect(resolveAdvisorQuestion(question, scope).intent).toBe(intent)
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
})
