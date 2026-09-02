import { buildUnknownEvidence } from './evidence'
import { buildActionProposalEvidence, buildBenchEvidence, buildClarificationEvidence, buildConversationEvidence, buildSocialEvidence, buildUnsupportedEvidence } from './special-evidence'
import { createAdvisorModelGuardV1, resolveAdvisorQuestion } from './comprehension'
import { deterministicPlanningFallback, explicitAdvisorPeriodHints } from './planner'
import { createAdvisorToolRegistry, type AdvisorOverviewSnapshot } from './tools'
import { DeterministicAdvisorRuntime } from './runtime'
import { advisorQuestionRequiresCanonicalReads, requiredAdvisorToolRequests } from './required-reads'
import { mergeEvidence } from './merge-evidence'
import type { MenubarPayload } from '../lib/types'
import type { AdvisorAnswer, AdvisorBenchEvidence, AdvisorConversationTurn, AdvisorDataSource, AdvisorEvidence, AdvisorIntent, AdvisorModelRuntime, AdvisorPeriodFilter, AdvisorRuntimeInput, AdvisorScope, AdvisorUiContextV1, AdvisorToolEvent, AdvisorToolExecution } from './types'

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
  investigate(input: { question: string; scope: AdvisorScope; overview?: AdvisorOverviewSnapshot | MenubarPayload | null; conversation?: AdvisorConversationTurn[]; uiContext?: AdvisorUiContextV1; signal?: AbortSignal; onConformance?: () => void; onToolEvent?: (event: AdvisorToolEvent) => void; onAgentEvent?: AdvisorRuntimeInput['onAgentEvent']; onDelta?: (text: string) => void }): Promise<AdvisorAnswer>
}

const unavailableBench: AdvisorBenchEvidence = { state: 'UNAVAILABLE', runs: [], latest: null, comparison: null }

async function deterministicEvidenceItemsForIntent(source: AdvisorDataSource, intent: AdvisorIntent, question: string, scope: AdvisorScope, suppliedOverview: AdvisorOverviewSnapshot | MenubarPayload | null, signal?: AbortSignal, allowedPeriods: readonly AdvisorPeriodFilter[] = []): Promise<AdvisorEvidence[]> {
  if (intent === 'social') return [buildSocialEvidence(question, scope)]
  if (intent === 'action-proposal') return [buildActionProposalEvidence(question, scope, 'Harness is proposal-only for this conversation; execution requires a separately authorized action surface.')]
  if (intent === 'clarification') return [buildClarificationEvidence(question, scope, 'Choose the intended evidence source before reading canonical data.')]
  if (intent === 'unsupported') return [buildUnsupportedEvidence(question, scope, 'This request is outside the canonical Metrora evidence contract.')]
  if (intent === 'unknown') return [buildUnknownEvidence(question, scope)]
  if (intent === 'bench-result') {
    let bench = unavailableBench
    if (source.getBenchEvidence) {
      try { bench = await source.getBenchEvidence(scope, signal) } catch (error) { rethrowCancellation(error, signal) }
    }
    throwIfAborted(signal)
    return [buildBenchEvidence(question, scope, bench)]
  }
  if (intent === 'spend-change' || intent === 'model-efficiency' || intent === 'quota-capacity') {
    const registry = createAdvisorToolRegistry(source, scope, suppliedOverview, { allowedPeriods })
    const plan = resolveAdvisorQuestion(question, scope)
    const requests = explicitAdvisorPeriodHints(question).length > 1
      ? deterministicPlanningFallback(plan.plan, registry.definitions, question).toolRequests
      : requiredAdvisorToolRequests(plan, registry.definitions, question)
    const evidenceItems: AdvisorEvidence[] = []
    for (const request of requests) {
      const result = await registry.execute(request.tool, request.arguments, signal)
      const unavailable = result.envelope?.unavailable === true || result.evidence.coverage.level === 'unavailable'
      evidenceItems.push(unavailable ? { ...result.evidence, refs: [] } : result.evidence)
    }
    return evidenceItems
  }
  return [buildUnknownEvidence(question, scope)]
}

async function deterministicAnswerForIntent(options: {
  source: AdvisorDataSource
  intent: AdvisorIntent
  question: string
  scope: AdvisorScope
  suppliedOverview: AdvisorOverviewSnapshot | MenubarPayload | null
  conversation: AdvisorConversationTurn[]
  uiContext?: AdvisorUiContextV1
  plan: ReturnType<typeof resolveAdvisorQuestion>
  signal?: AbortSignal
  allowedPeriods: readonly AdvisorPeriodFilter[]
}): Promise<AdvisorAnswer> {
  const items = (await deterministicEvidenceItemsForIntent(options.source, options.intent, options.question, options.scope, options.suppliedOverview, options.signal, options.allowedPeriods)).map(item => attachPlan(item, options.plan))
  const runtime = new DeterministicAdvisorRuntime()
  const answers = await Promise.all(items.map(evidence => runtime.generate({
    question: options.question,
    evidence,
    conversation: options.conversation,
    uiContext: options.uiContext,
    plan: options.plan.plan,
    fallbackIntent: options.intent,
    guard: options.plan.guard,
    allowedPeriods: options.allowedPeriods,
  }, options.signal)))
  if (answers.length <= 1) return answers[0]!
  const authoritative = mergeEvidence(items, items[0]!)
  const unique = (values: readonly (string | undefined)[]) => Array.from(new Set(values.filter((value): value is string => Boolean(value))))
  return {
    ...answers[0],
    conclusion: unique(answers.map(answer => answer.conclusion)).join(' '),
    why: unique(answers.flatMap(answer => answer.why)),
    details: unique(answers.flatMap(answer => answer.details)),
    evidence: authoritative.refs,
    coverage: authoritative.coverage,
    assumptions: authoritative.assumptions,
    unknown: authoritative.unknown,
    nextInvestigations: authoritative.nextInvestigations,
    understanding: authoritative.understanding,
    plan: authoritative.plan,
  }
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

function attachAuthoritativeEvidence(answer: AdvisorAnswer, evidence: AdvisorEvidence, plan: ReturnType<typeof resolveAdvisorQuestion>): AdvisorAnswer {
  const authoritative = attachPlan(evidence, plan)
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

function hasUsableEvidence(items: readonly AdvisorEvidence[]): boolean {
  return items.some(item => item.coverage.level !== 'unavailable' && item.refs.length > 0)
}

export function createAdvisorKernel(source: AdvisorDataSource, runtime: AdvisorModelRuntime): AdvisorKernel {
  return {
    async investigate({ question, scope, overview: suppliedOverview = null, conversation = [], uiContext, signal, onConformance, onToolEvent, onAgentEvent, onDelta }) {
      throwIfAborted(signal)
      const plan = resolveAdvisorQuestion(question, scope, conversation)
      if (plan.plan.scopeConflict) {
        const clarification = attachPlan(buildClarificationEvidence(question, scope, plan.plan.scopeConflict.message), plan)
        return new DeterministicAdvisorRuntime().generate({
          question,
          evidence: clarification,
          conversation,
          uiContext,
          plan: plan.plan,
          fallbackIntent: 'clarification',
          guard: plan.guard,
        }, signal)
      }
      const allowedPeriods: AdvisorPeriodFilter[] = scope.range
        ? [scope.period]
        : Array.from(new Set<AdvisorPeriodFilter>([scope.period, ...explicitAdvisorPeriodHints(question)]))
      const modelReady = runtime.mode !== 'deterministic-local' && runtime.availability !== 'unavailable' && runtime.mode !== 'unsupported'
      const modelEvidence = plan.intent === 'action-proposal'
        ? buildActionProposalEvidence(question, scope, plan.understanding.boundary ?? 'Harness is proposal-only for this conversation.')
        : buildConversationEvidence(question, scope)
      const toolRegistry = createAdvisorToolRegistry(source, scope, suppliedOverview, { allowedPeriods })
      if (!modelReady) {
        return deterministicAnswerForIntent({ source, intent: plan.intent, question, scope, suppliedOverview, conversation, uiContext, plan, signal, allowedPeriods })
      }
      const modelGuard = createAdvisorModelGuardV1(plan)
      const requiredToolRequests = advisorQuestionRequiresCanonicalReads(plan)
        ? requiredAdvisorToolRequests(plan, toolRegistry.definitions, question)
        : []
      const modelTools = advisorQuestionRequiresCanonicalReads(plan) ? toolRegistry : null
      const modelEvidenceItems: AdvisorEvidence[] = []
      const executeTool = async (name: string, args: Record<string, unknown>, toolSignal?: AbortSignal): Promise<AdvisorToolExecution> => {
        const execution = await toolRegistry.execute(name, args, toolSignal ?? signal)
        const unavailable = execution.envelope?.unavailable === true || execution.evidence.coverage.level === 'unavailable'
        const evidence = unavailable ? { ...execution.evidence, refs: [] } : execution.evidence
        modelEvidenceItems.push(evidence)
        return unavailable ? { ...execution, evidence } : execution
      }
      try {
      const answer = await runtime.generate({
          question,
          evidence: attachPlan(modelEvidence, plan),
          requiredToolRequests,
          conversation,
          uiContext,
          plan: plan.plan,
          fallbackIntent: plan.intent,
          guard: modelGuard,
          allowedPeriods,
          tools: modelTools?.definitions,
          toolContract: modelTools?.contract,
          executeTool,
          onConformance,
          onToolEvent,
          onAgentEvent,
          onDelta,
        }, signal)
        if (!advisorQuestionRequiresCanonicalReads(plan)) return answer
        // A selected model failure is a runtime failure, not permission to
        // silently switch the user into a deterministic evidence-only mode.
        // The loop already retains any reads completed before the failure.
        if (answer.runtimeFailure) return answer
        if (!hasUsableEvidence(modelEvidenceItems)) {
          const fallback = await deterministicAnswerForIntent({ source, intent: plan.intent, question, scope, suppliedOverview, conversation, uiContext, plan, signal, allowedPeriods })
          return {
            ...fallback,
            materialLimits: [...(fallback.materialLimits ?? []), 'No usable Metrora facts were returned for this turn; try again or adjust the selected scope.'],
          }
        }
        const authoritative = mergeEvidence(modelEvidenceItems, modelEvidenceItems[0]!)
        return attachAuthoritativeEvidence(answer, authoritative, plan)
      } catch (error) {
        rethrowCancellation(error, signal)
        const fallbackBase = plan.intent === 'action-proposal'
          ? buildActionProposalEvidence(question, scope, plan.understanding.boundary ?? 'Harness is proposal-only for this conversation.')
          : null
        const recoveredEvidence = modelEvidenceItems.length && hasUsableEvidence(modelEvidenceItems)
          ? mergeEvidence(modelEvidenceItems, modelEvidenceItems[0]!)
          : null
        const fallback = fallbackBase
          ? await new DeterministicAdvisorRuntime().generate({ question, evidence: attachPlan(fallbackBase, plan), conversation, uiContext, plan: plan.plan, fallbackIntent: plan.intent, guard: plan.guard, allowedPeriods }, signal)
          : recoveredEvidence
            ? await new DeterministicAdvisorRuntime().generate({ question, evidence: attachPlan(recoveredEvidence, plan), conversation, uiContext, plan: plan.plan, fallbackIntent: plan.intent, guard: plan.guard, allowedPeriods }, signal)
            : await deterministicAnswerForIntent({ source, intent: plan.intent, question, scope, suppliedOverview, conversation, uiContext, plan, signal, allowedPeriods })
        const hasRecoveredFacts = Boolean(recoveredEvidence?.refs.length || fallback.evidence.length)
        return {
          ...fallback,
          conclusion: hasRecoveredFacts
            ? 'The selected model could not finish this answer. Retrieved Metrora facts remain available in Sources and Details.'
            : 'The selected model could not finish this answer. Try again or choose another runtime.',
          presentation: undefined,
          generatedByModel: false,
          runtimeFailure: true,
          materialLimits: [...(fallback.materialLimits ?? []), 'The selected model or runtime failed before the conversational answer was ready.'],
        }
      }
    },
  }
}
