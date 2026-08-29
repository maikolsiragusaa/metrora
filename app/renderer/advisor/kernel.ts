import { buildModelEfficiencyEvidence, buildQuotaEvidence, buildSpendEvidence, buildUnknownEvidence } from './evidence'
import { buildActionProposalEvidence, buildBenchEvidence, buildClarificationEvidence, buildConversationEvidence, buildSocialEvidence, buildUnsupportedEvidence } from './special-evidence'
import { createAdvisorModelGuardV1, resolveAdvisorQuestion } from './comprehension'
import { createAdvisorToolRegistry } from './tools'
import { DeterministicAdvisorRuntime } from './runtime'
import type { MenubarPayload, ModelReportRow, QuotaProvider } from '../lib/types'
import type { AdvisorAnswer, AdvisorBenchEvidence, AdvisorConversationTurn, AdvisorDataSource, AdvisorEvidence, AdvisorIntent, AdvisorModelRuntime, AdvisorScope, AdvisorUiContextV1 } from './types'

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
  investigate(input: { question: string; scope: AdvisorScope; overview?: MenubarPayload | null; conversation?: AdvisorConversationTurn[]; uiContext?: AdvisorUiContextV1; signal?: AbortSignal; onToolEvent?: (event: { name: string; status: 'started' | 'completed' }) => void; onDelta?: (text: string) => void }): Promise<AdvisorAnswer>
}
async function deterministicEvidence(source: AdvisorDataSource, intent: AdvisorIntent, question: string, scope: AdvisorScope, overview: MenubarPayload, signal?: AbortSignal): Promise<AdvisorEvidence> {
  if (intent === 'spend-change') return buildSpendEvidence(question, scope, overview)
  if (intent === 'model-efficiency') {
    let rows: ModelReportRow[] = []
    try { rows = await source.getModels(scope, signal) } catch (error) { rethrowCancellation(error, signal) /* Overview fallback. */ }
    throwIfAborted(signal)
    return buildModelEfficiencyEvidence(question, scope, overview, rows)
  }
  let quota: QuotaProvider[] = []
  try { quota = await source.getQuota(signal) } catch (error) { rethrowCancellation(error, signal) /* unavailable != zero */ }
  throwIfAborted(signal)
  return buildQuotaEvidence(question, scope, overview, quota)
}
const unavailableBench: AdvisorBenchEvidence = { state: 'UNAVAILABLE', runs: [], latest: null, comparison: null }

async function deterministicEvidenceForIntent(source: AdvisorDataSource, intent: AdvisorIntent, question: string, scope: AdvisorScope, suppliedOverview: MenubarPayload | null, signal?: AbortSignal): Promise<AdvisorEvidence> {
  if (intent === 'social') return buildSocialEvidence(question, scope)
  if (intent === 'action-proposal') return buildActionProposalEvidence(question, scope, 'Advisor is read-only for this conversation; execution requires a separately authorized action surface.')
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
    const overview = suppliedOverview ?? await source.getOverview(scope, signal)
    throwIfAborted(signal)
    return deterministicEvidence(source, intent, question, scope, overview, signal)
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
export function createAdvisorKernel(source: AdvisorDataSource, runtime: AdvisorModelRuntime): AdvisorKernel {
  return {
    async investigate({ question, scope, overview: suppliedOverview = null, conversation = [], uiContext, signal, onToolEvent, onDelta }) {
      throwIfAborted(signal)
      const plan = resolveAdvisorQuestion(question, scope, conversation)
      const modelReady = runtime.mode !== 'deterministic-local' && runtime.availability !== 'unavailable' && runtime.mode !== 'unsupported'
      const modelEvidence = plan.intent === 'action-proposal'
        ? buildActionProposalEvidence(question, scope, plan.understanding.boundary ?? 'Advisor is read-only for this conversation.')
        : buildConversationEvidence(question, scope)
      const modelInputEvidence = attachPlan(modelEvidence, plan)
      if (!modelReady) {
        const evidence = await deterministicEvidenceForIntent(source, plan.intent, question, scope, suppliedOverview, signal)
        const inputEvidence = attachPlan(evidence, plan)
        return new DeterministicAdvisorRuntime().generate({ question, evidence: inputEvidence, conversation, uiContext, plan: plan.plan, fallbackIntent: plan.intent, guard: plan.guard }, signal)
      }
      const modelGuard = createAdvisorModelGuardV1(plan)
      const toolRegistry = createAdvisorToolRegistry(source, scope, suppliedOverview)
      try {
        return await runtime.generate({ question, evidence: modelInputEvidence, conversation, uiContext, plan: plan.plan, fallbackIntent: plan.intent, guard: modelGuard, tools: toolRegistry.definitions, toolContract: toolRegistry.contract, executeTool: toolRegistry.execute, onToolEvent, onDelta }, signal)
      } catch (error) {
        rethrowCancellation(error, signal)
        const fallbackBase = plan.intent === 'action-proposal'
          ? buildActionProposalEvidence(question, scope, plan.understanding.boundary ?? 'Advisor is read-only for this conversation.')
          : await deterministicEvidenceForIntent(source, plan.intent, question, scope, suppliedOverview, signal)
        const fallbackEvidence = attachPlan(fallbackBase, plan)
        const fallback = await new DeterministicAdvisorRuntime().generate({ question, evidence: fallbackEvidence, conversation, uiContext, plan: plan.plan, fallbackIntent: plan.intent, guard: plan.guard }, signal)
        return {
          ...fallback,
          materialLimits: [...(fallback.materialLimits ?? []), 'The explanatory model was unavailable, so this answer uses Metrora deterministic evidence.'],
        }
      }
    },
  }
}
