import type { AdvisorConversationTurn, AdvisorGuardPlanV1, AdvisorIntent, AdvisorQuestionUnderstanding, AdvisorScope, AdvisorTurnPlanV1 } from './types'
import { advisorCopyLanguage, createAdvisorTurnPlanV1 } from './turn-plan'

export type AdvisorQuestionPlan = {
  intent: AdvisorIntent
  understanding: AdvisorQuestionUnderstanding
  plan: AdvisorTurnPlanV1
  guard: AdvisorGuardPlanV1
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
  if (advisorCopyLanguage(value) === 'it') {
    if (/\b(?:bench|benchmark|task[ -]?pack)\b/u.test(value)) return 'Ho capito che vuoi avviare un benchmark. Advisor può leggere e spiegare risultati Bench esistenti, ma non può avviare un test da questa conversazione.'
    if (/\b(?:agent|agents|agenti|orchestrat)/u.test(value)) return 'Ho capito che vuoi avviare agenti. Advisor può analizzare le evidenze Metrora, ma l’orchestrazione richiede una proposta autorizzata separatamente.'
    return 'Ho capito che si tratta di un’operazione. Advisor è in sola lettura; l’esecuzione richiede una proposta e un’autorizzazione esplicita.'
  }
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
      ? advisorCopyLanguage(question) === 'it'
        ? 'Posso spiegare utilizzo misurato da Metrora, quota riportata dal provider, costo osservato dei modelli e risultati Bench controllati, ma non posso creare una classifica universale o una raccomandazione.'
        : 'I can explain Metrora-measured usage, provider-reported quota, observed model cost, and controlled Bench results, but I cannot make a universal model ranking or recommendation.'
      : null
  const orphanedFollowUp = intent === 'unknown'
    && plan.scopeIntent === 'current'
    && /^(?:and|also|what about|how about|that|it|this|quello|e|invece|quanto a|fammi vedere meglio|show me more)\b/u.test(question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim())
  return {
    intent,
    plan,
    guard: {
      contractVersion: 'advisor-guard-plan-v1',
      schemaVersion: 1,
      turnKind: plan.turnKind,
      scopeIntent: plan.scopeIntent,
      clarification: plan.clarification,
      authorization: plan.authorization,
      intent: intent === 'social' || intent === 'action-proposal' || intent === 'clarification' || intent === 'unsupported' ? intent : 'unknown',
      usedDefaultScope,
    },
    understanding: understanding(intent, usedDefaultScope, plan.clarification, boundary),
    // Unknown but otherwise safe investigations are deliberately eligible for
    // model planning; malformed planning falls back to the supported answer.
    needsEvidence: plan.turnKind === 'investigate' && !orphanedFollowUp,
    usedDefaultScope,
  }
}
/**
 * Guard used when a capable model is available. Deterministic comprehension
 * remains a fallback hint, but social/unsupported/ambiguous wording must not
 * prevent the model from answering or selecting a bounded read tool. Only an
 * explicitly operational request keeps the proposal-required boundary.
 */
export function createAdvisorModelGuardV1(plan: AdvisorQuestionPlan): AdvisorGuardPlanV1 {
  const action = plan.intent === 'action-proposal' || plan.plan.authorization === 'proposal-required'
  return {
    contractVersion: 'advisor-guard-plan-v1',
    schemaVersion: 1,
    turnKind: action ? 'boundary' : 'investigate',
    scopeIntent: plan.plan.scopeIntent,
    clarification: null,
    authorization: action ? 'proposal-required' : 'read-only',
    intent: action ? 'action-proposal' : 'unknown',
    usedDefaultScope: plan.usedDefaultScope,
  }
}
