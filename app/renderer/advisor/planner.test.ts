import { describe, expect, it } from 'vitest'

import { ADVISOR_TOOL_DEFINITIONS } from './contract'
import {
  deterministicPlanningFallback,
  parseAdvisorPlanningDraft,
  validateAdvisorPlanningDraft,
} from './planner'
import { createAdvisorTurnPlanV1 } from './turn-plan'
import type { AdvisorPlanningDraftV1, AdvisorScope } from './types'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

function planningDraft(overrides: Partial<AdvisorPlanningDraftV1> = {}): AdvisorPlanningDraftV1 {
  return {
    contractVersion: 'advisor-planning-draft-v1',
    schemaVersion: 1,
    turnKind: 'investigate',
    questionFamily: 'spend',
    requestedEvidenceDomains: ['usage-totals', 'cost', 'freshness'],
    toolRequests: [{ tool: 'get_spend_snapshot', arguments: {} }],
    presentationIntent: 'text',
    expertDetailRequested: false,
    clarification: null,
    ...overrides,
  }
}

describe('Advisor bounded model planning contract', () => {
  it('accepts a paraphrase through the model planning fixture without requiring a regex phrase', () => {
    const question = 'Explain the largest recent shift in my account.'
    const guardPlan = createAdvisorTurnPlanV1(question, scope)
    const draft = parseAdvisorPlanningDraft(JSON.stringify(planningDraft({
      questionFamily: 'spend',
      requestedEvidenceDomains: ['usage-totals', 'usage-time-series', 'cost'],
      toolRequests: [{ tool: 'get_spend_snapshot', arguments: {} }],
      presentationIntent: 'comparison-table',
    })))

    expect(draft).not.toBeNull()
    const validated = validateAdvisorPlanningDraft(draft!, guardPlan, scope, ADVISOR_TOOL_DEFINITIONS, guardPlan.intent)
    expect(validated).toMatchObject({
      modelAssisted: true,
      plan: { questionFamily: 'spend', authorization: 'read-only', turnKind: 'investigate' },
      toolRequests: [{ tool: 'get_spend_snapshot', arguments: {} }],
    })
  })

  it('falls back deterministically when the model returns answer prose instead of a plan', () => {
    const guardPlan = createAdvisorTurnPlanV1('What changed in spend?', scope)
    const malformed = parseAdvisorPlanningDraft(JSON.stringify({
      contractVersion: 'advisor-planning-draft-v1',
      schemaVersion: 1,
      conclusion: 'Spend rose because of Codex.',
    }))

    expect(malformed).toBeNull()
    expect(deterministicPlanningFallback(guardPlan, ADVISOR_TOOL_DEFINITIONS)).toMatchObject({
      modelAssisted: false,
      toolRequests: [{ tool: 'get_spend_snapshot', arguments: {} }],
    })
  })

  it('does not let planning turn an action boundary into read-only execution', () => {
    const guardPlan = createAdvisorTurnPlanV1('Run this benchmark', scope)
    const draft = planningDraft({ questionFamily: 'action' })
    expect(validateAdvisorPlanningDraft(draft, guardPlan, scope, ADVISOR_TOOL_DEFINITIONS, guardPlan.intent)).toBeNull()
  })

  it('rejects requests that widen the guarded model or provider scope', () => {
    const modelScope = { ...scope, model: 'gpt-safe' }
    const modelGuard = createAdvisorTurnPlanV1('What changed in spend?', modelScope)
    expect(validateAdvisorPlanningDraft(
      planningDraft({ toolRequests: [{ tool: 'get_spend_snapshot', arguments: { model: 'other-model' } }] }),
      modelGuard,
      modelScope,
      ADVISOR_TOOL_DEFINITIONS,
      modelGuard.intent,
    )).toBeNull()

    const providerScope = { ...scope, provider: 'claude' }
    const providerGuard = createAdvisorTurnPlanV1('What quota remains?', providerScope)
    expect(validateAdvisorPlanningDraft(
      planningDraft({
        questionFamily: 'quota',
        toolRequests: [{ tool: 'get_quota_snapshot', arguments: { provider: 'codex' } }],
      }),
      providerGuard,
      providerScope,
      ADVISOR_TOOL_DEFINITIONS,
      providerGuard.intent,
    )).toBeNull()
  })

  it('rejects unknown or write-like tools even when their JSON shape is valid', () => {
    const guardPlan = createAdvisorTurnPlanV1('What changed in spend?', scope)
    const draft = parseAdvisorPlanningDraft(JSON.stringify(planningDraft({
      toolRequests: [{ tool: 'write_file', arguments: {} } as never],
    })))
    expect(draft).not.toBeNull()
    expect(validateAdvisorPlanningDraft(draft!, guardPlan, scope, ADVISOR_TOOL_DEFINITIONS, guardPlan.intent)).toBeNull()
  })
})
