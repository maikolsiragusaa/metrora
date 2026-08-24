import { classifyAdvisorQuestion } from './evidence'
import type { AdvisorConversationTurn, AdvisorIntent, AdvisorQuestionUnderstanding, AdvisorScope } from './types'
import { advisorScopeFingerprint } from './types'

export type AdvisorQuestionPlan = {
  intent: AdvisorIntent
  understanding: AdvisorQuestionUnderstanding
  needsEvidence: boolean
  usedDefaultScope: boolean
}

function normalize(question: string): string {
  return question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function isBenchQuestion(value: string): boolean {
  return /\b(?:bench|controlled test|task pack|task-pack|benchmark|run(?:s|ning)?|esecuzione controllata|test controllato|prova controllata|failed tasks?|tasks? failed|which tasks? failed|quali task.*fallit)\b/u.test(value)
}

function isUnsupportedQuestion(value: string): boolean {
  if (/(?:how do i|come faccio|what is|cos'e|cos e|news|weather|meteo|write code|scrivi codice|forecast|predict|preved|recommend|consigli|should i buy|cosa dovrei comprare)/u.test(value)) return true
  return /\b(?:best|smartest|better overall|best coding|which model should|modello migliore|modello piu intelligente|migliore in assoluto|quale modello comprare)\b/u.test(value)
}

function isQuotaQuestion(value: string): boolean {
  return /\b(?:quota|capacity|reset|remaining|rate[ -]?limit|credits?|disponibil|limite|esaur|codex|claude)\b/u.test(value)
}

function isBareLimitAmbiguity(value: string): boolean {
  if (!/\blimit(?:s)?\b|\blimite\b/u.test(value)) return false
  return !/(?:quota|capacity|reset|remaining|rate[ -]?limit|credit|provider|codex|claude|usage|spend|spent|cost|costo|spesa|calls?|chiamat|consum)/u.test(value)
}

function isSpendQuestion(value: string): boolean {
  return /(?:why did|what caused|cause|driver|drove|spend|spent|cost me the most|most expensive|which project|which sessions?|unusually expensive|expensive sessions?|versus|\bvs\b|costo|spesa|aument|picco|perche|perché|quanto ho speso)/u.test(value)
}

function isEfficiencyQuestion(value: string): boolean {
  return /(?:model efficiency|lower observed cost per call|cheaper per observed call|cost per call|per observed call|which model.*(?:lower|cheaper)|compare.*model.*(?:cost|efficien)|efficien|efficient|econom|costo per chiamata|costo per call)/u.test(value)
}

function explicitIntent(value: string): AdvisorIntent {
  if (isBenchQuestion(value)) return 'bench-result'
  if (isUnsupportedQuestion(value)) return 'unsupported'
  if (isBareLimitAmbiguity(value)) return 'clarification'
  if (isQuotaQuestion(value)) return 'quota-capacity'
  // "What model cost me the most?" is a spend question, not a quality or
  // efficiency recommendation. Explicit observed cost-per-call language is
  // the narrower model-efficiency intent.
  if (isSpendQuestion(value)) return 'spend-change'
  if (isEfficiencyQuestion(value)) return 'model-efficiency'
  const classified = classifyAdvisorQuestion(value)
  return classified
}

function isFollowUp(value: string): boolean {
  return /^(?:and|also|what about|how about|that|it|this|quello|e|invece|quanto a)\b|\b(?:it|that|this|quello)\b/u.test(value)
}

function priorIntents(question: string, scope: AdvisorScope, conversation: AdvisorConversationTurn[]): AdvisorIntent[] {
  const currentFingerprint = advisorScopeFingerprint(scope)
  return conversation
    .filter(turn => turn.role === 'user' && turn.scopeFingerprint === currentFingerprint)
    .map(turn => explicitIntent(normalize(turn.content)))
    .filter((intent): intent is AdvisorIntent => intent !== 'unknown' && intent !== 'clarification' && intent !== 'unsupported')
    .slice(-4)
}

function scopeWasExplicit(value: string): boolean {
  return /(?:today|yesterday|this week|last 7|last week|30 days|this month|lifetime|period|project|provider|model|oggi|ieri|questa settimana|ultimi 7|mese|progetto|fornitore|modello)/u.test(value)
}

function intentSummary(intent: AdvisorIntent): string {
  if (intent === 'spend-change') return 'a Metrora-measured spend or usage question'
  if (intent === 'model-efficiency') return 'an observed cost-per-call comparison'
  if (intent === 'quota-capacity') return 'a provider-reported quota or capacity question'
  if (intent === 'bench-result') return 'a controlled Bench result question'
  if (intent === 'unsupported') return 'a question outside Metrora evidence'
  if (intent === 'clarification') return 'an ambiguous limit question'
  return 'a Metrora question that needs a supported evidence category'
}

function understanding(
  intent: AdvisorIntent,
  usedDefaultScope: boolean,
  clarification: string | null,
  boundary: string | null,
): AdvisorQuestionUnderstanding {
  return {
    intent,
    summary: intentSummary(intent),
    usedDefaultScope,
    clarification,
    boundary,
  }
}

export function resolveAdvisorQuestion(
  question: string,
  scope: AdvisorScope,
  conversation: AdvisorConversationTurn[] = [],
): AdvisorQuestionPlan {
  const value = normalize(question)
  const usedDefaultScope = !scopeWasExplicit(value)
  let intent = explicitIntent(value)
  let clarification: string | null = null
  let boundary: string | null = null

  if (intent === 'clarification') {
    clarification = 'Do you mean provider-reported quota, or your Metrora-measured usage?'
  } else if (intent === 'unsupported') {
    boundary = 'I can explain Metrora-measured usage, provider-reported quota, observed model cost, and controlled Bench results, but I cannot make a universal model ranking or recommendation.'
  } else if (intent === 'unknown' && isFollowUp(value)) {
    const prior = priorIntents(question, scope, conversation)
    const distinct = [...new Set(prior)]
    if (distinct.length === 1) intent = distinct[0]!
    else if (distinct.length > 1) {
      intent = 'clarification'
      clarification = 'Which should I continue with: measured spend, provider quota, or the controlled test result?'
    }
  }

  return {
    intent,
    understanding: understanding(intent, usedDefaultScope, clarification, boundary),
    needsEvidence: intent !== 'clarification' && intent !== 'unsupported' && intent !== 'unknown',
    usedDefaultScope,
  }
}
