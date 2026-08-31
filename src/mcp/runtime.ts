import { aggregateModels } from '../models-report.js'
import type { DateRange } from '../types.js'
import { getDateRange } from '../cli-date.js'
import type { ModelAccountingRow } from '../model-accounting-types.js'
import type { MenubarPayload } from '../menubar-json.js'
import { parseProjectsForMetroraScope } from '../project-scope-cli.js'
import { readProjectRegistry } from '../project-registry.js'
import { readCanonicalBenchEvidenceV1, type CanonicalBenchEvidenceV1 } from '../bench/evidence-v1.js'
import { createMetroraToolRegistry } from '../tools/registry.js'
import type {
  MetroraModelReportRow,
  MetroraOverview,
  MetroraToolBenchEvidence,
  MetroraToolDataSource,
  MetroraToolJsonObject,
  MetroraToolJsonValue,
  MetroraToolPeriod,
  MetroraToolScope,
  MetroraToolRegistry,
  MetroraOverviewModelAccountingRow,
} from '../tools/types.js'
import { ALL_PROJECTS_SCOPE_ID } from '../project-scope.js'
import { buildMenubarPayloadForRange } from '../usage-aggregator.js'

export type MetroraMcpProvider = 'all' | 'claude' | 'codex'
export type MetroraMcpStartupOptions = {
  period?: MetroraToolPeriod
  provider?: MetroraMcpProvider
  projectId?: string
  dataDir?: string
}

const PERIODS: readonly MetroraToolPeriod[] = ['today', 'week', '30days', 'month', 'all', 'lifetime']
const PROVIDERS: readonly MetroraMcpProvider[] = ['all', 'claude', 'codex']

function localDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999)
}

export class MetroraMcpStartupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetroraMcpStartupError'
  }
}

function isPeriod(value: unknown): value is MetroraToolPeriod {
  return typeof value === 'string' && (PERIODS as readonly string[]).includes(value)
}

function isProvider(value: unknown): value is MetroraMcpProvider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value)
}

type RuntimePeriodInfo = { range: DateRange; label: string }

function periodInfoForScope(scope: MetroraToolScope): RuntimePeriodInfo {
  if (!scope.range) return getDateRange(scope.period)
  const start = localDate(scope.range.from)
  const end = endOfDay(localDate(scope.range.to))
  const label = scope.range.from === scope.range.to
    ? 'Selected day (' + scope.range.from + ')'
    : scope.range.from + ' to ' + scope.range.to
  return { range: { start, end }, label }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Metrora tool call cancelled')
  error.name = 'AbortError'
  throw error
}

function mapAccountingRow(row: ModelAccountingRow): MetroraOverviewModelAccountingRow {
  return {
    name: row.name,
    cost: row.cost,
    calls: row.calls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    ...(typeof row.reasoningTokens === 'number' ? { reasoningTokens: row.reasoningTokens } : {}),
    ...(typeof row.additiveReasoningTokens === 'number' ? { additiveReasoningTokens: row.additiveReasoningTokens } : {}),
  }
}

/** Project the rich CLI payload into the transport-neutral Overview shape. */
function overviewFromPayload(payload: MenubarPayload): MetroraOverview {
  const current = payload.current
  return {
    generated: payload.generated,
    freshness: payload.freshness,
    current: {
      label: current.label,
      cost: current.cost,
      calls: current.calls,
      sessions: current.sessions,
      inputTokens: current.inputTokens,
      outputTokens: current.outputTokens,
      cacheReadTokens: current.cacheReadTokens,
      cacheWriteTokens: current.cacheWriteTokens,
      pricingCoverage: current.pricingCoverage ?? null,
      providers: current.providers,
      providerDetails: current.providerDetails,
      topModels: current.topModels.map(row => ({ name: row.name, cost: row.cost, calls: row.calls })),
      topProjects: current.topProjects.map(row => ({ name: row.name, cost: row.cost, sessions: row.sessions })),
      topSessions: current.topSessions.map(row => ({ project: row.project, cost: row.cost, calls: row.calls, date: row.date })),
      modelAccounting: current.modelAccounting
        ? {
            rows: current.modelAccounting.rows.map(row => mapAccountingRow(row)),
            coverage: { cost: current.modelAccounting.coverage.cost },
          }
        : undefined,
    },
    history: {
      daily: (payload.history?.daily ?? []).map(row => ({
        date: row.date,
        cost: row.cost,
        calls: row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        topModels: (row.topModels ?? []).map(model => ({ name: model.name, cost: model.cost, calls: model.calls })),
      })),
    },
  }
}

function modelReportRow(row: Awaited<ReturnType<typeof aggregateModels>>[number]): MetroraModelReportRow {
  return {
    provider: row.provider,
    providerDisplayName: row.providerDisplayName,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    additiveReasoningTokens: row.additiveReasoningTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    cacheReadTokens: row.cacheReadTokens,
    totalTokens: row.totalTokens,
    costUSD: row.costUSD,
    calls: row.calls,
    pricing: { state: row.pricing.state },
  }
}

function safeBenchRecord(record: {
  runId: string
  model: { selected: string; reported: string | null }
  pack: { packId: string; version: string; digest: string }
  startedAt: string
  endedAt: string
  status: string
  aggregate: unknown
  resultDigest: string
}): MetroraToolJsonObject {
  return {
    runId: record.runId,
    model: record.model.selected,
    reportedModel: record.model.reported,
    packId: record.pack.packId,
    packVersion: record.pack.version,
    packDigest: record.pack.digest,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    status: record.status,
    aggregate: record.aggregate as MetroraToolJsonValue,
    resultDigest: record.resultDigest,
  }
}

function safePerformanceRecord(record: CanonicalBenchEvidenceV1['performance']['history'][number]): MetroraToolJsonObject {
  return {
    runId: record.runId,
    model: record.model.selected,
    reportedModel: record.model.reported,
    modelType: record.model.type,
    executable: record.executable.name,
    method: record.methodology.id + '@' + record.methodology.version,
    setup: record.methodology.setup as unknown as MetroraToolJsonValue,
    observedConfiguration: record.observedConfiguration as unknown as MetroraToolJsonValue,
    runtime: {
      id: record.runtime.id,
      buildCommit: record.runtime.buildCommit,
      buildNumber: record.runtime.buildNumber,
      version: record.runtime.version,
      backends: record.runtime.backends as unknown as MetroraToolJsonValue,
    } as unknown as MetroraToolJsonValue,
    environment: {
      os: record.environment.os,
      arch: record.environment.arch,
      node: record.environment.node,
    } as unknown as MetroraToolJsonValue,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    status: record.status,
    termination: record.termination.status,
    failure: record.failure as unknown as MetroraToolJsonValue,
    workloads: record.workloads as unknown as MetroraToolJsonValue,
    resultDigest: record.resultDigest,
  }
}

function safePerformanceComparison(comparison: CanonicalBenchEvidenceV1['performance']['comparison']): MetroraToolJsonValue {
  if (!comparison) return null
  const identity = (value: typeof comparison.left): MetroraToolJsonObject => ({
    runId: value.runId,
    model: value.model,
    modelType: value.modelType,
    executable: value.executable,
    endedAt: value.endedAt,
    runtime: value.runtime as unknown as MetroraToolJsonValue,
    environment: value.environment as unknown as MetroraToolJsonValue,
    setup: value.setup as unknown as MetroraToolJsonValue,
    observedConfiguration: value.observedConfiguration as unknown as MetroraToolJsonValue,
  })
  return {
    schemaVersion: comparison.schemaVersion,
    compatible: comparison.compatible,
    reason: comparison.reason,
    left: identity(comparison.left),
    right: identity(comparison.right),
    deltas: comparison.deltas as unknown as MetroraToolJsonValue,
  }
}

function combinedBenchState(evidence: CanonicalBenchEvidenceV1): NonNullable<MetroraToolBenchEvidence['state']> {
  const states = [evidence.core.state, evidence.performance.state]
  if (states.includes('AVAILABLE')) return states.includes('PARTIAL') || states.includes('NOT_COMPARABLE') ? 'PARTIAL' : 'AVAILABLE'
  if (states.includes('PARTIAL')) return 'PARTIAL'
  if (states.includes('NOT_COMPARABLE')) return 'NOT_COMPARABLE'
  if (states.includes('UNAVAILABLE')) return 'UNAVAILABLE'
  return 'NO_DATA'
}

async function benchEvidence(scope: MetroraToolScope, signal?: AbortSignal, dataDir?: string): Promise<MetroraToolBenchEvidence> {
  throwIfAborted(signal)
  const evidence = await readCanonicalBenchEvidenceV1({
    dataDir,
    period: scope.period,
    range: scope.range,
    provider: scope.provider,
    projectId: scope.projectId,
    model: scope.model,
    limit: 10,
  })
  throwIfAborted(signal)
  return {
    state: combinedBenchState(evidence),
    schemaVersion: evidence.schemaVersion,
    scope: evidence.scope as unknown as MetroraToolJsonValue,
    core: {
      state: evidence.core.state,
      latest: evidence.core.latest ? safeBenchRecord(evidence.core.latest) : null,
      history: evidence.core.history.map(safeBenchRecord),
      comparison: evidence.core.comparison as unknown as MetroraToolJsonValue,
      invalidCount: evidence.core.invalidCount,
    } as unknown as MetroraToolJsonValue,
    performance: {
      state: evidence.performance.state,
      latest: evidence.performance.latest ? safePerformanceRecord(evidence.performance.latest) : null,
      history: evidence.performance.history.map(safePerformanceRecord),
      comparison: safePerformanceComparison(evidence.performance.comparison),
      invalidCount: evidence.performance.invalidCount,
    } as unknown as MetroraToolJsonValue,
  }
}

function scopeProjectId(value: string): string | null {
  return value === ALL_PROJECTS_SCOPE_ID ? null : value
}

function dateRangeForScope(scope: MetroraToolScope): DateRange {
  return periodInfoForScope(scope).range
}

export async function createMetroraToolRuntime(options: MetroraMcpStartupOptions = {}): Promise<MetroraToolRegistry> {
  const period = options.period ?? 'all'
  const provider = options.provider ?? 'all'
  const projectId = options.projectId ?? ALL_PROJECTS_SCOPE_ID
  if (!isPeriod(period)) throw new MetroraMcpStartupError('Metrora MCP period is unsupported.')
  if (!isProvider(provider)) throw new MetroraMcpStartupError('Metrora MCP provider is unsupported.')
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 256 || /[\u0000-\u001f\u007f]/u.test(projectId)) {
    throw new MetroraMcpStartupError('Metrora MCP Project scope is invalid.')
  }

  const projectRegistry = await readProjectRegistry()
  const project = projectId === ALL_PROJECTS_SCOPE_ID
    ? null
    : projectRegistry.registry.projects.find(candidate => candidate.id === projectId) ?? null
  if (projectId !== ALL_PROJECTS_SCOPE_ID && !project) throw new MetroraMcpStartupError('Metrora MCP Project scope was not found.')

  const scope: MetroraToolScope = {
    period,
    // A named period remains narrowable by the canonical contract. A relative
    // date range is materialized only when a tool requests yesterday.
    range: null,
    provider,
    projectId,
    projectName: project?.name ?? 'All projects',
    model: null,
  }

  const source: MetroraToolDataSource = {
    getOverview: async (context, signal) => {
      throwIfAborted(signal)
      const payload = await buildMenubarPayloadForRange(periodInfoForScope(context), {
        provider: context.provider,
        metroraProjectId: scopeProjectId(context.projectId),
        optimize: false,
        timeline: false,
      })
      throwIfAborted(signal)
      return overviewFromPayload(payload)
    },
    getModels: async (context, signal) => {
      throwIfAborted(signal)
      const projects = await parseProjectsForMetroraScope(dateRangeForScope(context), context.provider, scopeProjectId(context.projectId))
      const rows = await aggregateModels(projects)
      throwIfAborted(signal)
      return rows.slice(0, 64).map(modelReportRow)
    },
    // Desktop owns canonical provider-reported Capacity collectors and a
    // sanitized quota projection. Local MCP V1's CLI/core runtime does not
    // yet bind that authority through a reusable non-Electron source. Keep
    // this source empty so MCP reports quota unavailable rather than turning
    // Metrora spend into an invented capacity estimate.
    getQuota: async signal => {
      throwIfAborted(signal)
      return []
    },
    getBenchEvidence: (context, signal) => benchEvidence(context, signal, options.dataDir),
  }

  return createMetroraToolRegistry(source, scope)
}
