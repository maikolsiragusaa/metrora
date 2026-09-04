import { existsSync } from 'fs'
import { dirname } from 'node:path'
import type { DateRange, ProjectSummary, SessionSummary } from '../types.js'
import type { ActionBaseline, ActionKind, ActionRecord } from './types.js'
import {
  AVG_TOKENS_PER_READ,
  EDIT_TOOL_NAMES,
  HEALTHY_READ_EDIT_RATIO,
  READ_TOOL_NAMES,
  computeInputCostRate,
} from '../optimize.js'
import { parseAllSessions } from '../parser.js'
import { computeYield, type YieldSummary } from '../yield.js'
import { defaultActionsDir, readRecordHistory } from './journal.js'
import { DEFER_KINDS, measureDeferAction } from './defer-report.js'
import { ARCHIVE_DEF_TOKENS, HONEST_FOOTER, MCP_KINDS } from './report-policy.js'
import { renderTable } from '../text-table.js'
import { formatTokens } from '../format.js'
import { formatCost } from '../currency.js'
export { captureBaseline, captureBaselinesForPlans, captureGuardBaseline } from './report-baseline.js'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_CAP_DAYS = 30
const REPORT_MIN_AGE_DAYS = 3
const MIN_POST_WINDOW_SESSIONS = 20
const VOLUME_SHIFT_FACTOR = 2

export type RealizedStatus = 'measured' | 'reverted' | 'not-measurable'

export type OptimizationReportRow = {
  id: string
  appliedAt: string
  date: string
  kind: ActionKind
  description: string
  // The detector's estimate persisted at apply time, unmodified.
  estimatedAtApply: number
  // The estimate re-expressed over the same post-apply window as realized so
  // the two table columns are comparable; falls back to estimatedAtApply for
  // kinds with no window scaling.
  estimatedForWindow: number
  realizedTokens: number
  status: RealizedStatus
  confidence: 'low' | 'normal'
  note: string
  // guard-install only: yield split then vs now, labeled correlation.
  correlation?: {
    abandonedPctThen: number
    abandonedPctNow: number
    avgSessionCostThenUSD: number
    avgSessionCostNowUSD: number
  }
}

export type OptimizationReport = {
  generatedAt: string
  windowCapDays: number
  costRate: number
  rows: OptimizationReportRow[]
  totalRealizedTokens: number
  totalRealizedCostUSD: number
  measuredCount: number
  activeCount: number
  observedDays: number
  // Journal lines that parsed as JSON but are not usable records (missing or
  // unparseable `at`, missing status); skipped and surfaced, never a throw.
  malformedRecords: number
  // findingId -> earliest apply date of an active applied action; drives the
  // optimize "(previously applied ..., re-flagged)" title suffix.
  appliedByFinding: Record<string, string>
}

export type OptimizationReportOptions = {
  actionsDir?: string
  now?: Date
  cwd?: string
  loadProjects?: (range: DateRange) => Promise<ProjectSummary[]>
  computeYield?: (range: DateRange) => Promise<YieldSummary>
}
const OPTIMIZATION_KINDS: ReadonlySet<ActionKind> = new Set([
  'mcp-remove', 'mcp-project-scope', 'defer-enable', 'defer-alwaysload',
  'defer-threshold', 'archive-skill', 'archive-agent', 'archive-command',
  'claude-md-rule', 'shell-config', 'guard-install', 'guard-uninstall',
  'model-default',
])

function isOptimizationRecord(value: unknown): value is ActionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as { id?: unknown; at?: unknown; kind?: unknown; description?: unknown; changes?: unknown; status?: unknown }
  return typeof record.id === 'string'
    && typeof record.at === 'string'
    && !Number.isNaN(new Date(record.at).getTime())
    && typeof record.kind === 'string'
    && OPTIMIZATION_KINDS.has(record.kind as ActionKind)
    && typeof record.description === 'string'
    && Array.isArray(record.changes)
    && (record.status === 'applied' || record.status === 'undone')
}

function isSupersededEngineRecord(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'recordVersion'))
}

// ---------------------------------------------------------------------------
// Shared measurement helpers
// ---------------------------------------------------------------------------

function ageDays(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / DAY_MS
}

function allSessions(projects: ProjectSummary[]): SessionSummary[] {
  return projects.flatMap(p => p.sessions)
}

function sessionsInWindow(projects: ProjectSummary[], start: Date, end: Date): SessionSummary[] {
  const out: SessionSummary[] = []
  for (const p of projects) {
    for (const s of p.sessions) {
      if (!s.firstTimestamp) continue
      const t = new Date(s.firstTimestamp).getTime()
      if (t >= start.getTime() && t <= end.getTime()) out.push(s)
    }
  }
  return out
}

function projectPathKey(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.toLowerCase()
}

function modelDefaultSessionsInWindow(
  rec: ActionRecord, projects: ProjectSummary[], start: Date, end: Date,
): { projectFound: boolean; sessions: SessionSummary[] } {
  const settingsPath = rec.changes[0]?.path
  if (!settingsPath) return { projectFound: false, sessions: [] }
  const normalizedSettingsPath = settingsPath.replace(/\\/g, '/')
  const targetProjectPath = dirname(dirname(normalizedSettingsPath))
  const targetKey = projectPathKey(targetProjectPath)
  const targetProjects = projects.filter(project => projectPathKey(project.projectPath) === targetKey)
  return {
    projectFound: targetProjects.length > 0,
    sessions: sessionsInWindow(targetProjects, start, end),
  }
}

function countToolCalls(sessions: SessionSummary[], names: ReadonlySet<string>): number {
  let n = 0
  for (const s of sessions) {
    for (const [tool, data] of Object.entries(s.toolBreakdown)) {
      if (names.has(tool)) n += data.calls
    }
  }
  return n
}

function countBashCalls(sessions: SessionSummary[]): number {
  let n = 0
  for (const s of sessions) {
    for (const data of Object.values(s.bashBreakdown)) n += data.calls
  }
  return n
}

function sessionLoadsAny(s: SessionSummary, servers: string[]): boolean {
  for (const fqn of s.mcpInventory ?? []) {
    const seg = fqn.split('__')[1]
    if (seg && servers.includes(seg)) return true
  }
  for (const server of Object.keys(s.mcpBreakdown)) {
    if (servers.includes(server)) return true
  }
  return false
}

function countSessionsLoading(projects: ProjectSummary[], servers: string[]): number {
  return allSessions(projects).filter(s => sessionLoadsAny(s, servers)).length
}

// A kind whose realized effect is a token saving (everything except guard,
// which is a dollars/yield correlation, and out-of-scope kinds).
function isTokenKind(kind: ActionKind): boolean {
  return kind !== 'guard-install' && kind !== 'guard-uninstall' && kind !== 'model-default'
}

function confidenceFor(afterSessions: number, baseline: ActionBaseline, afterStart: Date, now: Date): 'low' | 'normal' {
  if (afterSessions < MIN_POST_WINDOW_SESSIONS) return 'low'
  if (baseline.sessions > 0 && baseline.windowDays > 0) {
    const afterDays = Math.max((now.getTime() - afterStart.getTime()) / DAY_MS, 1)
    const shift = (afterSessions / afterDays) / (baseline.sessions / baseline.windowDays)
    if (shift > VOLUME_SHIFT_FACTOR || shift < 1 / VOLUME_SHIFT_FACTOR) return 'low'
  }
  return 'normal'
}

// ---------------------------------------------------------------------------
// Per-kind realized deltas
// ---------------------------------------------------------------------------

function mcpRow(
  base: OptimizationReportRow, rec: ActionRecord, sessions: SessionSummary[],
  baseline: ActionBaseline, afterStart: Date, now: Date,
): OptimizationReportRow {
  const servers = Object.keys(baseline.metrics)
  const perSessionTokens = Object.values(baseline.metrics).reduce((a, b) => a + b, 0)
  if (servers.length === 0 || perSessionTokens === 0) return { ...base, note: 'not measurable: empty baseline' }
  if (sessions.length === 0) return { ...base, note: 'not measurable: no sessions in the window yet' }
  // Window-scaled estimate: what the fix would save if every window session
  // benefited. Realized differs from it only through still-loading sessions
  // (and the revert check), so the pair is derived from session counts, not
  // independently measured.
  const estimatedForWindow = Math.floor(perSessionTokens * sessions.length)
  const stillLoading = sessions.filter(s => sessionLoadsAny(s, servers)).length
  const confidence = confidenceFor(sessions.length, baseline, afterStart, now)
  if (rec.kind === 'mcp-remove' && stillLoading > 0) {
    return {
      ...base,
      estimatedForWindow,
      status: 'reverted',
      confidence,
      note: `reverted by user: ${servers.join(', ')} loaded again in ${stillLoading} post-apply session${stillLoading === 1 ? '' : 's'}`,
    }
  }
  const savedSessions = Math.max(0, sessions.length - stillLoading)
  return { ...base, estimatedForWindow, status: 'measured', realizedTokens: Math.floor(perSessionTokens * savedSessions), confidence }
}

function archiveRow(
  base: OptimizationReportRow, rec: ActionRecord, sessions: SessionSummary[],
  baseline: ActionBaseline, afterStart: Date, now: Date,
): OptimizationReportRow {
  const perSessionTokens = Object.values(baseline.metrics).reduce((a, b) => a + b, 0)
  if (perSessionTokens === 0) return { ...base, note: 'not measurable: empty baseline' }
  if (sessions.length === 0) return { ...base, note: 'not measurable: no sessions in the window yet' }
  const estimatedForWindow = Math.floor(perSessionTokens * sessions.length)
  const confidence = confidenceFor(sessions.length, baseline, afterStart, now)
  const restored = rec.changes.some(c => c.op === 'move' && existsSync(c.path))
  if (restored) {
    return { ...base, estimatedForWindow, status: 'reverted', confidence, note: 'reverted by user: an archived item was moved back into place' }
  }
  // Estimate and realized are the same product by construction; the measured
  // signal here is the session count and the revert check, not the multiply.
  return { ...base, estimatedForWindow, status: 'measured', realizedTokens: Math.floor(perSessionTokens * sessions.length), confidence }
}

function readEditRow(
  base: OptimizationReportRow, sessions: SessionSummary[],
  baseline: ActionBaseline, afterStart: Date, now: Date,
): OptimizationReportRow {
  const editsNow = countToolCalls(sessions, EDIT_TOOL_NAMES)
  const readsNow = countToolCalls(sessions, READ_TOOL_NAMES)
  const editsThen = baseline.metrics['edits'] ?? 0
  const readsThen = baseline.metrics['reads'] ?? 0
  if (editsThen <= 0 || editsNow <= 0) return { ...base, note: 'not measurable: not enough edit activity to compare' }
  const ratioThen = readsThen / editsThen
  const ratioNow = readsNow / editsNow
  // Detector estimate math: reads short of HEALTHY_READ_EDIT_RATIO per edit are
  // the retry-prone deficit. Credit only the reduction in that deficit, scaled
  // by current edits; a worsened ratio claims nothing.
  const deficitThen = Math.max(HEALTHY_READ_EDIT_RATIO - ratioThen, 0)
  const deficitNow = Math.max(HEALTHY_READ_EDIT_RATIO - ratioNow, 0)
  const realized = Math.floor(Math.max(0, deficitThen - deficitNow) * editsNow * AVG_TOKENS_PER_READ)
  // Same edits denominator as realized, so realized never exceeds it.
  const estimatedForWindow = Math.floor(deficitThen * editsNow * AVG_TOKENS_PER_READ)
  return {
    ...base,
    estimatedForWindow,
    status: 'measured',
    realizedTokens: realized,
    confidence: confidenceFor(sessions.length, baseline, afterStart, now),
    note: `read:edit ${ratioThen.toFixed(1)}:1 -> ${ratioNow.toFixed(1)}:1`,
  }
}

async function guardRow(
  base: OptimizationReportRow, afterStart: Date, now: Date,
  baseline: ActionBaseline, opts: OptimizationReportOptions,
): Promise<OptimizationReportRow> {
  const abandonedThen = baseline.metrics['abandonedPct']
  const avgThen = baseline.metrics['avgSessionCostUSD']
  if (abandonedThen === undefined || avgThen === undefined) {
    return { ...base, note: 'not measurable: no yield baseline captured at install time' }
  }
  const yieldFn = opts.computeYield ?? ((range: DateRange) => computeYield(range, opts.cwd ?? process.cwd()))
  let summary: YieldSummary
  try {
    summary = await yieldFn({ start: afterStart, end: now })
  } catch {
    return { ...base, note: 'not measurable: yield could not be computed for the post-apply window' }
  }
  const abandonedNow = summary.total.cost > 0 ? Math.round((summary.abandoned.cost / summary.total.cost) * 100) : 0
  const avgNow = summary.total.sessions > 0 ? summary.total.cost / summary.total.sessions : 0
  return {
    ...base,
    status: 'measured',
    confidence: summary.total.sessions < MIN_POST_WINDOW_SESSIONS ? 'low' : 'normal',
    note: 'correlation, not attribution',
    correlation: {
      abandonedPctThen: abandonedThen,
      abandonedPctNow: abandonedNow,
      avgSessionCostThenUSD: avgThen,
      avgSessionCostNowUSD: avgNow,
    },
  }
}

async function modelDefaultRow(
  base: OptimizationReportRow, rec: ActionRecord, sessions: SessionSummary[],
  baseline: ActionBaseline, afterStart: Date, now: Date, projectFound: boolean,
): Promise<OptimizationReportRow> {
  if (!projectFound) {
    return { ...base, note: 'not measurable: project not found in current data (path may have changed)' }
  }
  const models = Object.keys(baseline.metrics)
  if (models.length < 2) return { ...base, note: 'not measurable: invalid baseline' }
  const candidateModel = baseline.candidateModel ?? models[0]!
  const preApplyRate = baseline.metrics[candidateModel]
  if (preApplyRate === undefined) return { ...base, note: 'not measurable: invalid baseline' }

  const mockProject: ProjectSummary = {
    project: 'mock',
    projectPath: 'mock',
    totalCostUSD: 0,
    totalSavingsUSD: 0,
    totalApiCalls: 0,
    totalProxiedCostUSD: 0,
    sessions,
  }

  const { aggregateModelStats } = await import('../compare-stats.js')
  const stats = aggregateModelStats([mockProject]).find(s => s.model === candidateModel)

  if (!stats || stats.editTurns < 20) {
    return { ...base, note: `not measurable: < 20 edit turns for ${candidateModel} since apply` }
  }

  const postApplyRate = stats.oneShotTurns / stats.editTurns

  if (postApplyRate < preApplyRate - 0.05) {
    return {
      ...base,
      status: 'measured',
      realizedTokens: 0,
      confidence: 'low',
      note: `quality regression, consider undo: one-shot rate ${(preApplyRate * 100).toFixed(1)}% -> ${(postApplyRate * 100).toFixed(1)}%`
    }
  }

  return {
    ...base,
    status: 'measured',
    realizedTokens: 0,
    confidence: confidenceFor(sessions.length, baseline, afterStart, now),
    note: `correlation, not attribution: one-shot rate ${(preApplyRate * 100).toFixed(1)}% -> ${(postApplyRate * 100).toFixed(1)}%`
  }
}

async function computeRow(
  rec: ActionRecord, sessions: SessionSummary[], afterStart: Date, now: Date,
  opts: OptimizationReportOptions, modelDefaultProjectFound = true,
): Promise<OptimizationReportRow> {
  const estimatedAtApply = rec.baseline?.estimatedTokens ?? 0
  const base: OptimizationReportRow = {
    id: rec.id,
    appliedAt: rec.at,
    date: rec.at.slice(0, 10),
    kind: rec.kind,
    description: rec.description,
    estimatedAtApply,
    estimatedForWindow: estimatedAtApply,
    realizedTokens: 0,
    status: 'not-measurable',
    confidence: 'normal',
    note: '',
  }
  const baseline = rec.baseline
  if (!baseline) return { ...base, note: 'not measurable: no baseline captured at apply time' }

  if (MCP_KINDS.has(rec.kind)) return mcpRow(base, rec, sessions, baseline, afterStart, now)
  if (DEFER_KINDS.has(rec.kind)) {
    const measured = measureDeferAction(rec, sessions, baseline)
    return {
      ...base,
      ...measured,
      confidence: measured.status === 'measured' || measured.status === 'reverted'
        ? confidenceFor(sessions.length, baseline, afterStart, now)
        : base.confidence,
    }
  }
  if (rec.kind in ARCHIVE_DEF_TOKENS) return archiveRow(base, rec, sessions, baseline, afterStart, now)
  if (rec.kind === 'claude-md-rule') return readEditRow(base, sessions, baseline, afterStart, now)
  if (rec.kind === 'shell-config') return { ...base, note: 'not measurable: bash result token sizes are not retained in the summary' }
  if (rec.kind === 'guard-install') return guardRow(base, afterStart, now, baseline, opts)
  if (rec.kind === 'model-default') return modelDefaultRow(base, rec, sessions, baseline, afterStart, now, modelDefaultProjectFound)
  return { ...base, note: 'not measurable: kind is not tracked by optimization-actions report' }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

// Journal records are classified by the strict operation boundary before
// legacy optimization reporting.

export async function computeOptimizationReport(opts: OptimizationReportOptions = {}): Promise<OptimizationReport> {
  const now = opts.now ?? new Date()
  const rawRecords = await readRecordHistory(opts.actionsDir ?? defaultActionsDir())
  const currentRecords = rawRecords.filter(value => !isSupersededEngineRecord(value))
  const records = currentRecords.filter(isOptimizationRecord)
  const malformedRecords = currentRecords.length - records.length
  const active = records.filter(r => r.status === 'applied')

  const appliedByFinding: Record<string, string> = {}
  for (const r of active) {
    if (!r.findingId) continue
    const date = r.at.slice(0, 10)
    const prev = appliedByFinding[r.findingId]
    if (!prev || date < prev) appliedByFinding[r.findingId] = date
  }

  const empty: OptimizationReport = {
    generatedAt: now.toISOString(),
    windowCapDays: WINDOW_CAP_DAYS,
    costRate: 0,
    rows: [],
    totalRealizedTokens: 0,
    totalRealizedCostUSD: 0,
    measuredCount: 0,
    activeCount: active.length,
    observedDays: 0,
    malformedRecords,
    appliedByFinding,
  }

  const eligible = active.filter(r => ageDays(r.at, now) > REPORT_MIN_AGE_DAYS)
  if (eligible.length === 0) return empty

  const windowStart = new Date(now.getTime() - WINDOW_CAP_DAYS * DAY_MS)
  const loadProjects = opts.loadProjects ?? ((range: DateRange) => parseAllSessions(range, 'claude'))
  const projects = await loadProjects({ start: windowStart, end: now })
  const costRate = computeInputCostRate(projects)

  const rows: OptimizationReportRow[] = []
  for (const rec of eligible) {
    const afterStart = new Date(Math.max(new Date(rec.at).getTime(), windowStart.getTime()))
    const modelDefaultWindow = rec.kind === 'model-default'
      ? modelDefaultSessionsInWindow(rec, projects, afterStart, now)
      : undefined
    const sessions = modelDefaultWindow?.sessions ?? sessionsInWindow(projects, afterStart, now)
    rows.push(await computeRow(rec, sessions, afterStart, now, opts, modelDefaultWindow?.projectFound))
  }

  const measuredRows = rows.filter(r => r.status === 'measured' && isTokenKind(r.kind))
  const totalRealizedTokens = measuredRows.reduce((s, r) => s + r.realizedTokens, 0)
  const observedDays = Math.min(
    WINDOW_CAP_DAYS,
    measuredRows.reduce((mx, r) => Math.max(mx, Math.ceil(ageDays(r.appliedAt, now))), 0),
  )

  return {
    generatedAt: now.toISOString(),
    windowCapDays: WINDOW_CAP_DAYS,
    costRate,
    rows,
    totalRealizedTokens,
    totalRealizedCostUSD: totalRealizedTokens * costRate,
    measuredCount: measuredRows.length,
    activeCount: active.length,
    observedDays,
    malformedRecords,
    appliedByFinding,
  }
}

export function buildOptimizeAppliedHeader(report: OptimizationReport): string | null {
  // Under-claim: only normal-confidence measured rows feed the optimize line.
  // Low-confidence rows stay visible in `optimization-actions report` but never
  // in the header.
  const confident = report.rows.filter(r => r.status === 'measured' && isTokenKind(r.kind) && r.confidence === 'normal')
  if (confident.length === 0) return null
  const tokens = confident.reduce((s, r) => s + r.realizedTokens, 0)
  const generated = new Date(report.generatedAt)
  const days = Math.min(
    report.windowCapDays,
    confident.reduce((mx, r) => Math.max(mx, Math.ceil(ageDays(r.appliedAt, generated))), 0),
  )
  const cost = report.costRate > 0 ? ` (~${formatCost(tokens * report.costRate)})` : ''
  return `Applied fixes: ${report.activeCount} active, realized ~${formatTokens(tokens)} tokens${cost} over ${days} day${days === 1 ? '' : 's'}. Details: metrora optimization-actions report`
}

function realizedCell(r: OptimizationReportRow): string {
  if (r.status === 'reverted') return 'reverted'
  if (r.status === 'not-measurable') return 'not measurable'
  if (r.correlation) return `abandoned ${r.correlation.abandonedPctThen}% -> ${r.correlation.abandonedPctNow}% (corr.)`
  if (r.kind === 'model-default') return 'correlation'
  return formatTokens(r.realizedTokens)
}

function malformedNote(n: number): string {
  return `${n} malformed record${n === 1 ? '' : 's'} skipped`
}

export function renderOptimizationReport(report: OptimizationReport): string {
  if (report.rows.length === 0) {
    const lines = ['', '  No applied actions to measure yet.']
    if (report.activeCount > 0) {
      lines.push(`  ${report.activeCount} action${report.activeCount === 1 ? '' : 's'} applied; measurement starts after ${REPORT_MIN_AGE_DAYS} days.`)
    } else {
      lines.push('  Apply fixes with metrora optimize --apply, then check back after a few days.')
    }
    if (report.malformedRecords > 0) lines.push(`  ${malformedNote(report.malformedRecords)}.`)
    lines.push('')
    return lines.join('\n')
  }

  const rows = report.rows.map(r => [
    r.date,
    r.description,
    r.estimatedForWindow > 0 ? formatTokens(r.estimatedForWindow) : '-',
    realizedCell(r),
    r.status === 'measured' && isTokenKind(r.kind) ? r.confidence : '-',
  ])
  const totalCost = report.costRate > 0 ? ` (~${formatCost(report.totalRealizedCostUSD)})` : ''
  rows.push(['', 'Total realized', '', `${formatTokens(report.totalRealizedTokens)}${totalCost}`, ''])

  const table = renderTable(
    [{ header: 'Applied' }, { header: 'Action' }, { header: 'Estimated', right: true }, { header: 'Realized', right: true }, { header: 'Confidence' }],
    rows,
    { boldRows: new Set([rows.length - 1]) },
  )

  const details: string[] = []
  for (const r of report.rows) {
    if (r.status === 'measured' && isTokenKind(r.kind)) continue
    if (r.note) details.push(`  ${r.date} ${r.kind}: ${r.note}`)
    if (r.correlation) {
      details.push(`     avg session cost ${formatCost(r.correlation.avgSessionCostThenUSD)} -> ${formatCost(r.correlation.avgSessionCostNowUSD)}`)
    }
  }
  if (report.malformedRecords > 0) details.push(`  ${malformedNote(report.malformedRecords)}`)

  return ['', table, ...(details.length > 0 ? ['', ...details] : []), '', '  ' + HONEST_FOOTER, ''].join('\n')
}

export function buildOptimizationReportJson(report: OptimizationReport): unknown {
  return {
    generatedAt: report.generatedAt,
    windowCapDays: report.windowCapDays,
    malformedRecords: report.malformedRecords,
    actions: report.rows.map(r => {
      const tokenMeasured = r.status === 'measured' && isTokenKind(r.kind)
      return {
        id: r.id,
        date: r.date,
        kind: r.kind,
        description: r.description,
        estimatedAtApply: r.estimatedAtApply,
        estimatedForWindow: r.estimatedForWindow,
        realizedTokens: tokenMeasured ? r.realizedTokens : null,
        status: r.status,
        confidence: tokenMeasured ? r.confidence : null,
        note: r.note,
        ...(r.correlation ? { correlation: r.correlation } : {}),
      }
    }),
    totals: {
      realizedTokens: report.totalRealizedTokens,
      realizedCostUSD: report.totalRealizedCostUSD,
      measuredActions: report.measuredCount,
      activeActions: report.activeCount,
      observedDays: report.observedDays,
    },
    footer: HONEST_FOOTER,
  }
}
