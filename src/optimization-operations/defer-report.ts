import {
  TOKENS_PER_MCP_TOOL,
  TOOLS_PER_MCP_SERVER,
  type McpServerCoverage,
  type WasteFinding,
} from '../optimize.js'
import type { ProjectSummary, SessionSummary } from '../types.js'
import type { ActionBaseline, ActionKind, ActionRecord } from './types.js'

export const DEFER_KINDS = new Set<ActionKind>(['defer-enable', 'defer-alwaysload', 'defer-threshold'])

export type DeferMeasurement = {
  estimatedForWindow: number
  realizedTokens: number
  status: 'measured' | 'reverted' | 'not-measurable'
  note: string
}

type CaptureCtx = {
  projects: ProjectSummary[]
  coverage: McpServerCoverage[]
  windowDays: number
  now: Date
}

function allSessions(projects: ProjectSummary[]): SessionSummary[] {
  return projects.flatMap(project => project.sessions)
}

function sessionLoadsAny(session: SessionSummary, servers: ReadonlySet<string>): boolean {
  for (const fqn of session.mcpInventory ?? []) {
    const server = fqn.split('__')[1]
    if (server && servers.has(server)) return true
  }
  for (const server of Object.keys(session.mcpBreakdown)) {
    if (servers.has(server)) return true
  }
  return false
}

function observedMcpServers(projects: ProjectSummary[]): string[] {
  const servers = new Set<string>()
  for (const session of allSessions(projects)) {
    for (const fqn of session.mcpInventory ?? []) {
      const server = fqn.split('__')[1]
      if (server) servers.add(server)
    }
    for (const server of Object.keys(session.mcpBreakdown)) servers.add(server)
  }
  return [...servers]
}

function sessionHasDeferralActive(session: SessionSummary): boolean {
  return (session.mcpInventory?.length ?? 0) > 0
}

function sessionHasDeferredServer(session: SessionSummary, servers: ReadonlySet<string>): boolean {
  for (const fqn of session.mcpInventory ?? []) {
    const server = fqn.split('__')[1]
    if (server && servers.has(server)) return true
  }
  return false
}

/**
 * Measure post-apply MCP deferral from source-bound session evidence.
 *
 * This is not independently metered token savings. `mcpInventory` is populated
 * from Claude deferred-tools evidence; the baseline supplies the estimated
 * prefix-token footprint. A narrow `defer-alwaysload` action only earns credit
 * when one of its targeted servers appears in deferred inventory.
 */
export function measureDeferAction(
  record: ActionRecord,
  sessions: SessionSummary[],
  baseline: ActionBaseline,
): DeferMeasurement {
  const servers = Object.keys(baseline.metrics)
  const perSessionTokens = Object.values(baseline.metrics).reduce((sum, value) => sum + value, 0)
  if (servers.length === 0 || perSessionTokens === 0) {
    return {
      estimatedForWindow: baseline.estimatedTokens,
      realizedTokens: 0,
      status: 'not-measurable',
      note: 'not measurable: empty baseline',
    }
  }
  if (sessions.length === 0) {
    return {
      estimatedForWindow: baseline.estimatedTokens,
      realizedTokens: 0,
      status: 'not-measurable',
      note: 'not measurable: no sessions in the window yet',
    }
  }

  const estimatedForWindow = Math.floor(perSessionTokens * sessions.length)
  const targetServers = new Set(servers)
  const activeSessions = record.kind === 'defer-alwaysload'
    ? sessions.filter(session => sessionHasDeferredServer(session, targetServers)).length
    : sessions.filter(sessionHasDeferralActive).length

  if (activeSessions === 0) {
    const subject = record.kind === 'defer-alwaysload' ? 'targeted server deferral' : 'deferral'
    return {
      estimatedForWindow,
      realizedTokens: 0,
      status: 'reverted',
      note: `not yet observed: ${subject} remains inactive in ${sessions.length} post-apply session${sessions.length === 1 ? '' : 's'}; the client may not have restarted or the change may have been reverted`,
    }
  }

  const subject = record.kind === 'defer-alwaysload' ? 'targeted server deferral' : 'deferral'
  return {
    estimatedForWindow,
    realizedTokens: Math.floor(perSessionTokens * activeSessions),
    status: 'measured',
    note: `observed ${subject} active in ${activeSessions}/${sessions.length} post-apply session${sessions.length === 1 ? '' : 's'}; derived from session evidence, not independently metered`,
  }
}

function deferServers(finding: WasteFinding, projects: ProjectSummary[]): string[] {
  if (finding.apply?.kind === 'defer-alwaysload') {
    return finding.apply.servers.map(server => server.server)
  }
  return observedMcpServers(projects)
}

export function captureDeferBaseline(
  finding: WasteFinding,
  ctx: CaptureCtx,
): ActionBaseline | undefined {
  const servers = deferServers(finding, ctx.projects)
  if (servers.length === 0) return undefined

  const coverageByServer = new Map(ctx.coverage.map(item => [item.server, item]))
  const metrics: Record<string, number> = {}
  for (const server of servers) {
    const coverage = coverageByServer.get(server)
    const tools = coverage && coverage.toolsAvailable > 0
      ? coverage.toolsAvailable
      : TOOLS_PER_MCP_SERVER
    metrics[server] = tools * TOKENS_PER_MCP_TOOL
  }

  const targetServers = new Set(servers)
  const sessions = allSessions(ctx.projects).filter(session => sessionLoadsAny(session, targetServers)).length
  return {
    windowDays: ctx.windowDays,
    capturedAt: ctx.now.toISOString(),
    estimatedTokens: Math.max(0, Math.round(finding.tokensSaved)),
    sessions,
    metrics,
  }
}
