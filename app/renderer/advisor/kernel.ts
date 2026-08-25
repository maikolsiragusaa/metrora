import { buildModelEfficiencyEvidence, buildQuotaEvidence, buildSpendEvidence, buildUnknownEvidence } from './evidence'
import { buildActionProposalEvidence, buildBenchEvidence, buildClarificationEvidence, buildSocialEvidence, buildUnsupportedEvidence } from './special-evidence'
import { resolveAdvisorQuestion } from './comprehension'
import { createAdvisorToolRegistry } from './tools'
import { DeterministicAdvisorRuntime } from './runtime'
import type { MenubarPayload, ModelReportRow, QuotaProvider } from '../lib/types'
import type { AdvisorAnswer, AdvisorBenchEvidence, AdvisorConversationTurn, AdvisorDataSource, AdvisorEvidence, AdvisorIntent, AdvisorModelRuntime, AdvisorScope } from './types'

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
  investigate(input: { question: string; scope: AdvisorScope; overview?: MenubarPayload | null; conversation?: AdvisorConversationTurn[]; signal?: AbortSignal; onToolEvent?: (event: { name: string; status: 'started' | 'completed' }) => void; onDelta?: (text: string) => void }): Promise<AdvisorAnswer>
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

export function createAdvisorKernel(source: AdvisorDataSource, runtime: AdvisorModelRuntime): AdvisorKernel {
  return {
    async investigate({ question, scope, overview: suppliedOverview = null, conversation = [], signal, onToolEvent, onDelta }) {
      throwIfAborted(signal)
      const plan = resolveAdvisorQuestion(question, scope, conversation)
      let evidence: AdvisorEvidence
      if (plan.intent === 'social') {
        evidence = buildSocialEvidence(question, scope)
      } else if (plan.intent === 'action-proposal') {
        evidence = buildActionProposalEvidence(question, scope, plan.understanding.boundary ?? 'Advisor is read-only for this conversation.')
      } else if (plan.intent === 'clarification') {
        evidence = buildClarificationEvidence(question, scope, plan.understanding.clarification ?? 'Choose the intended evidence source.')
      } else if (plan.intent === 'unsupported') {
        evidence = buildUnsupportedEvidence(question, scope, plan.understanding.boundary ?? 'This question is outside Metrora evidence.')
      } else if (plan.intent === 'unknown') {
        evidence = buildUnknownEvidence(question, scope)
      } else if (plan.intent === 'bench-result') {
        let bench = unavailableBench
        if (source.getBenchEvidence) {
          try { bench = await source.getBenchEvidence(scope, signal) } catch (error) { rethrowCancellation(error, signal) }
        }
        throwIfAborted(signal)
        evidence = buildBenchEvidence(question, scope, bench)
      } else {
        const overview = suppliedOverview ?? (signal ? await source.getOverview(scope, signal) : await source.getOverview(scope))
        throwIfAborted(signal)
        evidence = await deterministicEvidence(source, plan.intent, question, scope, overview, signal)
      }
      const withUnderstanding: AdvisorEvidence = {
        ...evidence,
        understanding: plan.understanding,
        plan: plan.plan,
        assumptions: plan.usedDefaultScope
          ? ['I used the current scope selected in Metrora. Use the scope controls above to change it.', ...evidence.assumptions]
          : evidence.assumptions,
      }
      if (!plan.needsEvidence && plan.intent !== 'unknown') {
        return new DeterministicAdvisorRuntime().generate({ question, evidence: withUnderstanding, conversation, plan: plan.plan }, signal)
      }
      const toolRegistry = createAdvisorToolRegistry(source, scope, suppliedOverview)
      try {
        return await runtime.generate({ question, evidence: withUnderstanding, conversation, plan: plan.plan, tools: toolRegistry.definitions, toolContract: toolRegistry.contract, executeTool: toolRegistry.execute, onToolEvent, onDelta }, signal)
      } catch (error) {
        rethrowCancellation(error, signal)
        const fallback = await new DeterministicAdvisorRuntime().generate({ question, evidence: withUnderstanding, conversation, plan: plan.plan }, signal)
        return {
          ...fallback,
          materialLimits: [...(fallback.materialLimits ?? []), 'The explanatory model was unavailable, so this answer uses Metrora deterministic evidence.'],
        }
      }
    },
  }
}
