import { classifyAdvisorQuestion } from './evidence'
import { advisorConversationScopeCompatible, advisorPinnedHarnessContext, advisorScopeIsPinned, UNPINNED_ADVISOR_HARNESS_CONTEXT, type AdvisorConversationTurn, type AdvisorEvidenceDomain, type AdvisorHarnessTaskContextV1, type AdvisorIntent, type AdvisorPeriodFilter, type AdvisorPresentationIntent, type AdvisorQuestionFamily, type AdvisorScope, type AdvisorScopeConflictV1, type AdvisorTurnPlanV1 } from './types'

const PLAN_VERSION = 'advisor-turn-plan-v1' as const
export const ADVISOR_PERIOD_FILTERS: readonly AdvisorPeriodFilter[] = Object.freeze(['today', 'yesterday', 'week', '30days', 'month', 'all', 'lifetime'])

function normalize(question: string): string {
  return question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function scopePeriodLabel(period: AdvisorPeriodFilter): string {
  if (period === 'yesterday') return 'Yesterday'
  if (period === 'today') return 'Today'
  if (period === 'week') return 'This week'
  if (period === '30days') return 'Last 30 days'
  if (period === 'month') return 'This month'
  if (period === 'all') return 'Last 6 months'
  return 'Lifetime'
}

function explicitScopePeriods(value: string): AdvisorPeriodFilter[] {
  const matches: Array<{ period: AdvisorPeriodFilter; index: number }> = []
  const add = (period: AdvisorPeriodFilter, pattern: RegExp) => {
    const match = pattern.exec(value)
    pattern.lastIndex = 0
    if (match && match.index !== undefined) matches.push({ period, index: match.index })
  }
  add('yesterday', /\b(?:yesterday|ieri)\b/u)
  add('today', /\b(?:today|oggi)\b/u)
  add('week', /(?:\b(?:last|past|this)\s+(?:week|7\s+days)|\b(?:questa|la\s+scorsa)\s+settimana|\bultimi\s+7\s+giorni)/u)
  add('30days', /(?:\b(?:last|past)\s+30\s+days|\bultimi\s+30\s+giorni)/u)
  add('month', /(?:\b(?:this|last)\s+month|\bquesto\s+mese|\bmese\s+scorso)/u)
  add('lifetime', /(?:\b(?:all[ -]?time|lifetime|overall|total(?:ly)?)\b|\b(?:in\s+totale|da\s+sempre|tutta\s+la\s+vita)\b)/u)
  return Array.from(new Set(matches.sort((left, right) => left.index - right.index).map(item => item.period)))
}

function selectedScopeMatchesRequestedPeriod(scope: AdvisorScope, requested: AdvisorPeriodFilter): boolean {
  if (requested === 'yesterday') {
    if (scope.period !== 'today' || !scope.range || scope.range.from !== scope.range.to) return false
    const yesterday = new Date()
    yesterday.setHours(12, 0, 0, 0)
    yesterday.setDate(yesterday.getDate() - 1)
    const date = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0')
    return scope.range.from === date
  }
  if (requested === 'lifetime') return scope.period === 'lifetime'
  return scope.period === requested
}

function scopeConflict(value: string, scope: AdvisorScope): AdvisorScopeConflictV1 | undefined {
  const requestedPeriods = explicitScopePeriods(value)
  if (requestedPeriods.length !== 1) return undefined
  const requested = requestedPeriods[0]!
  // An ordinary Harness conversation is intentionally unpinned. Its
  // compatibility scope.period is a default for non-explicit questions, not a
  // permission boundary for a user-requested period.
  if (!advisorScopeIsPinned(scope, 'period') && !advisorScopeIsPinned(scope, 'range') && !scope.range) return undefined
  if (!requested || selectedScopeMatchesRequestedPeriod(scope, requested)) return undefined
  const current = scopePeriodLabel(scope.period)
  const requestedLabel = scopePeriodLabel(requested)
  const italian = advisorCopyLanguage(value) === 'it'
  return {
    currentPeriod: scope.period,
    requestedPeriod: requested,
    message: italian
      ? `Questa domanda richiede ${requestedLabel}, ma lo scope corrente è ${current}. Scegli "Use ${requestedLabel} for this turn" oppure "Change scope".`
      : `This question requires ${requestedLabel}, but the current scope is ${current}. Choose "Use ${requestedLabel} for this turn" or "Change scope".`,
    options: [
      { id: 'use-requested-period', label: 'Use ' + requestedLabel + ' for this turn' },
      { id: 'change-scope', label: 'Change scope' },
    ],
  }
}

/** Build a bounded turn-local scope after the user chooses the requested period. */
export function advisorScopeForRequestedPeriod(scope: AdvisorScope, requested: AdvisorPeriodFilter, now = new Date(), harnessContext = UNPINNED_ADVISOR_HARNESS_CONTEXT): AdvisorScope {
  if (requested === 'yesterday') {
    const yesterday = new Date(now.getTime())
    yesterday.setHours(12, 0, 0, 0)
    yesterday.setDate(yesterday.getDate() - 1)
    const year = yesterday.getFullYear()
    const month = String(yesterday.getMonth() + 1).padStart(2, '0')
    const day = String(yesterday.getDate()).padStart(2, '0')
    const date = year + '-' + month + '-' + day
    return { ...scope, period: 'today', range: { from: date, to: date }, harnessContext }
  }
  return { ...scope, period: requested, range: null, harnessContext }
}

export function advisorPinnedScopeForRequestedPeriod(scope: AdvisorScope, requested: AdvisorPeriodFilter, now = new Date()): AdvisorScope {
  return advisorScopeForRequestedPeriod(scope, requested, now, advisorPinnedHarnessContext('period'))
}

/**
 * The generic scope.period remains useful as a compatibility default, but an
 * unpinned Harness turn can use any one of the bounded period filters. A
 * ranged or intentionally pinned scope remains restrictive.
 */
export function advisorAllowedPeriods(scope: AdvisorScope, question = ''): AdvisorPeriodFilter[] {
  const requestedPeriods = explicitScopePeriods(normalize(question))
  if (scope.range || advisorScopeIsPinned(scope, 'period') || advisorScopeIsPinned(scope, 'range')) {
    return requestedPeriods.includes('yesterday') && scope.period === 'today' ? [scope.period, 'yesterday'] : [scope.period]
  }
  // An unpinned shell may choose a period for the current turn, but a model
  // tool call must stay inside that same turn-local choice. If the user did
  // not name a new period, the resolved scope period is the only allowed
  // period for required and model-selected reads.
  return requestedPeriods.length ? requestedPeriods : [scope.period]
}

function sameTaskScopeDimensions(left: AdvisorScope, right: AdvisorScope): boolean {
  return left.provider === right.provider
    && left.projectId === right.projectId
    && left.model === right.model
    && (left.range?.from ?? null) === (right.range?.from ?? null)
    && (left.range?.to ?? null) === (right.range?.to ?? null)
}

export function advisorTaskContextForTurn(scope: AdvisorScope, taskContext?: AdvisorHarnessTaskContextV1): AdvisorHarnessTaskContextV1 | undefined {
  if (!taskContext || !sameTaskScopeDimensions(scope, taskContext.scope)) return undefined
  if ((scope.range || advisorScopeIsPinned(scope, 'period') || advisorScopeIsPinned(scope, 'range')) && scope.period !== taskContext.scope.period) return undefined
  return taskContext
}

/**
 * Resolve a single explicit period into the immutable turn context used by
 * controller-owned runs. An unpinned Harness may choose one bounded period
 * for the turn; an intentionally pinned period remains subject to the normal
 * conflict contract and is never widened here.
 */
export function advisorScopeForTurn(scope: AdvisorScope, question: string, taskContext?: AdvisorHarnessTaskContextV1): AdvisorScope {
  if (scope.range || advisorScopeIsPinned(scope, 'period') || advisorScopeIsPinned(scope, 'range')) return scope
  const requestedPeriods = explicitScopePeriods(normalize(question))
  const usableTaskContext = advisorTaskContextForTurn(scope, taskContext)
  if (requestedPeriods.length === 1) {
    const taskScope = usableTaskContext?.scope
    // A pinned task context remains restrictive even when the current shell
    // is unpinned. An explicit new period must reach the normal clarification
    // contract instead of silently widening that task.
    if (taskScope && advisorScopeIsPinned(taskScope, 'period')) return taskScope
    return advisorScopeForRequestedPeriod(scope, requestedPeriods[0]!)
  }
  const taskScope = usableTaskContext?.scope
  // An unpinned Harness still carries the last bounded task context for a
  // related follow-up. This keeps “which models contributed?” on the same
  // lifetime/weekly read without turning the shell into a permanent filter.
  return taskScope && usableTaskContext?.availableToolNames.length ? taskScope : scope
}

export function advisorCopyLanguage(question: string): 'en' | 'it' {
  const value = normalize(question)
  return /^(?:ciao|salve|buongiorno|buonasera|buon giorno|come stai|grazie|grazie mille|esegui|avvia|lancia|cambia|applica|programma|quanto|perche|perché|qual|quale|quali|mostrami|confronta|spesa|speso|costo|quota|limite|disponibilita|disponibilità)\b/u.test(value)
    || /\b(?:prima del reset|dopo il reset|quanto ho speso|perche la spesa|perché la spesa|in totale|da sempre|fornitore|modello|progetto|sessione|andamento|consumi)\b/u.test(value)
    ? 'it'
    : 'en'
}

function isGreeting(value: string): boolean {
  return /^(?:ciao|salve|buongiorno|buonasera|buon giorno|hello|hi|hey|good morning|good evening)[!.?,\s]*$/u.test(value)
}

function isThanks(value: string): boolean {
  return /^(?:grazie|grazie mille|thanks|thank you|thankyou|much appreciated)[!.?,\s]*$/u.test(value)
}

function isHowAreYou(value: string): boolean {
  return /^(?:come stai|how are you)[!?.,\s]*$/u.test(value)
}

function isSocial(value: string): boolean {
  if (isGreeting(value) || isThanks(value) || isHowAreYou(value)) return true
  // Keep obvious compound greetings conversational even in the deterministic
  // fallback. Unknown languages are handled by the model semantic planner; do
  // not grow this into a language catalogue.
  return /^(?:ciao|salve|buongiorno|buonasera|buon giorno|hello|hi|hey|good morning|good evening)\b[^\n]{0,48}\b(?:come stai|how are you)\b[!?.,\s]*$/u.test(value)
}

function isActionRequest(value: string): boolean {
  if (/^(?:which|what|can|could|show|compare|are|is|how|perche|perché|quali|quale|come)\b/u.test(value)) return false
  const verb = /^(?:please\s+)?(?:run|start|launch|execute|change|apply|schedule|esegui|avvia|lancia|cambia|applica|programma)\b/u.test(value)
    || /\b(?:run|start|launch|execute|change|apply|schedule|esegui|avvia|lancia|cambia|applica|programma)\s+(?:this|that|a|the|il|la|un|una|bench|benchmark|agent|agents|routing|route|policy|politica)\b/u.test(value)
  const target = /\b(?:bench|benchmark|task[ -]?pack|agent(?:s|i)?|routing|route|policy|polic(?:y|ies)|orchestrat|core[ -]?compat(?:ibility|ibilita)?)/u.test(value)
  return verb && target
}

function isBenchQuestion(value: string): boolean {
  return /\b(?:bench|controlled test|task[ -]?pack|benchmark|test controllato|prova controllata|latest Bench run|previous Bench run|Bench runs?|runs?(?: be)? compared|tasks? failed|failed tasks?)\b/u.test(value)
}

function isUnsupportedQuestion(value: string): boolean {
  if (/(?:how do i|come faccio|news|weather|meteo|write code|scrivi codice|forecast|predict|preved|should i buy|cosa dovrei comprare)/u.test(value)) return true
  return /\b(?:best|smartest|better overall|which model should|modello migliore|piu intelligente|migliore in assoluto|quale modello comprare|recommend|consigli)\b/u.test(value)
}

function isQuotaQuestion(value: string): boolean {
  return /(?:quota|capacity|reset|remaining|rate[ -]?limit|credits?|disponibil|limite|esaur)/u.test(value)
}

function isEfficiencyQuestion(value: string): boolean {
  return /(?:model efficiency|lower observed cost per call|cheaper per observed call|cost per call|per observed call|which model.*(?:lower|cheaper)|compare.*model.*(?:cost|efficien)|efficien|efficient|econom|costo per chiamata|costo per call)/u.test(value)
}

function hasMeasuredSpendFocus(value: string): boolean {
  const spendMarkers = /(?:\bspend\b|\bspent\b|\bcost\b|\bcost me\b|\bexpense\w*\b|\bspes[ao]\b|\bcost[ao]\b|\bpagat[oa]\b)/u
  const quotaMarkers = /(?:\bquota\b|\bcapacity\b|\breset\b|\bremaining\b|\brate[ -]?limit\b|\bcredits?\b|\blimite\b|\bdisponibil\w*\b|\besaur\w*\b)/u
  if (!spendMarkers.test(value)) return false
  const directSpendQuestion = /(?:\bhow much did\b[^?.!]{0,48}\b(?:spend|spent)\b|\bwhy did\b[^?.!]{0,48}\b(?:spend|spent|cost)\b|\bwhat did\b[^?.!]{0,48}\bcost\b|\bquanto ho speso\b|\bperche\b[^?.!]{0,48}\b(?:spesa|speso|costo|costato)\b|\bperché\b[^?.!]{0,48}\b(?:spesa|speso|costo|costato)\b)/u.test(value)
  const quotaPrimaryQuestion = /(?:\b(?:how much|what|when|which|quanto|quanta|quando|quale|quali)\b[^?.!]{0,32}\b(?:quota|capacity|limit|remaining|credits?|limite|disponibil\w*)\b|\b(?:quota|capacity|limit|limite)\b[^?.!]{0,48}\b(?:left|remain|remaining|reset|resetta|resetto|rimane|resta|si azzera)\b)/u.test(value)
  if (quotaPrimaryQuestion && !directSpendQuestion) return false
  // A spend noun used as the object of a quota question still asks about
  // quota. Otherwise, a spend verb/noun is the requested fact and quota/reset
  // language is contextual scope (for example “before the reset”).
  const spendIsQuotaObject = quotaMarkers.test(value) && /(?:\b(?:spend|spent|spesa|speso|costo|cost)\b)\s+(?:quota|capacity|limit|limite|remaining|disponibil)/u.test(value)
  if (spendIsQuotaObject) return false
  if (directSpendQuestion || /(?:\b(?:what|how much|why|quanto|perche|perché)\b[^?.!]{0,80}\b(?:spend|spent|cost|spesa|speso|costo)\b)/u.test(value)) return true
  return /(?:\b(?:spend|spent|cost|spesa|speso|costo)\b[^?.!]{0,80}\b(?:before|after|when|prima|dopo|reset|quota)\b)/u.test(value) || spendMarkers.test(value)
}

function isSpendQuestion(value: string): boolean {
  if (isEfficiencyQuestion(value)) return false
  return /(?:why did|what caused|cause|driver|drove|spend|spent|cost me the most|most expensive|increase|increas|change|changed|spike|which project|which sessions?|unusually expensive|expensive sessions?|versus|\bvs\b|costa|costo|spesa|aument|picco|perche|perché|quanto ho speso|quanto spend)/u.test(value)
}

function explicitIntent(value: string): AdvisorIntent {
  if (isBenchQuestion(value)) return 'bench-result'
  if (isBareLimitAmbiguity(value)) return 'clarification'
  if (isUnsupportedQuestion(value)) return 'unsupported'
  if (isEfficiencyQuestion(value)) return 'model-efficiency'
  // Resolve semantic focus before contextual quota/reset markers. This is a
  // generalized precedence rule for the requested fact, not a phrase list for
  // individual regression strings.
  if (hasMeasuredSpendFocus(value) || (isSpendQuestion(value) && !isQuotaQuestion(value))) return 'spend-change'
  if (isQuotaQuestion(value)) return 'quota-capacity'
  return classifyAdvisorQuestion(value)
}

function isBareLimitAmbiguity(value: string): boolean {
  if (!/\blimit(?:s)?\b|\blimite\b/u.test(value)) return false
  return !/(?:quota|capacity|reset|remaining|rate[ -]?limit|credit|provider|codex|claude|usage|spend|spent|cost|costo|spesa|calls?|chiamat|consum)/u.test(value)
}

function presentationIntent(value: string, family: AdvisorQuestionFamily): AdvisorPresentationIntent {
  if (/(?:table|tabella|compare|confronta|versus|\bvs\b)/u.test(value)) return 'comparison-table'
  if (/(?:chart|graph|grafico|grafica|trend|andamento|timeline|serie temporale)/u.test(value)) return family === 'models' || family === 'providers' ? 'line-chart' : 'line-chart'
  if (family === 'quota') return 'quota-card'
  if (family === 'bench') return 'bench-summary'
  if (family === 'evidence' || /(?:technical|tecnico|provenance|provenienza|how do you know|come lo sai)/u.test(value)) return 'evidence-disclosure'
  if (family === 'models' || family === 'providers' || family === 'projects' || family === 'sessions') return 'comparison-table'
  return 'text'
}

function questionFamily(value: string, intent: AdvisorIntent): AdvisorQuestionFamily {
  if (intent === 'action-proposal') return 'action'
  if (intent === 'bench-result') return 'bench'
  if (intent === 'quota-capacity') return 'quota'
  if (/(?:pricing|price|priced|prezzo|prezzi|pricing coverage|copertura prezzi)/u.test(value)) return 'pricing'
  if (/(?:reasoning|thinking|deliberat|ragionamento)/u.test(value)) return 'reasoning'
  if (/(?:cache|cached|caching)/u.test(value)) return 'cache'
  if (/(?:token|tokens|input|output)/u.test(value)) return 'tokens'
  if (/(?:session|activity|attivita|turn|workflow|workflows)/u.test(value)) return 'sessions'
  if (/(?:project|progetto)/u.test(value)) return 'projects'
  if (/(?:provider|fornitore|endpoint)/u.test(value)) return 'providers'
  if (/(?:model|modello|efficien|compare|confronta)/u.test(value) || intent === 'model-efficiency') return 'models'
  if (intent === 'spend-change') return 'spend'
  if (/(?:usage|utilizzo|consum|quanto ho)/u.test(value)) return 'usage'
  if (/(?:evidence|coverage|fresh|stale|unavailable|provenance|evidenza|copertura)/u.test(value)) return 'evidence'
  return 'unknown'
}

function domainsForFamily(family: AdvisorQuestionFamily): AdvisorEvidenceDomain[] {
  const common: AdvisorEvidenceDomain[] = ['usage-totals', 'cost', 'freshness']
  if (family === 'usage' || family === 'spend') return [...common, 'usage-time-series', 'projects', 'sessions', 'models']
  if (family === 'tokens') return [...common, 'tokens', 'models']
  if (family === 'cache') return [...common, 'cache', 'tokens', 'models']
  if (family === 'reasoning') return [...common, 'reasoning', 'models']
  if (family === 'models') return [...common, 'models', 'tokens', 'pricing']
  if (family === 'providers') return [...common, 'providers', 'models']
  if (family === 'projects') return [...common, 'projects', 'sessions', 'models']
  if (family === 'sessions') return [...common, 'sessions', 'projects', 'models']
  if (family === 'pricing') return [...common, 'pricing', 'models']
  if (family === 'quota') return ['provider-capacity', 'freshness', 'usage-totals']
  if (family === 'bench') return ['bench-history', 'freshness']
  if (family === 'evidence') return ['freshness', 'usage-totals', 'models', 'providers', 'projects', 'sessions', 'pricing', 'provider-capacity', 'bench-history']
  return []
}

function scopeWasExplicit(value: string): boolean {
  return /(?:today|yesterday|this week|last 7|last week|30 days|this month|last month|all[ -]?time|lifetime|overall|total(?:ly)?|da sempre|in totale|period|project|provider|model|oggi|ieri|questa settimana|ultimi 7|mese scorso|questo mese|progetto|fornitore|modello)/u.test(value)
}

function priorIntents(scope: AdvisorScope, conversation: AdvisorConversationTurn[]): AdvisorIntent[] {
  return conversation
    .filter(turn => turn.role === 'user' && advisorConversationScopeCompatible(scope, turn.scopeFingerprint))
    .slice(-4)
    .map(turn => explicitIntent(normalize(turn.content)))
    .filter(intent => intent !== 'unknown' && intent !== 'clarification' && intent !== 'unsupported')
}

function expertDetail(value: string): boolean {
  return /(?:technical|expert|details|diagnostic|provenance|technical data|tecnico|dettagli|diagnostica|provenienza|json|schema)/u.test(value)
}

function hasStandaloneConversationShape(value: string): boolean {
  return /\b(?:joke|poem|recipe|story|barzellett\w*|poesi\w*|ricett\w*)\b/u.test(value)
}

export function createAdvisorTurnPlanV1(question: string, scope: AdvisorScope, conversation: AdvisorConversationTurn[] = [], taskContext?: AdvisorHarnessTaskContextV1): AdvisorTurnPlanV1 & { intent: AdvisorIntent; usedDefaultScope: boolean } {
  const value = normalize(question)
  const usableTaskContext = advisorTaskContextForTurn(scope, taskContext)
  const social = isSocial(value)
  const action = !social && isActionRequest(value)
  const baseIntent: AdvisorIntent = social ? 'social' : action ? 'action-proposal' : explicitIntent(value)
  const historicalFollowUp = !social && !action && baseIntent === 'unknown' && /^(?:and|also|what about|how about|that|it|this|quello|e|invece|quanto a|fammi vedere meglio|show me more)\b/u.test(value)
  // A pending task may make a short, otherwise unclassified turn a
  // continuation. This deliberately uses bounded task state and message
  // shape, never a catalogue of language-specific proceed words.
  const structuredFollowUp = !social
    && !action
    && baseIntent === 'unknown'
    && Boolean(usableTaskContext?.availableToolNames.length)
    && !scopeWasExplicit(value)
    && value.length <= 96
    && value.split(/\s+/u).filter(Boolean).length <= 12
    && !hasStandaloneConversationShape(value)
  const followUp = historicalFollowUp || structuredFollowUp
  let intent = baseIntent
  let scopeIntent: AdvisorTurnPlanV1['scopeIntent'] = scopeWasExplicit(value) ? 'explicit' : 'current'
  let clarification: string | null = null
  let requestedScopeConflict: AdvisorScopeConflictV1 | undefined
  if (!social && !action && isBareLimitAmbiguity(value)) {
    intent = 'clarification'
    scopeIntent = 'ambiguous'
    clarification = advisorCopyLanguage(value) === 'it'
      ? 'Intendi la quota riportata dal provider oppure l’utilizzo misurato da Metrora?'
      : 'Do you mean provider-reported quota, or your Metrora-measured usage?'
  } else if (followUp) {
    const distinct = [...new Set(priorIntents(scope, conversation))]
    if (distinct.length === 1) {
      intent = distinct[0]!
      scopeIntent = 'follow-up'
    } else if (distinct.length > 1) {
      intent = 'clarification'
      scopeIntent = 'ambiguous'
      clarification = advisorCopyLanguage(value) === 'it'
        ? 'Su cosa devo continuare: spesa misurata, quota del provider o risultato del test controllato?'
        : 'Which should I continue with: measured spend, provider quota, or the controlled test result?'
    } else if (structuredFollowUp) {
      scopeIntent = 'follow-up'
    }
  }
  if (!social && !action && !clarification && intent !== 'unsupported') {
    requestedScopeConflict = scopeConflict(value, scope)
    if (requestedScopeConflict) {
      scopeIntent = 'ambiguous'
      clarification = requestedScopeConflict.message
    }
  }
  const family = social ? 'unknown' : questionFamily(value, intent)
  const boundary = action || intent === 'unsupported'
  return {
    contractVersion: PLAN_VERSION,
    schemaVersion: 1,
    turnKind: social ? 'social' : intent === 'clarification' || requestedScopeConflict ? 'clarify' : boundary ? 'boundary' : 'investigate',
    questionFamily: family,
    scopeIntent,
    requestedEvidenceDomains: domainsForFamily(family),
    clarification,
    presentationIntent: presentationIntent(value, family),
    expertDetailRequested: expertDetail(value),
    authorization: action ? 'proposal-required' : 'read-only',
    ...(requestedScopeConflict ? { scopeConflict: requestedScopeConflict } : {}),
    intent,
    usedDefaultScope: !scopeWasExplicit(value),
  }
}
