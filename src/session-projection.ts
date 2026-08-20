import type { ReasoningMix } from './reasoning-level.js'
import type { ProjectSummary, SessionSummary } from './types.js'
import { combineReasoningSemantics, reasoningSemanticsForProviders, reasoningTokenTotals, type ReasoningTokenSemantics } from './token-semantics.js'

export type SessionRow = {
  sessionId: string
  /** Provider + exact id + project/source authority; never raw id alone. */
  sessionKey: string
  title: string
  project: string
  provider: string
  models: string[]
  cost: number
  savingsUSD: number
  calls: number
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens?: number
  additiveReasoningTokens?: number
  reasoningSemantics: ReasoningTokenSemantics
  reasoningMix?: ReasoningMix
  startedAt: string
  endedAt: string
  durationMs: number
}

export function inferSessionProvider(session: SessionSummary): string {
  for (const turn of session.turns) {
    const provider = turn.assistantCalls[0]?.provider
    if (provider) return provider
  }

  const models = Object.keys(session.modelBreakdown)
  const model = models[0]?.toLowerCase() ?? ''
  if (model.startsWith('claude')) return 'claude'
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) return 'codex'
  if (model.startsWith('gemini')) return 'gemini'
  if (model.includes('/')) return model.split('/', 1)[0] || 'unknown'
  return 'unknown'
}

function durationMs(startedAt: string, endedAt: string): number {
  const duration = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  return Number.isFinite(duration) ? duration : 0
}

function sessionAuthority(session: SessionSummary, project: string): string {
  return session.source?.path || session.workingDirectory || project
}

function sessionKey(session: SessionSummary, project: string, provider: string): string {
  return [provider, session.sessionId, project, sessionAuthority(session, project)].join('\u0000')
}

function reasoningDetails(session: SessionSummary): { semantics: ReasoningTokenSemantics; reasoningTokens: number; additiveReasoningTokens: number } {
  const values = session.turns.flatMap(turn => turn.assistantCalls.map(call =>
    call.reasoningSemantics ?? reasoningSemanticsForProviders([call.provider]),
  ))
  const semantics = combineReasoningSemantics(values)
  const totals = session.turns.reduce((sum, turn) => turn.assistantCalls.reduce((calls, call) => {
    const callTotals = reasoningTokenTotals(
      call.usage?.reasoningTokens,
      call.reasoningSemantics ?? reasoningSemanticsForProviders([call.provider]),
    )
    return {
      observedReasoningTokens: calls.observedReasoningTokens + callTotals.observedReasoningTokens,
      additiveReasoningTokens: calls.additiveReasoningTokens + callTotals.additiveReasoningTokens,
    }
  }, sum), { observedReasoningTokens: 0, additiveReasoningTokens: 0 })
  return { semantics, reasoningTokens: totals.observedReasoningTokens, additiveReasoningTokens: totals.additiveReasoningTokens }
}

export function aggregateSessions(projects: ProjectSummary[]): SessionRow[] {
  return projects.flatMap(project => project.sessions.map(session => {
    const projectName = session.project || project.project
    const provider = inferSessionProvider(session)
    const reasoning = reasoningDetails(session)
    return {
      sessionId: session.sessionId,
      sessionKey: sessionKey(session, projectName, provider),
      title: session.title ?? '',
      project: projectName,
      provider,
      models: Object.keys(session.modelBreakdown),
      cost: session.totalCostUSD,
      savingsUSD: session.totalSavingsUSD,
      calls: session.apiCalls,
      turns: session.turns.length,
      inputTokens: session.totalInputTokens,
      outputTokens: session.totalOutputTokens,
      cacheReadTokens: session.totalCacheReadTokens,
      cacheWriteTokens: session.totalCacheWriteTokens,
      ...(reasoning.semantics !== 'unavailable' ? { reasoningTokens: reasoning.reasoningTokens } : {}),
      ...(reasoning.semantics !== 'unavailable' ? { additiveReasoningTokens: reasoning.additiveReasoningTokens } : {}),
      reasoningSemantics: reasoning.semantics,
      ...(session.reasoningMix ? { reasoningMix: session.reasoningMix } : {}),
      startedAt: session.firstTimestamp,
      endedAt: session.lastTimestamp,
      durationMs: durationMs(session.firstTimestamp, session.lastTimestamp),
    }
  }))
}
