import { buildUnknownEvidence } from './evidence'
import { buildActionProposalEvidence, buildBenchEvidence, buildClarificationEvidence, buildConversationEvidence, buildSocialEvidence, buildUnsupportedEvidence } from './special-evidence'
import { createAdvisorModelGuardV1, resolveAdvisorQuestion } from './comprehension'
import { explicitAdvisorModelHint, explicitAdvisorPeriodHints } from './planner'
import { createAdvisorToolRegistry } from './tools'
import { DeterministicAdvisorRuntime } from './runtime'
import { advisorAnswerUsesCanonicalEvidence, advisorQuestionRequiresCanonicalReads, executeRequiredAdvisorReads, advisorToolRequestKey } from './required-reads'
import { mergeEvidence } from './merge-evidence'
import type { MenubarPayload } from '../lib/types'
import type { AdvisorAnswer, AdvisorBenchEvidence, AdvisorConversationTurn, AdvisorDataSource, AdvisorEvidence, AdvisorIntent, AdvisorModelRuntime, AdvisorPeriodFilter, AdvisorScope, AdvisorUiContextV1, AdvisorToolEvent, AdvisorToolExecution } from './types'

export class AdvisorCancelledError extends Error {
  constructor() { super('Advisor investigation cancelled'); this.name = 'AdvisorCancelledError' }
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AdvisorCancelledError()
}
function rethrowCancellation(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted || (error instanceof Error && (error.name === 'AbortError' || /cancel|abort/i.test(error.message)))) throw error
}
export type AdvisorKernel = {
  investigate(input: { question: string; scope: AdvisorScope; overview?: MenubarPayload | null; conversation?: AdvisorConversationTurn[]; uiContext?: AdvisorUiContextV1; signal?: AbortSignal; onConformance?: () => void; onToolEvent?: (event: AdvisorToolEvent) => void; onDelta?: (text: string) => void }): Promise<AdvisorAnswer>
}
const unavailableBench: AdvisorBenchEvidence = { state: 'UNAVAILABLE', runs: [], latest: null, comparison: null }

async function deterministicEvidenceForIntent(source: AdvisorDataSource, intent: AdvisorIntent, question: string, scope: AdvisorScope, suppliedOverview: MenubarPayload | null, signal?: AbortSignal, allowedPeriods: readonly AdvisorPeriodFilter[] = []): Promise<AdvisorEvidence> {
  if (intent === 'social') return buildSocialEvidence(question, scope)
  if (intent === 'action-proposal') return buildActionProposalEvidence(question, scope, 'Harness is proposal-only for this conversation; execution requires a separately authorized action surface.')
  if (intent === 'clarification') return buildClarificationEvidence(question, scope, 'Choose the intended evidence source before reading canonical data.')
  if (intent === 'unsupported') return buildUnsupportedEvidence(question, scope, 'This request is outside the canonical Metrora evidence contract.')
  if (intent === 'unknown') return buildUnknownEvidence(question, scope)
  if (intent === 'bench-result') {
    let bench = unavailableBench
    if (source.getBenchEvidence) {
      try { bench = await source.getBenchEvidence(scope, signal) } catch (error) { rethrowCancellation(error, signal) }
    }
    throwIfAborted(signal)
    return buildBenchEvidence(question, scope, bench)
  }
  if (intent === 'spend-change' || intent === 'model-efficiency' || intent === 'quota-capacity') {
    const tool = intent === 'spend-change' ? 'get_spend_snapshot' : intent === 'model-efficiency' ? 'get_model_efficiency' : 'get_quota_snapshot'
    const registry = createAdvisorToolRegistry(source, scope, suppliedOverview, { allowedPeriods })
    const model = explicitAdvisorModelHint(question)
    const result = await registry.execute(tool, model && (intent === 'spend-change' || intent === 'model-efficiency') ? { model } : {}, signal)
    return result.evidence as unknown as AdvisorEvidence
  }
  return buildUnknownEvidence(question, scope)
}

function attachPlan(evidence: AdvisorEvidence, plan: ReturnType<typeof resolveAdvisorQuestion>): AdvisorEvidence {
  return {
    ...evidence,
    understanding: plan.understanding,
    plan: plan.plan,
    assumptions: plan.usedDefaultScope
      ? ['I used the current scope selected in Metrora. Use the scope controls above to change it.', ...evidence.assumptions]
      : evidence.assumptions,
  }
}

function evidenceRequired(plan: ReturnType<typeof resolveAdvisorQuestion>): boolean {
  return advisorQuestionRequiresCanonicalReads(plan)
}

function hasCanonicalAnswerReference(answer: AdvisorAnswer, evidence: AdvisorEvidence): boolean {
  return advisorAnswerUsesCanonicalEvidence(answer, evidence)
}

async function normalizeFactualModelAnswer(
  answer: AdvisorAnswer,
  evidence: AdvisorEvidence,
  question: string,
  plan: ReturnType<typeof resolveAdvisorQuestion>,
  conversation: AdvisorConversationTurn[],
  uiContext: AdvisorUiContextV1 | undefined,
  signal: AbortSignal | undefined,
): Promise<AdvisorAnswer> {
  const authoritative = attachPlan(evidence, plan)
  if (hasCanonicalAnswerReference(answer, authoritative)) {
    return {
      ...answer,
      evidence: authoritative.refs,
      coverage: authoritative.coverage,
      assumptions: authoritative.assumptions,
      unknown: authoritative.unknown,
      nextInvestigations: authoritative.nextInvestigations,
      understanding: authoritative.understanding,
      plan: authoritative.plan,
    }
  }
  const fallback = await new DeterministicAdvisorRuntime().generate({
    question,
    evidence: authoritative,
    conversation,
    uiContext,
    plan: plan.plan,
    fallbackIntent: plan.intent,
    guard: plan.guard,
  }, signal)
  return {
    ...fallback,
    materialLimits: [...(fallback.materialLimits ?? []), 'The model response was not grounded in the required canonical Metrora evidence.'],
  }
}

export function createAdvisorKernel(source: AdvisorDataSource, runtime: AdvisorModelRuntime): AdvisorKernel {
  return {
    async investigate({ question, scope, overview: suppliedOverview = null, conversation = [], uiContext, signal, onConformance, onToolEvent, onDelta }) {
      throwIfAborted(signal)
      const plan = resolveAdvisorQuestion(question, scope, conversation)
      const allowedPeriods: AdvisorPeriodFilter[] = scope.range
        ? [scope.period]
        : Array.from(new Set<AdvisorPeriodFilter>([scope.period, ...explicitAdvisorPeriodHints(question)]))
      const modelReady = runtime.mode !== 'deterministic-local' && runtime.availability !== 'unavailable' && runtime.mode !== 'unsupported'
      const modelEvidence = plan.intent === 'action-proposal'
        ? buildActionProposalEvidence(question, scope, plan.understanding.boundary ?? 'Harness is proposal-only for this conversation.')
        : buildConversationEvidence(question, scope)
      const toolRegistry = createAdvisorToolRegistry(source, scope, suppliedOverview, { allowedPeriods })
      const requiredReads = advisorQuestionRequiresCanonicalReads(plan)
        ? await executeRequiredAdvisorReads({
            source,
            scope,
            question,
            plan,
            suppliedOverview,
            registry: toolRegistry,
            definitions: toolRegistry.definitions,
            onToolEvent,
            signal,
          })
        : null
      const canonicalEvidence = requiredReads?.evidence.length
        ? mergeEvidence([...requiredReads.evidence], requiredReads.evidence[0]!)
        : null
      const modelInputEvidence = attachPlan(canonicalEvidence ?? modelEvidence, plan)
      if (!modelReady) {
        const evidence = canonicalEvidence ?? await deterministicEvidenceForIntent(source, plan.intent, question, scope, suppliedOverview, signal, allowedPeriods)
        const inputEvidence = attachPlan(evidence, plan)
        return new DeterministicAdvisorRuntime().generate({ question, evidence: inputEvidence, conversation, uiContext, plan: plan.plan, fallbackIntent: plan.intent, guard: plan.guard, allowedPeriods }, signal)
      }
      const modelGuard = createAdvisorModelGuardV1(plan)
      const baselineExecutions = new Map<string, AdvisorToolExecution>()
      for (const read of requiredReads?.reads ?? []) {
        if (read.execution) baselineExecutions.set(advisorToolRequestKey(read.request), read.execution)
      }
      const modelEvidenceItems: AdvisorEvidence[] = [...(requiredReads?.evidence ?? [])]
      const executeTool = async (name: string, args: Record<string, unknown>, toolSignal?: AbortSignal): Promise<AdvisorToolExecution> => {
        const cached = baselineExecutions.get(name + '\u0000' + JSON.stringify(args))
        if (cached) return cached
        const execution = await toolRegistry.execute(name, args, toolSignal ?? signal)
        const unavailable = execution.envelope?.unavailable === true || execution.evidence.coverage.level === 'unavailable'
        const evidence = unavailable ? { ...execution.evidence, refs: [] } : execution.evidence
        modelEvidenceItems.push(evidence)
        return unavailable ? { ...execution, evidence } : execution
      }
      try {
        const answer = await runtime.generate({
          question,
          evidence: modelInputEvidence,
          requiredEvidence: requiredReads?.evidence,
          requiredToolRequests: requiredReads?.requests,
          conversation,
          uiContext,
          plan: plan.plan,
          fallbackIntent: plan.intent,
          guard: modelGuard,
          allowedPeriods,
          tools: toolRegistry.definitions,
          toolContract: toolRegistry.contract,
          executeTool,
          onConformance,
          onToolEvent,
          onDelta,
        }, signal)
        if (!evidenceRequired(plan)) return answer
        const authoritative = modelEvidenceItems.length
          ? mergeEvidence(modelEvidenceItems, modelEvidenceItems[0]!)
          : canonicalEvidence ?? modelInputEvidence
        return normalizeFactualModelAnswer(answer, authoritative, question, plan, conversation, uiContext, signal)
      } catch (error) {
        rethrowCancellation(error, signal)
        const fallbackBase = plan.intent === 'action-proposal'
          ? buildActionProposalEvidence(question, scope, plan.understanding.boundary ?? 'Harness is proposal-only for this conversation.')
          : canonicalEvidence ?? await deterministicEvidenceForIntent(source, plan.intent, question, scope, suppliedOverview, signal, allowedPeriods)
        const fallbackEvidence = attachPlan(fallbackBase, plan)
        const fallback = await new DeterministicAdvisorRuntime().generate({ question, evidence: fallbackEvidence, conversation, uiContext, plan: plan.plan, fallbackIntent: plan.intent, guard: plan.guard, allowedPeriods }, signal)
        return {
          ...fallback,
          materialLimits: [...(fallback.materialLimits ?? []), 'The explanatory model was unavailable, so this answer uses Metrora deterministic evidence.'],
        }
      }
    },
  }
}
