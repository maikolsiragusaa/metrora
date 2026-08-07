import {
  TOKENS_PER_MCP_TOOL,
  TOOLS_PER_MCP_SERVER,
  TOKENS_PER_SKILL_DEF,
  TOKENS_PER_AGENT_DEF,
  TOKENS_PER_COMMAND_DEF,
} from '../optimize.js'
import type { McpServerCoverage, WasteFinding } from '../optimize.js'
import type { ProjectSummary, SessionSummary } from '../types.js'
import type { ActionBaseline, ActionKind, ActionRecord } from './types.js'

export const HONEST_FOOTER =
  'Estimates are scaled to the measured window for comparability; the at-apply estimate is kept in --json. '
  + 'MCP, defer and archive realized figures are derived from per-session baselines times observed session state, not independently metered token deltas. '
  + 'Each fix measures only its own metric; effects are never attributed across signals. '
  + 'Guard rows are correlation, not attribution. Realized numbers are rounded down.'

export const MCP_KINDS = new Set<ActionKind>(['mcp-remove', 'mcp-project-scope'])

export const ARCHIVE_DEF_TOKENS: Partial<Record<ActionKind, number>> = {
  'archive-skill': TOKENS_PER_SKILL_DEF,
  'archive-agent': TOKENS_PER_AGENT_DEF,
  'archive-command': TOKENS_PER_COMMAND_DEF,
}

export type BaselineCaptureContext = {
  projects: ProjectSummary[]
  coverage: McpServerCoverage[]
  windowDays: number
  now: Date
}

function allSessions(projects: ProjectSummary[]): SessionSummary[] {
  return projects.flatMap(project => project.sessions)
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

function mcpServersFromApply(finding: WasteFinding): string[] {
  if (finding.apply?.kind === 'mcp-remove') return finding.apply.servers
  if (finding.apply?.kind === 'mcp-project-scope') return finding.apply.servers.map(server => server.server)
  return []
}

export function captureMcpBaseline(
  finding: WasteFinding,
  recordKind: ActionRecord['kind'],
  context: BaselineCaptureContext,
): ActionBaseline | undefined {
  if (!MCP_KINDS.has(recordKind)) return undefined
  const servers = mcpServersFromApply(finding)
  if (servers.length === 0) return undefined
  const coverageByServer = new Map(context.coverage.map(item => [item.server, item]))
  const metrics: Record<string, number> = {}
  for (const server of servers) {
    const coverage = coverageByServer.get(server)
    const tools = coverage && coverage.toolsAvailable > 0 ? coverage.toolsAvailable : TOOLS_PER_MCP_SERVER
    metrics[server] = tools * TOKENS_PER_MCP_TOOL
  }
  return {
    windowDays: context.windowDays,
    capturedAt: context.now.toISOString(),
    estimatedTokens: Math.max(0, Math.round(finding.tokensSaved)),
    sessions: allSessions(context.projects).filter(session => sessionLoadsAny(session, servers)).length,
    metrics,
  }
}
