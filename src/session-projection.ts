import type { ReasoningMix } from './reasoning-level.js'
import type { ProjectSummary, SessionSummary } from './types.js'
import { combineReasoningSemantics, reasoningSemanticsForProviders, reasoningTokenTotals, type ReasoningTokenSemantics } from './token-semantics.js'

/** A bounded, call-derived token timeline for the Desktop inspector. */
export type SessionTokenActivityPoint = {
  timestamp: string
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  additiveReasoningTokens: number
  totalTokens: number
}

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
  /** Exact call-level token activity, bucketed only when the series is large. */
  tokenActivity?: SessionTokenActivityPoint[]
  /// Exact session-level PR links already captured by the canonical parser.
  /// This is a bounded projection field; it is absent when no linkage exists.
  prLinks?: string[]
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

const TOKEN_ACTIVITY_POINT_LIMIT = 48

function nonNegativeFinite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function pointTotal(point: Omit<SessionTokenActivityPoint, 'totalTokens'>): number {
  return point.inputTokens + point.outputTokens + point.cacheReadTokens + point.cacheWriteTokens + point.additiveReasoningTokens
}

function bucketTokenActivity(points: SessionTokenActivityPoint[]): SessionTokenActivityPoint[] {
  if (points.length <= TOKEN_ACTIVITY_POINT_LIMIT) return points

  const bucketCount = Math.min(TOKEN_ACTIVITY_POINT_LIMIT, points.length)
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    timestamp: points[Math.floor(index * points.length / bucketCount)]?.timestamp ?? '',
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    additiveReasoningTokens: 0,
    totalTokens: 0,
  }))

  points.forEach((point, index) => {
    const bucket = buckets[Math.min(bucketCount - 1, Math.floor(index * bucketCount / points.length))]!
    bucket.calls += point.calls
    bucket.inputTokens += point.inputTokens
    bucket.outputTokens += point.outputTokens
    bucket.cacheReadTokens += point.cacheReadTokens
    bucket.cacheWriteTokens += point.cacheWriteTokens
    bucket.additiveReasoningTokens += point.additiveReasoningTokens
    bucket.totalTokens += point.totalTokens
  })
  return buckets
}

function sessionTokenActivity(
  session: SessionSummary,
  reasoning: { additiveReasoningTokens: number },
): SessionTokenActivityPoint[] | undefined {
  const calls = session.turns.flatMap(turn => turn.assistantCalls.map(call => ({ call, fallbackTimestamp: turn.timestamp })))
  if (calls.length === 0 || calls.length !== session.apiCalls) return undefined

  const points = calls
    .map(({ call, fallbackTimestamp }, index) => {
      const semantics = call.reasoningSemantics ?? reasoningSemanticsForProviders([call.provider])
      const additiveReasoningTokens = reasoningTokenTotals(call.usage?.reasoningTokens, semantics).additiveReasoningTokens
      const point = {
        timestamp: call.timestamp || fallbackTimestamp || '',
        calls: 1,
        inputTokens: nonNegativeFinite(call.usage?.inputTokens),
        outputTokens: nonNegativeFinite(call.usage?.outputTokens),
        cacheReadTokens: nonNegativeFinite(call.usage?.cacheReadInputTokens),
        cacheWriteTokens: nonNegativeFinite(call.usage?.cacheCreationInputTokens),
        additiveReasoningTokens,
      }
      return { ...point, totalTokens: pointTotal(point), index }
    })
    .sort((a, b) => {
      const aTime = Date.parse(a.timestamp)
      const bTime = Date.parse(b.timestamp)
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime
      if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1
      return a.index - b.index
    })
    .map(({ index: _index, ...point }) => point)

  const totals = points.reduce((sum, point) => ({
    inputTokens: sum.inputTokens + point.inputTokens,
    outputTokens: sum.outputTokens + point.outputTokens,
    cacheReadTokens: sum.cacheReadTokens + point.cacheReadTokens,
    cacheWriteTokens: sum.cacheWriteTokens + point.cacheWriteTokens,
    additiveReasoningTokens: sum.additiveReasoningTokens + point.additiveReasoningTokens,
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, additiveReasoningTokens: 0 })

  if (
    totals.inputTokens !== session.totalInputTokens
    || totals.outputTokens !== session.totalOutputTokens
    || totals.cacheReadTokens !== session.totalCacheReadTokens
    || totals.cacheWriteTokens !== session.totalCacheWriteTokens
    || totals.additiveReasoningTokens !== reasoning.additiveReasoningTokens
  ) return undefined

  return bucketTokenActivity(points)
}

export function aggregateSessions(projects: ProjectSummary[]): SessionRow[] {
  return projects.flatMap(project => project.sessions.map(session => {
    const projectName = session.project || project.project
    const provider = inferSessionProvider(session)
    const reasoning = reasoningDetails(session)
    const tokenActivity = sessionTokenActivity(session, reasoning)
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
      ...(tokenActivity ? { tokenActivity } : {}),
      ...(session.prLinks?.length ? { prLinks: [...session.prLinks] } : {}),
      startedAt: session.firstTimestamp,
      endedAt: session.lastTimestamp,
      durationMs: durationMs(session.firstTimestamp, session.lastTimestamp),
    }
  }))
}
