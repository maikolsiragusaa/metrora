import type { DateRange } from '../types.js'
import { getDateRange } from '../cli-date.js'
import { aggregateModels } from '../models-report.js'
import type { ModelAccountingRow } from '../model-accounting-types.js'
import type { MenubarPayload } from '../menubar-json.js'
import { parseProjectsForMetroraScope } from '../project-scope-cli.js'
import { readProjectRegistry } from '../project-registry.js'
import { compareBenchEvaluationsV1 } from '../bench/compare-v1.js'
import { scanBenchHistoryV1 } from '../bench/history-v1.js'
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
}

const PERIODS: readonly MetroraToolPeriod[] = ['today', 'week', '30days', 'month', 'all', 'lifetime']
const PROVIDERS: readonly MetroraMcpProvider[] = ['all', 'claude', 'codex']

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

function localDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Metrora tool call cancelled')
  error.name = 'AbortError'
  throw error
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

async function benchEvidence(scope: MetroraToolScope, signal?: AbortSignal): Promise<MetroraToolBenchEvidence> {
  throwIfAborted(signal)
  const scan = await scanBenchHistoryV1()
  throwIfAborted(signal)
  const info = periodInfoForScope(scope)
  const start = info.range.start.getTime()
  const end = info.range.end.getTime()
  const records = scan.records
    .filter(record => {
      const ended = Date.parse(record.endedAt)
      return Number.isFinite(ended) && ended >= start && ended <= end
    })
    .slice(0, 10)
  const latest = records[0]
  const previous = records[1]
  const comparison = latest && previous ? compareBenchEvaluationsV1(previous, latest) : null
  return {
    state: latest ? 'AVAILABLE' : 'UNAVAILABLE',
    latest: latest ? safeBenchRecord(latest) : null,
    history: records.map(safeBenchRecord),
    comparison: comparison as unknown as MetroraToolJsonValue,
    invalidCount: scan.invalid.length,
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
    getBenchEvidence: (context, signal) => benchEvidence(context, signal),
  }

  return createMetroraToolRegistry(source, scope)
}
