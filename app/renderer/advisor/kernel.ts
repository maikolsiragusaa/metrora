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
export type AdvisorKernel = {
  investigate(input: { question: string; scope: AdvisorScope; overview?: MenubarPayload | null; conversation?: AdvisorConversationTurn[]; signal?: AbortSignal; onToolEvent?: (event: { name: string; status: 'started' | 'completed' }) => void; onDelta?: (text: string) => void }): Promise<AdvisorAnswer>
}
async function deterministicEvidence(source: AdvisorDataSource, intent: ReturnType<typeof classifyAdvisorQuestion>, question: string, scope: AdvisorScope, overview: MenubarPayload, signal?: AbortSignal): Promise<AdvisorEvidence> {
  if (intent === 'spend-change') return buildSpendEvidence(question, scope, overview)
  if (intent === 'model-efficiency') {
    let rows: ModelReportRow[] = []
    try { rows = await source.getModels(scope) } catch { /* Overview fallback. */ }
    throwIfAborted(signal)
    return buildModelEfficiencyEvidence(question, scope, overview, rows)
  }
  let quota: QuotaProvider[] = []
  try { quota = await source.getQuota() } catch { /* unavailable != zero */ }
  throwIfAborted(signal)
  return buildQuotaEvidence(question, scope, overview, quota)
}
export function createAdvisorKernel(source: AdvisorDataSource, runtime: AdvisorModelRuntime): AdvisorKernel {
  return {
    async investigate({ question, scope, overview: suppliedOverview = null, conversation = [], signal, onToolEvent, onDelta }) {
      throwIfAborted(signal)
      const toolRegistry = createAdvisorToolRegistry(source, scope, suppliedOverview)
      if (runtime.mode !== 'ollama-local') {
        const intent = classifyAdvisorQuestion(question)
        if (intent === 'unknown') return runtime.generate({ question, evidence: buildUnknownEvidence(question, scope), conversation, tools: toolRegistry.definitions, executeTool: toolRegistry.execute, onToolEvent, onDelta }, signal)
        const overview = suppliedOverview ?? await source.getOverview(scope)
        throwIfAborted(signal)
        const evidence = await deterministicEvidence(source, intent, question, scope, overview, signal)
        return runtime.generate({ question, evidence, conversation, tools: toolRegistry.definitions, executeTool: toolRegistry.execute, onToolEvent, onDelta }, signal)
      }
      return runtime.generate({ question, evidence: buildUnknownEvidence(question, scope), conversation, tools: toolRegistry.definitions, executeTool: toolRegistry.execute, onToolEvent, onDelta }, signal)
    },
  }
}
