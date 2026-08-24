import type { MenubarPayload, ModelReportRow, QuotaProvider } from '../lib/types'
import {
  ADVISOR_TOOL_CONTRACT,
  ADVISOR_TOOL_DEFINITIONS,
  AdvisorToolContractError,
  boundedAdvisorJson,
  createAdvisorToolResultEnvelope,
  snapshotAdvisorScope,
  validateAdvisorToolArguments,
} from './contract'
import { buildModelEfficiencyEvidence, buildQuotaEvidence, buildSpendEvidence } from './evidence'
import type {
  AdvisorDataSource,
  AdvisorEvidence,
  AdvisorJsonObject,
  AdvisorScope,
  AdvisorToolContract,
  AdvisorToolDefinition,
  AdvisorToolExecution,
  AdvisorToolExecutor,
  AdvisorToolName,
} from './types'

export { ADVISOR_TOOL_CONTRACT, ADVISOR_TOOL_DEFINITIONS }

const PATH_LIKE_TEXT = /^(?:[a-z]:[\\/]|\\\\|\/(?:users|home|private|var|tmp|mnt)(?:\/|$))/i
const SECRET_LIKE_TEXT = /(?:bearer\s+|api[_-]?key\s*[=:]|secret\s*[=:]|password\s*[=:]|token\s*[=:]|(?:sk|gh[pousr])-[a-z0-9_-]{12,})/i

function contentMinimalText(value: string, fallback = '[redacted]'): string {
  const trimmed = value.trim()
  if (!trimmed || PATH_LIKE_TEXT.test(trimmed) || SECRET_LIKE_TEXT.test(trimmed)) return fallback
  return trimmed.length > 160 ? trimmed.slice(0, 157) + '…' : trimmed
}

function contentMinimalScope(scope: AdvisorScope): AdvisorJsonObject {
  return {
    period: scope.period,
    range: scope.range,
    provider: contentMinimalText(scope.provider),
    projectId: contentMinimalText(scope.projectId),
    projectName: contentMinimalText(scope.projectName),
    model: scope.model === null ? null : contentMinimalText(scope.model),
  }
}

function contentMinimalEvidence(evidence: AdvisorEvidence): AdvisorJsonObject {
  return {
    intent: evidence.intent,
    scope: contentMinimalScope(evidence.scope),
    coverage: evidence.coverage,
    refs: evidence.refs.map(ref => ({ id: ref.id, label: contentMinimalText(ref.label), source: ref.source })),
    spend: evidence.spend
      ? {
          ...evidence.spend,
          models: evidence.spend.models.map(row => ({ ...row, name: contentMinimalText(row.name) })),
          projects: evidence.spend.projects.map(row => ({ ...row, name: contentMinimalText(row.name) })),
          sessionsByCost: evidence.spend.sessionsByCost.map(row => ({ ...row, name: contentMinimalText(row.name) })),
        }
      : null,
    modelEfficiency: evidence.modelEfficiency
      ? {
          ...evidence.modelEfficiency,
          selectedModel: evidence.modelEfficiency.selectedModel === null ? null : contentMinimalText(evidence.modelEfficiency.selectedModel),
          rows: evidence.modelEfficiency.rows.map(row => ({ ...row, model: contentMinimalText(row.model), provider: contentMinimalText(row.provider) })),
        }
      : null,
    quota: evidence.quota
      ? {
          ...evidence.quota,
          providers: evidence.quota.providers.map(provider => ({
            ...provider,
            planLabel: provider.planLabel === null ? null : contentMinimalText(provider.planLabel),
            windows: provider.windows.map(window => ({ ...window, label: contentMinimalText(window.label) })),
          })),
        }
      : null,
    assumptions: evidence.assumptions,
    unknown: evidence.unknown,
  }
}

function compactEvidence(evidence: AdvisorEvidence): { content: string; output: AdvisorJsonObject } {
  const content = boundedAdvisorJson(contentMinimalEvidence(evidence))
  return { content, output: JSON.parse(content) as AdvisorJsonObject }
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Advisor tool call cancelled', 'AbortError')
}

function cancellationLike(error: unknown): boolean {
  if (error instanceof Error) return error.name === 'AbortError' || /cancel|abort/i.test(error.message)
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError')
}

function rethrowCancellation(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted || cancellationLike(error)) throw error
}

function nextToolScope(scope: AdvisorScope, name: AdvisorToolName, args: AdvisorJsonObject): AdvisorScope {
  const next = { ...scope, range: scope.range ? { ...scope.range } : null }
  if (name === 'get_spend_snapshot' || name === 'get_model_efficiency' || name === 'get_overview_snapshot') {
    if (Object.prototype.hasOwnProperty.call(args, 'model')) next.model = String(args.model)
  }
  if (name === 'get_quota_snapshot' && Object.prototype.hasOwnProperty.call(args, 'provider')) next.provider = String(args.provider)
  return snapshotAdvisorScope(next)
}

function resultFor(name: AdvisorToolName, scope: AdvisorScope, args: AdvisorJsonObject, evidence: AdvisorEvidence): AdvisorToolExecution {
  const compact = compactEvidence(evidence)
  return {
    content: compact.content,
    evidence,
    envelope: createAdvisorToolResultEnvelope(name, scope, args, evidence, compact.output),
  }
}

async function optionalModels(source: AdvisorDataSource, scope: AdvisorScope, signal?: AbortSignal): Promise<ModelReportRow[]> {
  try {
    const rows = signal ? await source.getModels(scope, signal) : await source.getModels(scope)
    throwIfAborted(signal)
    return Array.isArray(rows) ? rows : []
  } catch (error) {
    rethrowCancellation(error, signal)
    return []
  }
}

async function optionalQuota(source: AdvisorDataSource, signal?: AbortSignal): Promise<QuotaProvider[]> {
  try {
    const rows = signal ? await source.getQuota(signal) : await source.getQuota()
    throwIfAborted(signal)
    return Array.isArray(rows) ? rows : []
  } catch (error) {
    rethrowCancellation(error, signal)
    return []
  }
}

export type AdvisorToolRegistry = {
  contract: AdvisorToolContract
  definitions: readonly AdvisorToolDefinition[]
  scope: AdvisorScope
  execute: AdvisorToolExecutor
}

export function createAdvisorToolRegistry(source: AdvisorDataSource, scope: AdvisorScope, suppliedOverview: MenubarPayload | null): AdvisorToolRegistry {
  const invocationScope = snapshotAdvisorScope(scope)
  const execute: AdvisorToolExecutor = async (name, args, signal): Promise<AdvisorToolExecution> => {
    throwIfAborted(signal)
    const normalizedName = typeof name === 'string' ? name : String(name)
    const normalizedArgs = validateAdvisorToolArguments(normalizedName, args)
    const nextScope = nextToolScope(invocationScope, normalizedName as AdvisorToolName, normalizedArgs)
    throwIfAborted(signal)

    if (normalizedName === 'get_overview_snapshot' || normalizedName === 'get_spend_snapshot' || normalizedName === 'get_project_drivers' || normalizedName === 'get_session_highlights' || normalizedName === 'get_coverage_report') {
      const overview = suppliedOverview && sameScope(nextScope, invocationScope)
        ? suppliedOverview
        : signal ? await source.getOverview(nextScope, signal) : await source.getOverview(nextScope)
      throwIfAborted(signal)
      const label = normalizedName === 'get_project_drivers'
        ? 'tool: Project drivers'
        : normalizedName === 'get_session_highlights'
          ? 'tool: session highlights'
          : normalizedName === 'get_coverage_report'
            ? 'tool: coverage report'
            : normalizedName === 'get_overview_snapshot'
              ? 'tool: overview snapshot'
              : 'tool: spend snapshot'
      return resultFor(normalizedName, nextScope, normalizedArgs, buildSpendEvidence(label, nextScope, overview))
    }
    if (normalizedName === 'get_model_efficiency') {
      const overview = suppliedOverview && sameScope(nextScope, invocationScope)
        ? suppliedOverview
        : signal ? await source.getOverview(nextScope, signal) : await source.getOverview(nextScope)
      throwIfAborted(signal)
      const evidence = buildModelEfficiencyEvidence('tool: model efficiency', nextScope, overview, await optionalModels(source, nextScope, signal))
      return resultFor(normalizedName, nextScope, normalizedArgs, evidence)
    }
    if (normalizedName === 'get_quota_snapshot') {
      const overview = suppliedOverview && sameScope(nextScope, invocationScope)
        ? suppliedOverview
        : signal ? await source.getOverview(nextScope, signal) : await source.getOverview(nextScope)
      throwIfAborted(signal)
      const evidence = buildQuotaEvidence('tool: quota snapshot', nextScope, overview, await optionalQuota(source, signal))
      return resultFor(normalizedName, nextScope, normalizedArgs, evidence)
    }
    throw new AdvisorToolContractError('unknown-tool', 'Unknown Advisor tool: ' + normalizedName)
  }
  return { contract: ADVISOR_TOOL_CONTRACT, definitions: ADVISOR_TOOL_DEFINITIONS, scope: invocationScope, execute }
}
