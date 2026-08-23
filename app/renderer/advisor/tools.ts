import type { MenubarPayload, ModelReportRow, QuotaProvider } from '../lib/types'
import { buildModelEfficiencyEvidence, buildQuotaEvidence, buildSpendEvidence } from './evidence'
import type { AdvisorDataSource, AdvisorEvidence, AdvisorScope, AdvisorToolDefinition, AdvisorToolExecution, AdvisorToolExecutor } from './types'

export const ADVISOR_TOOL_DEFINITIONS: readonly AdvisorToolDefinition[] = [
  { type: 'function', function: { name: 'get_spend_snapshot', description: 'Read Metrora measured spend, daily trend, model and Project drivers, and coverage for the selected scope.', parameters: { type: 'object', properties: { model: { type: 'string', description: 'Optional exact model filter' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_model_efficiency', description: 'Read canonical Metrora model rows and observed cost per call. Do not infer quality or comparable work.', parameters: { type: 'object', properties: { model: { type: 'string', description: 'Optional exact model filter' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_quota_snapshot', description: 'Read provider-reported quota windows, reset timestamps, freshness, and credits. Never estimate quota from Metrora spend.', parameters: { type: 'object', properties: { provider: { type: 'string', enum: ['all', 'claude', 'codex'] } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_overview_snapshot', description: 'Read the current canonical Metrora overview for the selected period, Project, provider, and model context.', parameters: { type: 'object', properties: { model: { type: 'string', description: 'Optional exact model filter' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_project_drivers', description: 'Read descriptive Project spend drivers from the canonical Metrora overview. Do not infer causality.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_session_highlights', description: 'Read content-minimal highest-cost session summaries from the canonical Metrora overview. No raw session content is exposed.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_coverage_report', description: 'Read Metrora evidence coverage, assumptions, and unknowns for the selected scope.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
]
function toolScope(scope: AdvisorScope, args: Record<string, unknown>): AdvisorScope {
  const model = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : scope.model
  const provider = typeof args.provider === 'string' && ['all', 'claude', 'codex'].includes(args.provider) ? args.provider : scope.provider
  return { ...scope, model, provider }
}
function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'number' && !Number.isFinite(item) ? null : item)
}
function compactEvidence(evidence: AdvisorEvidence): string {
  return safeJson({ intent: evidence.intent, scope: evidence.scope, coverage: evidence.coverage, refs: evidence.refs, spend: evidence.spend, modelEfficiency: evidence.modelEfficiency, quota: evidence.quota, assumptions: evidence.assumptions, unknown: evidence.unknown })
}
function sameScope(left: AdvisorScope, right: AdvisorScope): boolean {
  return left.period === right.period
    && left.provider === right.provider
    && left.projectId === right.projectId
    && left.projectName === right.projectName
    && left.model === right.model
    && left.range?.from === right.range?.from
    && left.range?.to === right.range?.to
}
export function createAdvisorToolRegistry(source: AdvisorDataSource, scope: AdvisorScope, suppliedOverview: MenubarPayload | null): { definitions: readonly AdvisorToolDefinition[]; execute: AdvisorToolExecutor } {
  const execute: AdvisorToolExecutor = async (name, args, signal): Promise<AdvisorToolExecution> => {
    if (signal?.aborted) throw new DOMException('Advisor tool call cancelled', 'AbortError')
    const nextScope = toolScope(scope, args)
    if (name === 'get_overview_snapshot' || name === 'get_spend_snapshot' || name === 'get_project_drivers' || name === 'get_session_highlights' || name === 'get_coverage_report') {
      const overview = suppliedOverview && sameScope(nextScope, scope) ? suppliedOverview : await source.getOverview(nextScope)
      const label = name === 'get_project_drivers' ? 'tool: Project drivers' : name === 'get_session_highlights' ? 'tool: session highlights' : name === 'get_coverage_report' ? 'tool: coverage report' : name === 'get_overview_snapshot' ? 'tool: overview snapshot' : 'tool: spend snapshot'
      const evidence = buildSpendEvidence(label, nextScope, overview)
      return { content: compactEvidence(evidence), evidence }
    }
    if (name === 'get_model_efficiency') {
      const overview = suppliedOverview && sameScope(nextScope, scope) ? suppliedOverview : await source.getOverview(nextScope)
      let rows: ModelReportRow[] = []
      try { rows = await source.getModels(nextScope) } catch { /* Overview fallback remains honest. */ }
      const evidence = buildModelEfficiencyEvidence('tool: model efficiency', nextScope, overview, rows)
      return { content: compactEvidence(evidence), evidence }
    }
    if (name === 'get_quota_snapshot') {
      let quota: QuotaProvider[] = []
      try { quota = await source.getQuota() } catch { /* unavailable is factual, not zero. */ }
      const evidence = buildQuotaEvidence('tool: quota snapshot', nextScope, suppliedOverview, quota)
      return { content: compactEvidence(evidence), evidence }
    }
    throw new Error('Unknown Advisor tool: ' + name)
  }
  return { definitions: ADVISOR_TOOL_DEFINITIONS, execute }
}
