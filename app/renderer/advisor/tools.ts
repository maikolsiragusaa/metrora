import type { MenubarPayload, ModelReportRow, Period, QuotaProvider } from '../lib/types'
import {
  ADVISOR_TOOL_CONTRACT,
  ADVISOR_TOOL_DEFINITIONS,
  AdvisorToolContractError,
  boundedAdvisorJson,
  createContentMinimalAdvisorToolResultEnvelope,
  snapshotAdvisorScope,
  validateAdvisorToolArguments,
} from './contract'
import { buildModelEfficiencyEvidence, buildQuotaEvidence, buildSpendEvidence } from './evidence'
import { buildBenchEvidence } from './special-evidence'
import type {
  AdvisorDataSource,
  AdvisorEvidence,
  AdvisorBenchEvidence,
  AdvisorJsonObject,
  AdvisorScope,
  AdvisorToolContract,
  AdvisorToolDefinition,
  AdvisorToolExecution,
  AdvisorToolExecutor,
  AdvisorToolName,
} from './types'
import * as advisorPrivacy from './privacy'

export { ADVISOR_TOOL_CONTRACT, ADVISOR_TOOL_DEFINITIONS }
const unavailableBench: AdvisorBenchEvidence = { state: 'UNAVAILABLE', runs: [], latest: null, comparison: null }

function compactEvidence(evidence: AdvisorEvidence): { content: string; output: AdvisorJsonObject } {
  const content = boundedAdvisorJson(advisorPrivacy.contentMinimalEvidence(evidence))
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
  if (typeof args.period === 'string') {
    if (args.period === 'yesterday') {
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - 1)
      const value = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
      if (scope.range && (value < scope.range.from || value > scope.range.to)) throw new AdvisorToolContractError('invalid-scope', 'The requested relative period is outside the selected scope.')
      next.period = 'today'
      next.range = { from: value, to: value }
    } else {
      const periodOrder: Record<Period, number> = { today: 0, week: 1, '30days': 2, month: 3, all: 4, lifetime: 5 }
      const requested = args.period as Period
      if ((scope.range && requested !== scope.period) || periodOrder[requested] > periodOrder[scope.period]) throw new AdvisorToolContractError('invalid-scope', 'A model tool request cannot widen the selected Metrora scope.')
      next.period = requested
      if (requested !== scope.period) next.range = null
    }
  }
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
    envelope: createContentMinimalAdvisorToolResultEnvelope(name, scope, args, evidence, compact.output),
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
    if (normalizedName === 'get_bench_evidence') {
      let bench = unavailableBench
      if (source.getBenchEvidence) {
        try {
          bench = await source.getBenchEvidence(nextScope, signal)
          throwIfAborted(signal)
        } catch (error) {
          rethrowCancellation(error, signal)
        }
      }
      return resultFor(normalizedName, nextScope, normalizedArgs, buildBenchEvidence('tool: Bench evidence', nextScope, bench))
    }
    throw new AdvisorToolContractError('unknown-tool', 'Unknown Advisor tool: ' + normalizedName)
  }
  return { contract: ADVISOR_TOOL_CONTRACT, definitions: ADVISOR_TOOL_DEFINITIONS, scope: invocationScope, execute }
}
