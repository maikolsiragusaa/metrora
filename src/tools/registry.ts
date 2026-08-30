import {
  boundedMetroraToolJson,
  createMetroraToolResultEnvelope,
  nextMetroraToolScope,
  snapshotMetroraToolScope,
  validateMetroraToolArguments,
  MetroraToolContractError,
  METRORA_TOOL_CONTRACT,
  METRORA_TOOL_DEFINITIONS,
} from './contract.js'
import {
  buildMetroraBenchEvidence,
  buildMetroraModelEfficiencyEvidence,
  buildMetroraQuotaEvidence,
  buildMetroraSpendEvidence,
} from './evidence.js'
import { contentMinimalMetroraToolEvidence } from './privacy.js'
import type {
  MetroraModelReportRow,
  MetroraOverview,
  MetroraQuotaSnapshot,
  MetroraToolDataSource,
  MetroraToolEvidence,
  MetroraToolBenchEvidence,
  MetroraToolJsonObject,
  MetroraToolName,
  MetroraToolRegistry,
  MetroraToolScope,
  MetroraToolExecution,
  MetroraToolExecutor,
} from './types.js'

const EMPTY_OVERVIEW: MetroraOverview = { current: undefined, history: { daily: [] } }
const EMPTY_BENCH = { state: 'UNAVAILABLE' as const }

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Metrora tool call cancelled')
    error.name = 'AbortError'
    throw error
  }
}
function cancellationLike(error: unknown): boolean {
  if (error instanceof Error) return error.name === 'AbortError' || /cancel|abort/i.test(error.message)
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError')
}
function rethrowCancellation(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted || cancellationLike(error)) throw error
}
function sameScope(left: MetroraToolScope, right: MetroraToolScope): boolean {
  return left.period === right.period
    && left.provider === right.provider
    && left.projectId === right.projectId
    && left.projectName === right.projectName
    && left.model === right.model
    && left.range?.from === right.range?.from
    && left.range?.to === right.range?.to
}
function emptyEvidence(name: MetroraToolName, question: string, scope: MetroraToolScope): MetroraToolEvidence {
  const unavailable = buildMetroraSpendEvidence(question, scope, EMPTY_OVERVIEW)
  return { ...unavailable, intent: name === 'get_bench_evidence' ? 'bench-result' : unavailable.intent, refs: [], domainCoverage: undefined }
}
async function optionalModels(source: MetroraToolDataSource, scope: MetroraToolScope, signal?: AbortSignal): Promise<MetroraModelReportRow[]> {
  try {
    const rows = signal ? await source.getModels(scope, signal) : await source.getModels(scope)
    throwIfAborted(signal)
    return Array.isArray(rows) ? rows : []
  } catch (error) {
    rethrowCancellation(error, signal)
    return []
  }
}
async function optionalQuota(source: MetroraToolDataSource, signal?: AbortSignal): Promise<MetroraQuotaSnapshot[]> {
  try {
    const rows = signal ? await source.getQuota(signal) : await source.getQuota()
    throwIfAborted(signal)
    return Array.isArray(rows) ? rows : []
  } catch (error) {
    rethrowCancellation(error, signal)
    return []
  }
}
async function readOverview(source: MetroraToolDataSource, scope: MetroraToolScope, signal?: AbortSignal): Promise<MetroraOverview> {
  try {
    const result = signal ? await source.getOverview(scope, signal) : await source.getOverview(scope)
    throwIfAborted(signal)
    return result && typeof result === 'object' ? result : EMPTY_OVERVIEW
  } catch (error) {
    rethrowCancellation(error, signal)
    return EMPTY_OVERVIEW
  }
}
function resultFor(name: MetroraToolName, scope: MetroraToolScope, args: MetroraToolJsonObject, evidence: MetroraToolEvidence): MetroraToolExecution {
  const content = boundedMetroraToolJson(contentMinimalMetroraToolEvidence(evidence))
  return {
    content,
    evidence,
    envelope: createMetroraToolResultEnvelope(name, scope, args, evidence, JSON.parse(content) as MetroraToolJsonObject),
  }
}

/** The one canonical implementation used by all current transports. */
export function createMetroraToolRegistry(source: MetroraToolDataSource, scope: MetroraToolScope, suppliedOverview: MetroraOverview | null = null): MetroraToolRegistry {
  const invocationScope = snapshotMetroraToolScope(scope)
  const execute: MetroraToolExecutor = async (name, args, signal): Promise<MetroraToolExecution> => {
    throwIfAborted(signal)
    const normalizedName = typeof name === 'string' ? name : String(name)
    const normalizedArgs = validateMetroraToolArguments(normalizedName, args)
    const nextScope = nextMetroraToolScope(invocationScope, normalizedName as MetroraToolName, normalizedArgs)
    throwIfAborted(signal)
    const overview = suppliedOverview && sameScope(nextScope, invocationScope) ? suppliedOverview : await readOverview(source, nextScope, signal)

    if (normalizedName === 'get_overview_snapshot' || normalizedName === 'get_spend_snapshot' || normalizedName === 'get_project_drivers' || normalizedName === 'get_session_highlights' || normalizedName === 'get_coverage_report') {
      return resultFor(normalizedName, nextScope, normalizedArgs, buildMetroraSpendEvidence('tool: ' + normalizedName.replaceAll('_', ' '), nextScope, overview))
    }
    if (normalizedName === 'get_model_efficiency') {
      const rows = await optionalModels(source, nextScope, signal)
      return resultFor(normalizedName, nextScope, normalizedArgs, buildMetroraModelEfficiencyEvidence('tool: model efficiency', nextScope, overview, rows))
    }
    if (normalizedName === 'get_quota_snapshot') {
      return resultFor(normalizedName, nextScope, normalizedArgs, buildMetroraQuotaEvidence('tool: quota snapshot', nextScope, overview, await optionalQuota(source, signal)))
    }
    if (normalizedName === 'get_bench_evidence') {
      let bench: MetroraToolBenchEvidence = EMPTY_BENCH
      if (source.getBenchEvidence) {
        try {
          const result = await source.getBenchEvidence(nextScope, signal)
          throwIfAborted(signal)
          bench = result && typeof result === 'object' ? result : EMPTY_BENCH
        } catch (error) {
          rethrowCancellation(error, signal)
        }
      }
      return resultFor(normalizedName, nextScope, normalizedArgs, buildMetroraBenchEvidence('tool: Bench evidence', nextScope, bench))
    }
    throw new MetroraToolContractError('unknown-tool', 'Unknown Metrora tool: ' + normalizedName)
  }
  return { contract: METRORA_TOOL_CONTRACT, definitions: METRORA_TOOL_DEFINITIONS, scope: invocationScope, execute }
}
