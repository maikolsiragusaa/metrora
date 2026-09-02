import { assertStrictBoundedAdvisorToolContent } from './contract'
import type { AdvisorQuestionPlan } from './comprehension'
import { deterministicPlanningFallback, explicitAdvisorPeriodHints } from './planner'
import { isAdvisorNaturalNarrativeSupportedAcrossEvidence } from './synthesis'
import type {
  AdvisorDataSource,
  AdvisorAnswer,
  AdvisorEvidence,
  AdvisorEvidenceRef,
  AdvisorScope,
  AdvisorToolName,
  AdvisorToolEvent,
  AdvisorToolDefinition,
  AdvisorToolExecution,
  AdvisorToolRequestV1,
} from './types'
import { createAdvisorToolRegistry, type AdvisorOverviewSnapshot, type AdvisorToolRegistry } from './tools'

export type RequiredAdvisorReadStatus = 'usable' | 'partial' | 'unavailable'

export type RequiredAdvisorRead = {
  request: AdvisorToolRequestV1
  status: 'completed' | 'unavailable' | 'failed'
  execution: AdvisorToolExecution | null
  evidence: AdvisorEvidence
}

export type RequiredAdvisorReadsResult = {
  requests: readonly AdvisorToolRequestV1[]
  reads: readonly RequiredAdvisorRead[]
  evidence: readonly AdvisorEvidence[]
  status: RequiredAdvisorReadStatus
}

const FACTUAL_INTENTS = new Set(['spend-change', 'model-efficiency', 'quota-capacity', 'bench-result'])

export function advisorQuestionRequiresCanonicalReads(plan: AdvisorQuestionPlan): boolean {
  return plan.plan.turnKind === 'investigate' && FACTUAL_INTENTS.has(plan.intent)
}

/**
 * A model closeout must contain both a canonical reference and a structural
 */
export function advisorAnswerUsesCanonicalEvidence(answer: AdvisorAnswer, evidence: AdvisorEvidence): boolean {
  const canonicalIds = new Set(evidence.refs.map(ref => ref.id))
  if (!answer.conclusion.trim() || !answer.evidence.some(ref => canonicalIds.has(ref.id))) return false
  // Reuse the same semantic/numeric grounding boundary as ordinary Chat
  // closeouts. This accepts paraphrases while rejecting a response that only
  // attaches a real reference or repeats an unsupported number.
  if (!isAdvisorNaturalNarrativeSupportedAcrossEvidence(answer.conclusion, [evidence])) return false
  const normalized = answer.conclusion.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase()
  const factualAnchor = evidence.intent === 'spend-change'
    ? /\b(?:spend|spent|cost|expense|measured|total|lifetime|usage|calls?|sessions?|projects?|models?|providers?|spesa|speso|costo|misurat|totale|utilizz|chiamat|sessioni|progett|modell|fornitor)\b/u
    : evidence.intent === 'model-efficiency'
      ? /\b(?:model|models|efficien|cost|call|pricing|modello|modelli|costo|chiamat|prezz)\b/u
      : evidence.intent === 'quota-capacity'
        ? /\b(?:quota|capacity|remaining|reset|limit|credit|disponibil|rimane|resta|limite|credito)\b/u
        : evidence.intent === 'bench-result'
          ? /\b(?:bench|benchmark|score|result|task|test|risultat|punteggi|prova)\b/u
          : /\b(?:metrora|canonical|evidence|evidenza|verified|verificat)\b/u
  return factualAnchor.test(normalized)
}

function boundedUnavailableEvidence(question: string, scope: AdvisorScope, plan: AdvisorQuestionPlan, request: AdvisorToolRequestV1, detail: string): AdvisorEvidence {
  return {
    intent: plan.intent,
    question,
    scope,
    refs: [] as AdvisorEvidenceRef[],
    coverage: {
      level: 'unavailable',
      state: 'UNAVAILABLE',
      label: 'Evidence unavailable',
      detail,
    },
    assumptions: [],
    unknown: ['The required canonical Metrora read ' + request.tool + ' did not return usable evidence.'],
    nextInvestigations: ['Retry the bounded Metrora read when the source is available.'],
    understanding: plan.understanding,
    plan: plan.plan,
  }
}

function evidenceUsable(evidence: AdvisorEvidence): boolean {
  return evidence.coverage.level !== 'unavailable' && evidence.refs.length > 0
}

function readStatus(reads: readonly RequiredAdvisorRead[]): RequiredAdvisorReadStatus {
  const usable = reads.filter(read => evidenceUsable(read.evidence)).length
  if (!usable) return 'unavailable'
  if (usable < reads.length) return 'partial'
  return 'usable'
}

function requestKey(request: AdvisorToolRequestV1): string {
  return request.tool + '\u0000' + JSON.stringify(request.arguments)
}

export function requiredAdvisorToolRequests(
  plan: AdvisorQuestionPlan,
  definitions: readonly AdvisorToolDefinition[],
  question: string,
): AdvisorToolRequestV1[] {
  if (!advisorQuestionRequiresCanonicalReads(plan)) return []
  const planned = deterministicPlanningFallback(plan.plan, definitions, question).toolRequests
  const mandatoryTool: AdvisorToolName = plan.intent === 'model-efficiency'
    ? 'get_model_efficiency'
    : plan.intent === 'quota-capacity'
      ? 'get_quota_snapshot'
      : plan.intent === 'bench-result'
        ? 'get_bench_evidence'
        : 'get_spend_snapshot'
  // The first family tool is the mandatory evidence domain. Driver and
  // comparison reads remain model-selectable bounded follow-ups; making them
  // mandatory would turn a concise factual question into an unsolicited read
  // fan-out.
  const primary = planned.filter(request => request.tool === mandatoryTool)
  if (primary.length) return primary
  // Preserve the mandatory domain even when a bounded caller omitted that
  // Tool from its allowlist. The executor will report it as unavailable;
  // silently dropping the request would let a factual worker look successful
  // merely because the required Tool was absent.
  const period = explicitAdvisorPeriodHints(question)[0]
  return [{ tool: mandatoryTool, arguments: period ? { period } : {} }]
}

export function advisorToolRequestKey(request: AdvisorToolRequestV1): string {
  return requestKey(request)
}

export async function executeRequiredAdvisorReads(options: {
  source: AdvisorDataSource
  scope: AdvisorScope
  question: string
  plan: AdvisorQuestionPlan
  suppliedOverview?: AdvisorOverviewSnapshot | import('../lib/types').MenubarPayload | null
  allowedToolNames?: ReadonlySet<string>
  definitions?: readonly AdvisorToolDefinition[]
  limits?: { maxCalls?: number }
  signal?: AbortSignal
  onToolEvent?: (event: AdvisorToolEvent) => void
  registry?: AdvisorToolRegistry
  allowedPeriods?: readonly import('./types').AdvisorPeriodFilter[]
}): Promise<RequiredAdvisorReadsResult> {
  const allowedPeriods = options.allowedPeriods ?? (options.scope.range
    ? [options.scope.period]
    : Array.from(new Set([options.scope.period, ...explicitAdvisorPeriodHints(options.question)])))
  const registry = options.registry ?? createAdvisorToolRegistry(options.source, options.scope, options.suppliedOverview ?? null, { allowedPeriods })
  const definitions = options.definitions ?? registry.definitions
  const planned = requiredAdvisorToolRequests(options.plan, definitions, options.question)
  const maxCalls = Math.max(0, Math.min(options.limits?.maxCalls ?? 4, 4))
  const requests = planned.slice(0, maxCalls)
  const reads: RequiredAdvisorRead[] = []

  for (const request of requests) {
    if (options.signal?.aborted) throw new DOMException('Advisor investigation cancelled', 'AbortError')
    options.onToolEvent?.({ name: request.tool, status: 'queued' })
    options.onToolEvent?.({ name: request.tool, status: 'started' })
    const allowed = !options.allowedToolNames || options.allowedToolNames.has(request.tool)
    const available = allowed && definitions.some(definition => definition.function.name === request.tool)
    if (!available) {
      const evidence = boundedUnavailableEvidence(options.question, options.scope, options.plan, request, 'The required canonical Tool is not available in this bounded context.')
      reads.push({ request, status: 'unavailable', execution: null, evidence })
      options.onToolEvent?.({ name: request.tool, status: 'unavailable' })
      continue
    }
    try {
      const execution = await registry.execute(request.tool, request.arguments, options.signal)
      assertStrictBoundedAdvisorToolContent(execution.content)
      const unavailable = execution.envelope?.unavailable === true || execution.evidence.coverage.level === 'unavailable'
      const evidence = { ...execution.evidence, ...(unavailable ? { refs: [] as AdvisorEvidenceRef[] } : {}), understanding: options.plan.understanding, plan: options.plan.plan }
      reads.push({ request, status: unavailable ? 'unavailable' : 'completed', execution: unavailable ? { ...execution, evidence } : execution, evidence })
      options.onToolEvent?.({ name: request.tool, status: unavailable ? 'unavailable' : 'completed' })
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && /abort|cancel/i.test(error.message))) throw error
      const detail = error instanceof Error ? error.message : 'The required canonical Tool failed.'
      const evidence = boundedUnavailableEvidence(options.question, options.scope, options.plan, request, detail)
      reads.push({ request, status: 'failed', execution: null, evidence })
      options.onToolEvent?.({ name: request.tool, status: 'failed' })
    }
  }

  return { requests, reads, evidence: reads.map(read => read.evidence), status: readStatus(reads) }
}
