import { describe, expect, it } from 'vitest'

import { ADVISOR_TOOL_DEFINITIONS } from './contract'
import { parseAdvisorPlanningDraft, validateAdvisorPlanningDraft } from './planner'
import { createAdvisorTurnPlanV1 } from './turn-plan'
import type { AdvisorScope } from './types'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

function conversationalDraft(turnKind: 'social' | 'boundary') {
  return parseAdvisorPlanningDraft(JSON.stringify({
    contractVersion: 'advisor-planning-draft-v1',
    schemaVersion: 1,
    turnKind,
    questionFamily: 'unknown',
    requestedEvidenceDomains: [],
    toolRequests: [],
    presentationIntent: 'text',
    expertDetailRequested: false,
    clarification: null,
  }))
}

describe('Advisor conversation-first routing', () => {
  it('keeps compound greetings out of the evidence path', () => {
    const plan = createAdvisorTurnPlanV1('ciao come stai', scope)
    expect(plan).toMatchObject({ intent: 'social', turnKind: 'social', authorization: 'read-only' })
    expect(plan.requestedEvidenceDomains).toEqual([])
  })

  it('lets a model narrow an otherwise unknown foreign-language turn to social without tools', () => {
    const guard = createAdvisorTurnPlanV1('Bonjour, comment ça va ?', scope)
    expect(guard.turnKind).toBe('investigate')
    const validated = validateAdvisorPlanningDraft(conversationalDraft('social')!, guard, scope, ADVISOR_TOOL_DEFINITIONS)
    expect(validated).toMatchObject({
      modelAssisted: true,
      plan: { turnKind: 'social', questionFamily: 'unknown', authorization: 'read-only' },
      toolRequests: [],
    })
  })

  it('lets a model narrow an unknown out-of-domain request to a boundary without tools', () => {
    const guard = createAdvisorTurnPlanV1('Écris-moi une application complète en Rust', scope)
    const validated = validateAdvisorPlanningDraft(conversationalDraft('boundary')!, guard, scope, ADVISOR_TOOL_DEFINITIONS)
    expect(validated).toMatchObject({ plan: { turnKind: 'boundary', authorization: 'read-only' }, toolRequests: [] })
  })

  it('does not let the model bypass an explicit action guard by calling it social', () => {
    const actionGuard = createAdvisorTurnPlanV1('Run this benchmark', scope)
    expect(actionGuard.authorization).toBe('proposal-required')
    expect(validateAdvisorPlanningDraft(conversationalDraft('social')!, actionGuard, scope, ADVISOR_TOOL_DEFINITIONS)).toBeNull()
  })

  it('rejects conversational plans that try to smuggle evidence or tools', () => {
    const guard = createAdvisorTurnPlanV1('Bonjour, comment ça va ?', scope)
    const malformed = parseAdvisorPlanningDraft(JSON.stringify({
      contractVersion: 'advisor-planning-draft-v1',
      schemaVersion: 1,
      turnKind: 'social',
      questionFamily: 'unknown',
      requestedEvidenceDomains: ['cost'],
      toolRequests: [{ tool: 'get_spend_snapshot', arguments: {} }],
      presentationIntent: 'text',
      expertDetailRequested: false,
      clarification: null,
    }))
    expect(malformed).not.toBeNull()
    expect(validateAdvisorPlanningDraft(malformed!, guard, scope, ADVISOR_TOOL_DEFINITIONS)).toBeNull()
  })
})
