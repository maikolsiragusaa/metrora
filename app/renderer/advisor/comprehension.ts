import type { AdvisorConversationTurn, AdvisorIntent, AdvisorQuestionUnderstanding, AdvisorScope, AdvisorTurnPlanV1 } from './types'
import { createAdvisorTurnPlanV1 } from './turn-plan'

export type AdvisorQuestionPlan = {
  intent: AdvisorIntent
  understanding: AdvisorQuestionUnderstanding
  plan: AdvisorTurnPlanV1
  needsEvidence: boolean
  usedDefaultScope: boolean
}

function intentSummary(intent: AdvisorIntent): string {
  if (intent === 'social') return 'a conversational greeting or thanks'
  if (intent === 'spend-change') return 'a Metrora-measured spend or usage question'
  if (intent === 'model-efficiency') return 'an observed cost-per-call comparison'
  if (intent === 'quota-capacity') return 'a provider-reported quota or capacity question'
  if (intent === 'bench-result') return 'a controlled Bench result question'
  if (intent === 'action-proposal') return 'an operational request that needs authorization'
  if (intent === 'unsupported') return 'a question outside Metrora evidence'
  if (intent === 'clarification') return 'an ambiguous limit question'
  return 'a Metrora question that needs a supported evidence category'
}

function actionBoundary(question: string): string {
  const value = question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(?:bench|benchmark|task[ -]?pack)\b/u.test(value)) return 'I understand you want to run a benchmark. Advisor can read and explain existing Bench results, but starting a run is not an authorized conversational action yet.'
  if (/\b(?:agent|agents|agenti|orchestrat)/u.test(value)) return 'I understand you want to launch agents. Advisor can investigate existing Metrora evidence, but orchestration requires a separately approved action proposal and is not executable here.'
  return 'I understand this is an operational request. Advisor is read-only in this conversation; a future action proposal will require explicit user and policy authorization before execution.'
}

function understanding(intent: AdvisorIntent, usedDefaultScope: boolean, clarification: string | null, boundary: string | null): AdvisorQuestionUnderstanding {
  return { intent, summary: intentSummary(intent), usedDefaultScope, clarification, boundary }
}

export function resolveAdvisorQuestion(
  question: string,
  scope: AdvisorScope,
  conversation: AdvisorConversationTurn[] = [],
): AdvisorQuestionPlan {
  const resolved = createAdvisorTurnPlanV1(question, scope, conversation)
  const { intent, usedDefaultScope, ...plan } = resolved
  const boundary = intent === 'action-proposal'
    ? actionBoundary(question)
    : intent === 'unsupported'
      ? 'I can explain Metrora-measured usage, provider-reported quota, observed model cost, and controlled Bench results, but I cannot make a universal model ranking or recommendation.'
      : null
  return {
    intent,
    plan,
    understanding: understanding(intent, usedDefaultScope, plan.clarification, boundary),
    needsEvidence: plan.turnKind === 'investigate' && intent !== 'unknown',
    usedDefaultScope,
  }
}
