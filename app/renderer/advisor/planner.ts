import { normalizeAdvisorToolCall } from './contract'
import { sanitizeAdvisorDisplayText } from './privacy'
import { createAdvisorTurnPlanV1 } from './turn-plan'
import type {
  AdvisorEvidenceDomain,
  AdvisorGuardPlanV1,
  AdvisorIntent,
  AdvisorJsonObject,
  AdvisorPlanningDraftV1,
  AdvisorPresentationIntent,
  AdvisorQuestionFamily,
  AdvisorScope,
  AdvisorToolDefinition,
  AdvisorToolName,
  AdvisorToolRequestV1,
  AdvisorTurnPlanV1,
  AdvisorRuntimeInput,
} from './types'

const MAX_PLANNING_BYTES = 12 * 1024
const MAX_TOOL_REQUESTS = 8
const MAX_DOMAINS = 16
const MAX_TEXT_BYTES = 512

const QUESTION_FAMILIES: readonly AdvisorQuestionFamily[] = ['usage', 'spend', 'tokens', 'cache', 'reasoning', 'models', 'providers', 'projects', 'sessions', 'pricing', 'quota', 'bench', 'evidence', 'action', 'unknown']
const EVIDENCE_DOMAINS: readonly AdvisorEvidenceDomain[] = ['usage-totals', 'usage-time-series', 'cost', 'tokens', 'cache', 'reasoning', 'models', 'providers', 'projects', 'sessions', 'pricing', 'freshness', 'provider-capacity', 'bench-history']
const PRESENTATION_INTENTS: readonly AdvisorPresentationIntent[] = ['text', 'metric-cards', 'line-chart', 'bar-chart', 'comparison-table', 'quota-card', 'bench-summary', 'warning', 'evidence-disclosure']
const TOOL_NAMES: readonly AdvisorToolName[] = ['get_spend_snapshot', 'get_model_efficiency', 'get_quota_snapshot', 'get_overview_snapshot', 'get_project_drivers', 'get_session_highlights', 'get_coverage_report']

export type AdvisorModelPlanningDraftV1 = AdvisorPlanningDraftV1 | (Omit<AdvisorPlanningDraftV1, 'turnKind'> & { turnKind: 'social' | 'boundary' })

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonObject(value: unknown): value is AdvisorJsonObject {
  if (!isRecord(value)) return false
  return Object.values(value).every(item => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true
    if (typeof item === 'number') return Number.isFinite(item)
    if (Array.isArray(item)) return item.length <= 16
    return isRecord(item)
  })
}

function boundedText(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || bytes(value) > MAX_TEXT_BYTES) return null
  const safe = sanitizeAdvisorDisplayText(value, MAX_TEXT_BYTES)
  return safe === '[redacted]' ? null : safe
}

function parseJsonText(value: string): unknown {
  if (bytes(value) > MAX_PLANNING_BYTES) return null
  const trimmed = value.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try { return JSON.parse(trimmed.slice(start, end + 1)) as unknown } catch { return null }
  }
}

function parseToolRequest(value: unknown): AdvisorToolRequestV1 | null {
  if (!isRecord(value) || typeof value.tool !== 'string' || !isJsonObject(value.arguments)) return null
  if (!(TOOL_NAMES as readonly string[]).includes(value.tool)) {
    // Keep the unknown identity in the parsed draft so validation can fail
    // closed instead of silently dropping a write or unknown tool request.
    return { tool: value.tool as AdvisorToolName, arguments: value.arguments }
  }
  return { tool: value.tool as AdvisorToolName, arguments: value.arguments }
}

export function parseAdvisorPlanningDraft(value: unknown): AdvisorModelPlanningDraftV1 | null {
  const parsed = typeof value === 'string' ? parseJsonText(value) : value
  if (!isRecord(parsed)) return null
  // A planning response is deliberately not a synthesis envelope. Treat
  // answer-like fields as malformed rather than allowing factual prose to
  // cross the planning boundary.
  if (['conclusion', 'answer', 'why', 'details', 'claims'].some(key => Object.prototype.hasOwnProperty.call(parsed, key))) return null
  if (parsed.contractVersion !== 'advisor-planning-draft-v1' || parsed.schemaVersion !== 1) return null
  if (parsed.turnKind !== 'investigate' && parsed.turnKind !== 'clarify' && parsed.turnKind !== 'social' && parsed.turnKind !== 'boundary') return null
  if (typeof parsed.questionFamily !== 'string' || !(QUESTION_FAMILIES as readonly string[]).includes(parsed.questionFamily)) return null
  if (!Array.isArray(parsed.requestedEvidenceDomains) || parsed.requestedEvidenceDomains.length > MAX_DOMAINS || parsed.requestedEvidenceDomains.some(domain => !(EVIDENCE_DOMAINS as readonly string[]).includes(domain))) return null
  if (!Array.isArray(parsed.toolRequests) || parsed.toolRequests.length > MAX_TOOL_REQUESTS) return null
  const toolRequests = parsed.toolRequests.map(parseToolRequest)
  if (toolRequests.some(request => request === null)) return null
  if (!PRESENTATION_INTENTS.includes(parsed.presentationIntent as AdvisorPresentationIntent)) return null
  if (typeof parsed.expertDetailRequested !== 'boolean') return null
  const clarification = parsed.clarification === null ? null : boundedText(parsed.clarification)
  if (parsed.clarification !== null && !clarification) return null
  return {
    contractVersion: 'advisor-planning-draft-v1',
    schemaVersion: 1,
    turnKind: parsed.turnKind,
    questionFamily: parsed.questionFamily as AdvisorQuestionFamily,
    requestedEvidenceDomains: [...parsed.requestedEvidenceDomains] as AdvisorEvidenceDomain[],
    toolRequests: toolRequests as AdvisorToolRequestV1[],
    presentationIntent: parsed.presentationIntent as AdvisorPresentationIntent,
    expertDetailRequested: parsed.expertDetailRequested,
    clarification,
  } as AdvisorModelPlanningDraftV1
}

function nativeToolName(call: Record<string, unknown>): unknown {
  if (typeof call.name === 'string') return call.name
  const fn = call.function
  return fn && typeof fn === 'object' && !Array.isArray(fn) ? (fn as Record<string, unknown>).name : undefined
}

function nativeToolArguments(call: Record<string, unknown>): unknown {
  if (call.arguments !== undefined) return call.arguments
  const fn = call.function
  return fn && typeof fn === 'object' && !Array.isArray(fn) ? (fn as Record<string, unknown>).arguments : undefined
}

/** Compatibility parser for provider-native tool calls in CALL A only. */
export function planningDraftFromNativeToolCalls(calls: readonly Record<string, unknown>[], guardPlan: AdvisorTurnPlanV1): AdvisorPlanningDraftV1 | null {
  if (!calls.length) return null
  const toolRequests: AdvisorToolRequestV1[] = []
  for (const call of calls.slice(0, MAX_TOOL_REQUESTS)) {
    const normalized = normalizeAdvisorToolCall(nativeToolName(call), nativeToolArguments(call))
    toolRequests.push({ tool: normalized.name, arguments: normalized.arguments })
  }
  const selectedTools = new Set(toolRequests.map(request => request.tool))
  const questionFamily: AdvisorQuestionFamily = selectedTools.size === 1 && selectedTools.has('get_quota_snapshot')
    ? 'quota'
    : selectedTools.size === 1 && selectedTools.has('get_model_efficiency')
      ? 'models'
      : selectedTools.size === 1 && selectedTools.has('get_coverage_report')
        ? 'evidence'
        : guardPlan.questionFamily
  return {
    contractVersion: 'advisor-planning-draft-v1',
    schemaVersion: 1,
    turnKind: 'investigate',
    questionFamily,
    requestedEvidenceDomains: [...guardPlan.requestedEvidenceDomains],
    toolRequests,
    presentationIntent: guardPlan.presentationIntent,
    expertDetailRequested: guardPlan.expertDetailRequested,
    clarification: null,
  }
}

function defaultToolForFamily(family: AdvisorQuestionFamily): AdvisorToolName | null {
  if (family === 'quota' || family === 'providers') return 'get_quota_snapshot'
  if (family === 'models') return 'get_model_efficiency'
  if (family === 'evidence') return 'get_coverage_report'
  if (family === 'bench') return null
  if (family === 'action') return null
  return 'get_spend_snapshot'
}

function definitionNames(definitions: readonly AdvisorToolDefinition[]): Set<string> {
  return new Set(definitions.map(definition => definition.function.name))
}

function requestMatchesScope(request: AdvisorToolRequestV1, scope: AdvisorScope): boolean {
  const args = request.arguments
  if (typeof args.model === 'string' && scope.model !== null && args.model !== scope.model) return false
  if (typeof args.provider === 'string' && scope.provider !== 'all' && args.provider !== scope.provider) return false
  return true
}

function guardFromFallbackPlan(plan: AdvisorTurnPlanV1, intent: AdvisorIntent = 'unknown', usedDefaultScope = false): AdvisorGuardPlanV1 {
  const boundaryIntent: AdvisorIntent = plan.turnKind === 'social' ? 'social' : plan.turnKind === 'clarify' ? 'clarification' : plan.authorization === 'proposal-required' ? 'action-proposal' : plan.turnKind === 'boundary' && intent === 'unsupported' ? 'unsupported' : 'unknown'
  return {
    contractVersion: 'advisor-guard-plan-v1',
    schemaVersion: 1,
    turnKind: plan.turnKind,
    scopeIntent: plan.scopeIntent,
    clarification: plan.clarification,
    authorization: plan.authorization,
    intent: boundaryIntent,
    usedDefaultScope,
  }
}

function asGuardPlan(plan: AdvisorGuardPlanV1 | AdvisorTurnPlanV1): AdvisorGuardPlanV1 {
  if (plan.contractVersion === 'advisor-guard-plan-v1') return plan
  return guardFromFallbackPlan(plan)
}

function planWithGuard(draft: AdvisorModelPlanningDraftV1, fallbackPlan: AdvisorTurnPlanV1, guard: AdvisorGuardPlanV1): AdvisorTurnPlanV1 {
  const conversationalTurn = draft.turnKind === 'social' || draft.turnKind === 'boundary'
  const requestedDomains = conversationalTurn
    ? []
    : draft.requestedEvidenceDomains.length ? draft.requestedEvidenceDomains : [...fallbackPlan.requestedEvidenceDomains]
  return {
    ...fallbackPlan,
    turnKind: conversationalTurn ? draft.turnKind : guard.turnKind === 'investigate' ? 'investigate' : fallbackPlan.turnKind,
    questionFamily: conversationalTurn ? 'unknown' : draft.questionFamily,
    requestedEvidenceDomains: requestedDomains,
    presentationIntent: conversationalTurn ? 'text' : draft.presentationIntent,
    expertDetailRequested: conversationalTurn ? false : draft.expertDetailRequested,
    clarification: conversationalTurn ? null : guard.clarification,
    authorization: guard.authorization,
    scopeIntent: guard.scopeIntent,
  }
}

export type AdvisorPlanningValidation = { plan: AdvisorTurnPlanV1; toolRequests: AdvisorToolRequestV1[]; modelAssisted: boolean }

export function runtimeGuardPlan(input: AdvisorRuntimeInput): { fallbackPlan: AdvisorTurnPlanV1; guard: AdvisorGuardPlanV1 } {
  if (input.plan) return { fallbackPlan: input.plan, guard: input.guard ?? guardFromFallbackPlan(input.plan) }
  if (input.evidence.plan) return { fallbackPlan: input.evidence.plan, guard: input.guard ?? guardFromFallbackPlan(input.evidence.plan) }
  const resolved = createAdvisorTurnPlanV1(input.question, input.evidence.scope)
  return { fallbackPlan: resolved, guard: input.guard ?? guardFromFallbackPlan(resolved, resolved.intent, resolved.usedDefaultScope) }
}

export function validateAdvisorPlanningDraft(
  draft: AdvisorModelPlanningDraftV1,
  guardPlan: AdvisorGuardPlanV1 | AdvisorTurnPlanV1,
  scope: AdvisorScope,
  definitions: readonly AdvisorToolDefinition[],
): AdvisorPlanningValidation | null {
  const guard = asGuardPlan(guardPlan)
  const fallbackPlan = guardPlan.contractVersion === 'advisor-turn-plan-v1' ? guardPlan : createAdvisorTurnPlanV1('', scope)
  // Deterministic guards still own action, explicit unsupported, and
  // clarification boundaries. A model may only narrow an otherwise-safe unknown
  // investigation into social/boundary, never widen authorization or scope.
  if (guard.authorization !== 'read-only' || guard.turnKind !== 'investigate') return null

  if (draft.turnKind === 'social' || draft.turnKind === 'boundary') {
    if (draft.questionFamily !== 'unknown' || draft.requestedEvidenceDomains.length !== 0 || draft.toolRequests.length !== 0 || draft.clarification !== null || draft.presentationIntent !== 'text') return null
    return { plan: planWithGuard(draft, fallbackPlan, guard), toolRequests: [], modelAssisted: true }
  }

  if (draft.turnKind !== 'investigate' || draft.questionFamily === 'action' || draft.clarification !== null) return null
  const names = definitionNames(definitions)
  const requests: AdvisorToolRequestV1[] = []
  for (const request of draft.toolRequests) {
    if (!names.has(request.tool) || !requestMatchesScope(request, scope)) return null
    const normalized = normalizeAdvisorToolCall(request.tool, request.arguments)
    requests.push({ tool: normalized.name, arguments: normalized.arguments })
  }
  // A normal model plan must explicitly select at least one bounded read
  // tool. The fallback may choose a deterministic tool, but the guard never
  // injects one into an otherwise valid model plan.
  if (!requests.length) return null
  return { plan: planWithGuard(draft, fallbackPlan, guard), toolRequests: requests.slice(0, MAX_TOOL_REQUESTS), modelAssisted: true }
}

export function deterministicPlanningFallback(
  guardPlan: AdvisorTurnPlanV1,
  definitions: readonly AdvisorToolDefinition[],
): AdvisorPlanningValidation {
  const required = defaultToolForFamily(guardPlan.questionFamily)
  const names = definitionNames(definitions)
  const toolRequests = required && names.has(required) ? [{ tool: required, arguments: {} }] : []
  return { plan: guardPlan, toolRequests, modelAssisted: false }
}
