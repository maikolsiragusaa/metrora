import type { DateRange, ProjectSummary, SessionSummary } from '../types.js'
import type { ActionBaseline, ActionKind } from './types.js'
import type { FindingPlan } from './plans.js'
import {
  EDIT_TOOL_NAMES,
  READ_TOOL_NAMES,
  TOKENS_PER_MCP_TOOL,
  TOOLS_PER_MCP_SERVER,
  aggregateMcpCoverage,
  type McpServerCoverage,
  type WasteFinding,
} from '../optimize.js'
import { parseAllSessions } from '../parser.js'
import { computeYield, type YieldSummary } from '../yield.js'
import { DEFER_KINDS, captureDeferBaseline } from './defer-report.js'
import { ARCHIVE_DEF_TOKENS, MCP_KINDS } from './report-policy.js'

const DAY_MS = 24 * 60 * 60 * 1000
const BASELINE_WINDOW_DAYS = 14

type CaptureCtx = {
  projects: ProjectSummary[]
  coverage: McpServerCoverage[]
  windowDays: number
  now: Date
}

function allSessions(projects: ProjectSummary[]): SessionSummary[] {
  return projects.flatMap(project => project.sessions)
}

function countToolCalls(sessions: SessionSummary[], names: ReadonlySet<string>): number {
  let count = 0
  for (const session of sessions) {
    for (const [tool, data] of Object.entries(session.toolBreakdown)) {
      if (names.has(tool)) count += data.calls
    }
  }
  return count
}

function countBashCalls(sessions: SessionSummary[]): number {
  let count = 0
  for (const session of sessions) {
    for (const data of Object.values(session.bashBreakdown)) count += data.calls
  }
  return count
}

function sessionLoadsAny(session: SessionSummary, servers: string[]): boolean {
  for (const fqn of session.mcpInventory ?? []) {
    const segment = fqn.split('__')[1]
    if (segment && servers.includes(segment)) return true
  }
  for (const server of Object.keys(session.mcpBreakdown)) {
    if (servers.includes(server)) return true
  }
  return false
}

function countSessionsLoading(projects: ProjectSummary[], servers: string[]): number {
  return allSessions(projects).filter(session => sessionLoadsAny(session, servers)).length
}

function mcpServersFromApply(finding: WasteFinding): string[] {
  if (finding.apply?.kind === 'mcp-remove') return finding.apply.servers
  if (finding.apply?.kind === 'mcp-project-scope') return finding.apply.servers.map(server => server.server)
  return []
}

function needsConfigBaseline(kind: ActionKind): boolean {
  return MCP_KINDS.has(kind) || DEFER_KINDS.has(kind) || kind in ARCHIVE_DEF_TOKENS || kind === 'claude-md-rule' || kind === 'shell-config'
}

export function captureBaseline(finding: WasteFinding, kind: ActionKind, ctx: CaptureCtx): ActionBaseline | undefined {
  const common = {
    windowDays: ctx.windowDays,
    capturedAt: ctx.now.toISOString(),
    estimatedTokens: Math.max(0, Math.round(finding.tokensSaved)),
  }

  if (MCP_KINDS.has(kind)) {
    const servers = mcpServersFromApply(finding)
    if (servers.length === 0) return undefined
    const coverageByServer = new Map(ctx.coverage.map(coverage => [coverage.server, coverage]))
    const metrics: Record<string, number> = {}
    for (const server of servers) {
      const coverage = coverageByServer.get(server)
      const tools = coverage && coverage.toolsAvailable > 0 ? coverage.toolsAvailable : TOOLS_PER_MCP_SERVER
      metrics[server] = tools * TOKENS_PER_MCP_TOOL
    }
    return { ...common, sessions: countSessionsLoading(ctx.projects, servers), metrics }
  }

  if (DEFER_KINDS.has(kind)) return captureDeferBaseline(finding, ctx)

  const definitionTokens = ARCHIVE_DEF_TOKENS[kind]
  if (definitionTokens !== undefined) {
    const names = finding.apply?.kind === 'archive' ? finding.apply.names : []
    if (names.length === 0) return undefined
    const metrics: Record<string, number> = {}
    for (const name of names) metrics[name] = definitionTokens
    return { ...common, sessions: allSessions(ctx.projects).length, metrics }
  }

  const sessions = allSessions(ctx.projects)
  if (kind === 'claude-md-rule') {
    return { ...common, sessions: sessions.length, metrics: { reads: countToolCalls(sessions, READ_TOOL_NAMES), edits: countToolCalls(sessions, EDIT_TOOL_NAMES) } }
  }
  if (kind === 'shell-config') {
    return { ...common, sessions: sessions.length, metrics: { calls: countBashCalls(sessions) } }
  }
  return undefined
}

export async function captureBaselinesForPlans(
  plans: FindingPlan[],
  opts: { now?: Date; loadProjects?: (range: DateRange) => Promise<ProjectSummary[]> } = {},
): Promise<void> {
  const applicable = plans.filter(plan => plan.plan && needsConfigBaseline(plan.plan.kind))
  if (applicable.length === 0) return
  const now = opts.now ?? new Date()
  const start = new Date(now.getTime() - BASELINE_WINDOW_DAYS * DAY_MS)
  const loadProjects = opts.loadProjects ?? ((range: DateRange) => parseAllSessions(range, 'claude'))
  const projects = await loadProjects({ start, end: now })
  const ctx: CaptureCtx = { projects, coverage: aggregateMcpCoverage(projects), windowDays: BASELINE_WINDOW_DAYS, now }
  for (const plan of applicable) {
    const baseline = captureBaseline(plan.finding, plan.plan!.kind, ctx)
    if (baseline) plan.plan!.baseline = baseline
  }
}

export async function captureGuardBaseline(
  opts: { now?: Date; cwd?: string; computeYield?: (range: DateRange) => Promise<YieldSummary> } = {},
): Promise<ActionBaseline | undefined> {
  const now = opts.now ?? new Date()
  const range = { start: new Date(now.getTime() - BASELINE_WINDOW_DAYS * DAY_MS), end: now }
  const yieldFn = opts.computeYield ?? ((value: DateRange) => computeYield(value, opts.cwd ?? process.cwd()))
  let summary: YieldSummary
  try {
    summary = await yieldFn(range)
  } catch {
    return undefined
  }
  return {
    windowDays: BASELINE_WINDOW_DAYS,
    capturedAt: now.toISOString(),
    estimatedTokens: 0,
    sessions: summary.total.sessions,
    metrics: {
      abandonedPct: summary.total.cost > 0 ? Math.round((summary.abandoned.cost / summary.total.cost) * 100) : 0,
      avgSessionCostUSD: summary.total.sessions > 0 ? summary.total.cost / summary.total.sessions : 0,
    },
  }
}
