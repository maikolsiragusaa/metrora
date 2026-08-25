import { normalizeAdvisorToolCall } from './contract'
import { sanitizeAdvisorDisplayText } from './privacy'
import { createAdvisorTurnPlanV1 } from './turn-plan'
import type {
  AdvisorEvidenceDomain,
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

export function parseAdvisorPlanningDraft(value: unknown): AdvisorPlanningDraftV1 | null {
  const parsed = typeof value === 'string' ? parseJsonText(value) : value
  if (!isRecord(parsed)) return null
  // A planning response is deliberately not a synthesis envelope. Treat
  // answer-like fields as malformed rather than allowing factual prose to
  // cross the planning boundary.
  if (['conclusion', 'answer', 'why', 'details', 'claims'].some(key => Object.prototype.hasOwnProperty.call(parsed, key))) return null
  if (parsed.contractVersion !== 'advisor-planning-draft-v1' || parsed.schemaVersion !== 1) return null
  if (parsed.turnKind !== 'investigate' && parsed.turnKind !== 'clarify') return null
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
  }
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
  return {
    contractVersion: 'advisor-planning-draft-v1',
    schemaVersion: 1,
    turnKind: 'investigate',
    questionFamily: guardPlan.questionFamily,
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

function requiredToolForGuard(plan: AdvisorTurnPlanV1, guardIntent: AdvisorIntent | undefined): AdvisorToolName | null {
  if (guardIntent === 'spend-change' || plan.questionFamily === 'spend' || plan.questionFamily === 'usage' || plan.questionFamily === 'projects' || plan.questionFamily === 'sessions') return 'get_spend_snapshot'
  if (guardIntent === 'model-efficiency' || plan.questionFamily === 'models') return 'get_model_efficiency'
  if (guardIntent === 'quota-capacity' || plan.questionFamily === 'quota' || plan.questionFamily === 'providers') return 'get_quota_snapshot'
  if (plan.questionFamily === 'evidence') return 'get_coverage_report'
  return null
}

function planWithGuard(draft: AdvisorPlanningDraftV1, guardPlan: AdvisorTurnPlanV1): AdvisorTurnPlanV1 {
  const fixedFamily = guardPlan.questionFamily !== 'unknown' ? guardPlan.questionFamily : draft.questionFamily === 'action' ? 'unknown' : draft.questionFamily
  const requestedDomains = draft.requestedEvidenceDomains.length ? draft.requestedEvidenceDomains : [...guardPlan.requestedEvidenceDomains]
  return {
    ...guardPlan,
    turnKind: guardPlan.turnKind,
    questionFamily: fixedFamily,
    requestedEvidenceDomains: requestedDomains,
    presentationIntent: draft.presentationIntent,
    expertDetailRequested: guardPlan.expertDetailRequested || draft.expertDetailRequested,
    clarification: guardPlan.clarification,
    authorization: guardPlan.authorization,
    scopeIntent: guardPlan.scopeIntent,
  }
}

export type AdvisorPlanningValidation = { plan: AdvisorTurnPlanV1; toolRequests: AdvisorToolRequestV1[]; modelAssisted: boolean }

export function runtimeGuardPlan(input: AdvisorRuntimeInput): { plan: AdvisorTurnPlanV1; intent: AdvisorIntent } {
  if (input.plan) return { plan: input.plan, intent: input.guardIntent ?? input.evidence.intent }
  if (input.evidence.plan) return { plan: input.evidence.plan, intent: input.guardIntent ?? input.evidence.intent }
  const resolved = createAdvisorTurnPlanV1(input.question, input.evidence.scope)
  return { plan: resolved, intent: input.guardIntent ?? (input.evidence.intent !== 'unknown' ? input.evidence.intent : resolved.intent) }
}

export function validateAdvisorPlanningDraft(
  draft: AdvisorPlanningDraftV1,
  guardPlan: AdvisorTurnPlanV1,
  scope: AdvisorScope,
  definitions: readonly AdvisorToolDefinition[],
  guardIntent?: AdvisorIntent,
): AdvisorPlanningValidation | null {
  // The deterministic guard owns all action and clarification boundaries.
  if (guardPlan.authorization !== 'read-only' || guardPlan.turnKind !== 'investigate') return null
  if (draft.turnKind !== 'investigate' || draft.questionFamily === 'action' || draft.clarification !== null) return null
  const names = definitionNames(definitions)
  const requests: AdvisorToolRequestV1[] = []
  for (const request of draft.toolRequests) {
    if (!names.has(request.tool) || !requestMatchesScope(request, scope)) return null
    const normalized = normalizeAdvisorToolCall(request.tool, request.arguments)
    requests.push({ tool: normalized.name, arguments: normalized.arguments })
  }
  const required = requiredToolForGuard(guardPlan, guardIntent)
  if (required && names.has(required) && !requests.some(request => request.tool === required)) {
    requests.push({ tool: required, arguments: {} })
  }
  if (!requests.length && required && names.has(required)) requests.push({ tool: required, arguments: {} })
  return { plan: planWithGuard(draft, guardPlan), toolRequests: requests.slice(0, MAX_TOOL_REQUESTS), modelAssisted: true }
}

export function deterministicPlanningFallback(
  guardPlan: AdvisorTurnPlanV1,
  definitions: readonly AdvisorToolDefinition[],
  guardIntent?: AdvisorIntent,
): AdvisorPlanningValidation {
  const required = requiredToolForGuard(guardPlan, guardIntent) ?? defaultToolForFamily(guardPlan.questionFamily)
  const names = definitionNames(definitions)
  const toolRequests = required && names.has(required) ? [{ tool: required, arguments: {} }] : []
  return { plan: guardPlan, toolRequests, modelAssisted: false }
}
