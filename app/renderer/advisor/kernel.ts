import { buildModelEfficiencyEvidence, buildQuotaEvidence, buildSpendEvidence, buildUnknownEvidence, classifyAdvisorQuestion } from './evidence'
import { createAdvisorToolRegistry } from './tools'
import type { MenubarPayload, ModelReportRow, QuotaProvider } from '../lib/types'
import type { AdvisorAnswer, AdvisorConversationTurn, AdvisorDataSource, AdvisorEvidence, AdvisorModelRuntime, AdvisorScope } from './types'

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
async function deterministicEvidence(source: AdvisorDataSource, intent: ReturnType<typeof classifyAdvisorQuestion>, question: string, scope: AdvisorScope, overview: MenubarPayload, signal?: AbortSignal): Promise<AdvisorEvidence> {
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
export function createAdvisorKernel(source: AdvisorDataSource, runtime: AdvisorModelRuntime): AdvisorKernel {
  return {
    async investigate({ question, scope, overview: suppliedOverview = null, conversation = [], signal, onToolEvent, onDelta }) {
      throwIfAborted(signal)
      const toolRegistry = createAdvisorToolRegistry(source, scope, suppliedOverview)
      const intent = classifyAdvisorQuestion(question)
      let evidence = buildUnknownEvidence(question, scope)
      if (intent !== 'unknown') {
        const overview = suppliedOverview ?? (signal ? await source.getOverview(scope, signal) : await source.getOverview(scope))
        throwIfAborted(signal)
        evidence = await deterministicEvidence(source, intent, question, scope, overview, signal)
      }
      return runtime.generate({ question, evidence, conversation, tools: toolRegistry.definitions, toolContract: toolRegistry.contract, executeTool: toolRegistry.execute, onToolEvent, onDelta }, signal)
    },
  }
}
