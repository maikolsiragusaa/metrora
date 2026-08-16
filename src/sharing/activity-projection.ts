import { createHash } from 'node:crypto'

import { periodInfoFromQuery, UsageQueryError } from '../cli-date.js'
import { parseAllSessions, isSessionHydrationComplete } from '../parser.js'
import { cleanSessionProjectLabel } from '../sessions-report.js'
import { buildPrAttribution, type PrRow } from '../sessions-report.js'
import { aggregateSessions, inferSessionProvider, type SessionRow } from '../session-projection.js'
import type { MenubarPayload } from '../menubar-json.js'
import type { ProjectRegistry } from '../project-registry.js'
import {
  assignedProjectId,
  filterProjectsByMetroraScope,
  sourceProjectIdForSummary,
} from '../project-scope.js'
import type { ProjectSummary, SessionSummary } from '../types.js'
import {
  ACTIVITY_PULL_REQUESTS_KIND,
  ACTIVITY_SESSIONS_KIND,
  ACTIVITY_CONTRACT_VERSION,
  activityQueryHash,
  decodeActivityCursor,
  encodeActivityCursor,
  type ActivityCoverageV1,
  type ActivityCursorBoundaryV1,
  type ActivityFreshnessV1,
  type ActivityOrderV1,
  type ActivityPullRequestV1,
  type ActivityPullRequestsPageV1,
  type ActivityQueryV1,
  type ActivityReasoningSemanticsV1,
  type ActivitySessionDetailPayloadV1,
  type ActivitySessionDetailV1,
  type ActivitySessionSummaryV1,
  type ActivitySessionsPageV1,
} from './activity-contract.js'

export type ActivityProjectionInput = {
  query: ActivityQueryV1
  projects: ProjectSummary[]
  registry: ProjectRegistry
  payload: MenubarPayload
}

const MAX_IDENTITY_VALUES = 8
const MAX_MODELS = 16
const MAX_PAGE_SIZE = 50
const MAX_SAFE_MICROS_USD = Number.MAX_SAFE_INTEGER
const GITHUB_PR_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)$/

type SessionEntry = {
  project: ProjectSummary
  session: SessionSummary
  row: SessionRow
  summary: ActivitySessionSummaryV1
  detail: ActivitySessionDetailV1
}

function safeCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value))
}

function micros(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(MAX_SAFE_MICROS_USD, Math.round(value * 1_000_000))
}

function safeText(value: string | undefined, max = 160): string {
  return (value ?? '').trim().slice(0, max)
}

function uniqueSafe(values: Array<string | undefined>, max = MAX_IDENTITY_VALUES): string[] {
  return [...new Set(values.map(value => safeText(value, 160)).filter(Boolean))].sort().slice(0, max)
}

function stableId(prefix: string, value: string): string {
  return createHash('sha256').update(`${prefix}:${value}`).digest('hex').slice(0, 40)
}

function sourceProjectName(project: ProjectSummary): string {
  const raw = (project.projectPath || project.project).trim().replace(/\\/g, '/')
  const leaf = raw.split('/').filter(Boolean).at(-1)
  return (leaf || cleanSessionProjectLabel(raw)).slice(0, 120) || 'Source Project'
}

function projectIdentity(project: ProjectSummary, registry: ProjectRegistry): { id: string; sourceId: string; name: string } {
  const sourceId = sourceProjectIdForSummary(project)
  return {
    id: assignedProjectId(registry, sourceId) ?? 'unassigned',
    sourceId,
    name: sourceProjectName(project),
  }
}

function callsFor(session: SessionSummary) {
  return session.turns.flatMap(turn => turn.assistantCalls)
}

function sessionMatches(project: ProjectSummary, session: SessionSummary, query: ActivityQueryV1): boolean {
  const calls = callsFor(session)
  // A provider filter must use explicit call provenance. `inferSessionProvider`
  // is useful for the canonical aggregate row, but its model fallback is not
  // strong enough to establish provider identity for a filtered projection.
  if (query.provider && !calls.some(call => call.provider === query.provider)) return false
  if (query.route && !calls.some(call => call.modelProvider === query.route)) return false
  if (query.source && sourceProjectIdForSummary(project) !== query.source) return false
  if (query.model && !Object.keys(session.modelBreakdown).includes(query.model)) return false
  return true
}

function projectSessions(projects: ProjectSummary[], query: ActivityQueryV1): ProjectSummary[] {
  const hasSessionFilter = Boolean(query.provider || query.route || query.source || query.model)
  if (!hasSessionFilter) return projects
  return projects.map(project => ({
    ...project,
    sessions: project.sessions.filter(session => sessionMatches(project, session, query)),
    subagentAnchors: project.subagentAnchors?.filter(session => sessionMatches(project, session, query)),
  })).filter(project => project.sessions.length > 0 || (project.subagentAnchors?.length ?? 0) > 0)
}

function reasoningSemantics(row: SessionRow): ActivityReasoningSemanticsV1 {
  return row.reasoningSemantics
}

function coverageForSession(session: SessionSummary, payload: MenubarPayload): {
  tokens: ActivityCoverageV1
  pricing: ActivityCoverageV1
} {
  const hasCalls = session.apiCalls > 0
  const tokenValue = session.totalInputTokens + session.totalOutputTokens + session.totalCacheReadTokens + session.totalCacheWriteTokens
  const hasTokenEvidence = !hasCalls || tokenValue > 0
  const tokens: ActivityCoverageV1 = !hasTokenEvidence
    ? 'unavailable'
    : (isSessionHydrationComplete() ? 'complete' : 'partial')
  const cost = session.totalCostUSD
  const estimated = session.totalEstimatedCostUSD ?? 0
  const hasPricingEvidence = !hasCalls || cost > 0 || estimated > 0
  const payloadCoverage = payload.current.projectDetailCoverage?.tokens
  const pricing: ActivityCoverageV1 = !hasPricingEvidence
    ? 'unavailable'
    : (estimated > 0 || payloadCoverage === 'partial' ? 'partial' : 'complete')
  return { tokens, pricing }
}

function modelBrandIds(session: SessionSummary, payload: MenubarPayload): string[] {
  const models = new Set(Object.keys(session.modelBreakdown))
  return uniqueSafe((payload.current.modelAccounting?.rows ?? [])
    .filter(row => row.brandId && models.has(row.name))
    .map(row => row.brandId!), MAX_IDENTITY_VALUES)
}

function buildEntry(
  project: ProjectSummary,
  session: SessionSummary,
  registry: ProjectRegistry,
  payload: MenubarPayload,
  canonicalRow?: SessionRow,
): SessionEntry {
  const identity = projectIdentity(project, registry)
  const provider = inferSessionProvider(session)
  const row = canonicalRow ?? aggregateSessions([project]).find(candidate =>
    candidate.sessionId === session.sessionId && candidate.project === (session.project || project.project) && candidate.provider === provider,
  )
  if (!row) throw new Error('session projection did not produce a canonical row')
  const coverage = coverageForSession(session, payload)
  const sessionKey = `${identity.id}:${identity.sourceId}:${session.sessionId}:${session.firstTimestamp}`
  const id = stableId('metrora-activity-session', sessionKey)
  const totalTokens = coverage.tokens === 'unavailable'
    ? null
    : safeCount(row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens)
  const summary: ActivitySessionSummaryV1 = {
    id,
    projectId: identity.id,
    sourceProjectId: identity.sourceId,
    sourceProjectName: identity.name,
    title: `Session · ${safeText(session.firstTimestamp, 32).slice(0, 10) || 'unknown date'}`,
    sourceIds: uniqueSafe(callsFor(session).map(call => call.provider)),
    routeIds: uniqueSafe(callsFor(session).map(call => call.modelProvider)),
    brandIds: modelBrandIds(session, payload),
    models: uniqueSafe(Object.keys(session.modelBreakdown), MAX_MODELS),
    costMicrosUsd: coverage.pricing === 'unavailable' ? null : micros(session.totalCostUSD),
    estimatedCostMicrosUsd: session.totalEstimatedCostUSD && session.totalEstimatedCostUSD > 0
      ? micros(session.totalEstimatedCostUSD)
      : null,
    calls: safeCount(session.apiCalls),
    turns: safeCount(session.turns.length),
    totalTokens,
    tokenCoverage: coverage.tokens,
    pricingCoverage: coverage.pricing,
    startedAt: safeText(session.firstTimestamp, 80),
    endedAt: safeText(session.lastTimestamp, 80),
  }
  const detail: ActivitySessionDetailV1 = {
    ...summary,
    durationMs: Number.isFinite(row.durationMs) && row.durationMs >= 0 ? Math.trunc(row.durationMs) : null,
    inputTokens: coverage.tokens === 'unavailable' ? null : safeCount(row.inputTokens),
    outputTokens: coverage.tokens === 'unavailable' ? null : safeCount(row.outputTokens),
    reasoningTokens: row.reasoningTokens === undefined ? null : safeCount(row.reasoningTokens),
    cacheReadTokens: coverage.tokens === 'unavailable' ? null : safeCount(row.cacheReadTokens),
    cacheWriteTokens: coverage.tokens === 'unavailable' ? null : safeCount(row.cacheWriteTokens),
    cacheReusePercent: cacheReusePercent(row),
    reasoningSemantics: reasoningSemantics(row),
    detailCoverage: coverage.tokens === 'unavailable' && coverage.pricing === 'unavailable'
      ? 'unavailable'
      : (coverage.tokens === 'complete' && coverage.pricing === 'complete' ? 'complete' : 'partial'),
  }
  return { project, session, row, summary, detail }
}

function cacheReusePercent(row: SessionRow): number | null {
  const denominator = row.inputTokens + row.cacheReadTokens
  if (denominator <= 0) return null
  return Math.round((row.cacheReadTokens / denominator) * 1000) / 10
}

function sessionBoundary(entry: SessionEntry, order: ActivityOrderV1): ActivityCursorBoundaryV1 {
  switch (order) {
    case 'cost':
      return { value: entry.summary.costMicrosUsd ?? -1, secondary: entry.summary.startedAt, id: entry.summary.id }
    case 'tokens':
      return { value: entry.summary.totalTokens ?? -1, secondary: entry.summary.startedAt, id: entry.summary.id }
    case 'calls':
      return { value: entry.summary.calls, secondary: entry.summary.startedAt, id: entry.summary.id }
    case 'newest':
    default:
      return { value: entry.summary.startedAt, secondary: entry.summary.endedAt, id: entry.summary.id }
  }
}

function compareValue(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a > b ? -1 : 1
  return String(a).localeCompare(String(b)) * -1
}

function compareBoundary(entry: SessionEntry, boundary: ActivityCursorBoundaryV1, order: ActivityOrderV1): number {
  const current = sessionBoundary(entry, order)
  const primary = compareValue(current.value, boundary.value)
  if (primary !== 0) return primary
  const secondary = compareValue(current.secondary, boundary.secondary)
  if (secondary !== 0) return secondary
  return current.id.localeCompare(boundary.id)
}

function sortSessions(entries: SessionEntry[], order: ActivityOrderV1): SessionEntry[] {
  return [...entries].sort((a, b) => compareBoundary(a, sessionBoundary(b, order), order))
}

function sessionCoverage(entries: SessionEntry[], payload: MenubarPayload, filtered: boolean): ActivityCoverageV1 {
  const durableCount = safeCount(payload.current.sessions)
  const availableCount = entries.length
  if (availableCount === 0 && durableCount > 0) return 'unavailable'
  if (!isSessionHydrationComplete()) return availableCount > 0 ? 'partial' : (durableCount > 0 ? 'unavailable' : 'complete')
  if (!filtered && durableCount > availableCount) return 'partial'
  return 'complete'
}

function activityFreshness(payload: MenubarPayload): ActivityFreshnessV1 {
  if (payload.freshness?.readMode === 'snapshot') return 'cached'
  if (payload.freshness?.readMode === 'fresh') return 'live'
  return 'unknown'
}

function pageStart<T>(items: T[], cursor: string | undefined, decode: () => ActivityCursorBoundaryV1, compare: (item: T, boundary: ActivityCursorBoundaryV1) => number): number {
  if (!cursor) return 0
  const boundary = decode()
  const index = items.findIndex(item => compare(item, boundary) > 0)
  return index < 0 ? items.length : index
}

function effectiveLimit(query: ActivityQueryV1): number {
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(query.limit)))
}

function filteredSessions(input: ActivityProjectionInput): { entries: SessionEntry[]; filtered: boolean } {
  const projects = projectSessions(activityProjectsForQuery(input.projects, input.registry, input.query), input.query)
  const filtered = Boolean(input.query.provider || input.query.route || input.query.source || input.query.model)
  const entries = projects.flatMap(project => {
    const rows = aggregateSessions([project])
    return project.sessions.map((session, index) => {
      const provider = inferSessionProvider(session)
      const row = rows.find(candidate =>
        candidate.sessionId === session.sessionId && candidate.project === (session.project || project.project) && candidate.provider === provider,
      ) ?? rows[index]
      return buildEntry(project, session, input.registry, input.payload, row)
    })
  })
  return { entries, filtered }
}

export function buildActivitySessionsPage(input: ActivityProjectionInput, cursor?: string): ActivitySessionsPageV1 {
  const { entries, filtered } = filteredSessions(input)
  const ordered = sortSessions(entries, input.query.order)
  const start = pageStart(
    ordered,
    cursor,
    () => {
      try {
        return decodeActivityCursor(input.query, ACTIVITY_SESSIONS_KIND, cursor!)
      } catch {
        throw new UsageQueryError('Invalid or mismatched Activity session cursor.')
      }
    },
    (item, boundary) => compareBoundary(item, boundary, input.query.order),
  )
  const limit = effectiveLimit(input.query)
  const page = ordered.slice(start, start + limit)
  const hasMore = start + limit < ordered.length
  const nextCursor = hasMore && page.length > 0
    ? encodeActivityCursor(input.query, ACTIVITY_SESSIONS_KIND, sessionBoundary(page[page.length - 1]!, input.query.order))
    : undefined
  const durableCount = safeCount(input.payload.current.sessions)
  const totalCount = filtered
    ? (isSessionHydrationComplete() ? ordered.length : null)
    : Math.max(durableCount, ordered.length)
  return {
    kind: ACTIVITY_SESSIONS_KIND,
    version: ACTIVITY_CONTRACT_VERSION,
    generatedAt: input.payload.generated,
    query: input.query,
    freshness: activityFreshness(input.payload),
    coverage: sessionCoverage(ordered, input.payload, filtered),
    totalCount,
    availableCount: ordered.length,
    hasMore,
    ...(nextCursor ? { nextCursor } : {}),
    sessions: page.map(entry => entry.summary),
  }
}

export function buildActivitySessionDetail(
  input: ActivityProjectionInput,
  id: string,
): ActivitySessionDetailPayloadV1 | null {
  const { entries } = filteredSessions(input)
  const entry = entries.find(candidate => candidate.summary.id === id)
  if (!entry) return null
  return {
    kind: 'metrora.companion.activity.session',
    version: ACTIVITY_CONTRACT_VERSION,
    generatedAt: input.payload.generated,
    query: input.query,
    freshness: activityFreshness(input.payload),
    session: entry.detail,
  }
}

function safePrIdentity(url: string): { reference: string; url?: string } {
  const match = GITHUB_PR_RE.exec(url)
  if (match) return { reference: `${match[1]}/${match[2]}#${match[3]}`, url }
  return { reference: `Pull request · ${stableId('metrora-activity-pr', url).slice(0, 10)}` }
}

function prId(url: string): string {
  return stableId('metrora-activity-pr', url)
}

function prCoverage(row: PrRow): ActivityCoverageV1 {
  if (!row.categories?.length) return 'unavailable'
  return row.approx ? 'partial' : 'complete'
}

function mapPullRequest(row: PrRow): ActivityPullRequestV1 {
  const identity = safePrIdentity(row.url)
  return {
    id: prId(row.url),
    ...identity,
    dateFrom: safeText(row.firstStarted, 80),
    dateTo: safeText(row.lastEnded, 80),
    costMicrosUsd: micros(row.cost),
    calls: safeCount(row.calls),
    linkedSessionCount: safeCount(row.sessions),
    models: uniqueSafe(row.models, MAX_MODELS),
    approximate: row.approx,
    categoryCoverage: prCoverage(row),
    ...(row.categories?.length ? {
      categories: row.categories.slice(0, 32).map(category => ({
        name: safeText(category.name, 120),
        costMicrosUsd: micros(category.cost),
      })),
    } : {}),
  }
}

function prBoundary(row: ActivityPullRequestV1, order: ActivityOrderV1): ActivityCursorBoundaryV1 {
  switch (order) {
    case 'calls': return { value: row.calls, secondary: row.dateTo, id: row.id }
    case 'tokens': return { value: row.calls, secondary: row.dateTo, id: row.id }
    case 'newest': return { value: row.dateTo, secondary: row.dateFrom, id: row.id }
    case 'cost':
    default: return { value: row.costMicrosUsd, secondary: row.dateTo, id: row.id }
  }
}

function comparePrBoundary(row: ActivityPullRequestV1, boundary: ActivityCursorBoundaryV1, order: ActivityOrderV1): number {
  const current = prBoundary(row, order)
  const primary = compareValue(current.value, boundary.value)
  if (primary !== 0) return primary
  const secondary = compareValue(current.secondary, boundary.secondary)
  if (secondary !== 0) return secondary
  return current.id.localeCompare(boundary.id)
}

function sortPullRequests(rows: ActivityPullRequestV1[], order: ActivityOrderV1): ActivityPullRequestV1[] {
  return [...rows].sort((a, b) => comparePrBoundary(a, prBoundary(b, order), order))
}

export function buildActivityPullRequestsPage(input: ActivityProjectionInput, cursor?: string): ActivityPullRequestsPageV1 {
  if (input.query.order === 'tokens') {
    throw new UsageQueryError('Pull Request Activity does not expose token ordering.')
  }
  const projects = projectSessions(activityProjectsForQuery(input.projects, input.registry, input.query), input.query)
  const attribution = buildPrAttribution(projects)
  const rows = sortPullRequests(attribution.rows.map(mapPullRequest), input.query.order)
  const start = pageStart(
    rows,
    cursor,
    () => {
      try {
        return decodeActivityCursor(input.query, ACTIVITY_PULL_REQUESTS_KIND, cursor!)
      } catch {
        throw new UsageQueryError('Invalid or mismatched Pull Request cursor.')
      }
    },
    (item, boundary) => comparePrBoundary(item, boundary, input.query.order),
  )
  const limit = effectiveLimit(input.query)
  const page = rows.slice(start, start + limit)
  const hasMore = start + limit < rows.length
  const nextCursor = hasMore && page.length > 0
    ? encodeActivityCursor(input.query, ACTIVITY_PULL_REQUESTS_KIND, prBoundary(page[page.length - 1]!, input.query.order))
    : undefined
  const coverage: ActivityCoverageV1 = attribution.totals.unattributedCost > 0 || rows.some(row => row.approximate)
    ? 'partial'
    : (rows.length > 0 ? 'complete' : 'complete')
  return {
    kind: ACTIVITY_PULL_REQUESTS_KIND,
    version: ACTIVITY_CONTRACT_VERSION,
    generatedAt: input.payload.generated,
    query: input.query,
    freshness: activityFreshness(input.payload),
    coverage,
    attributedCostMicrosUsd: micros(attribution.totals.attributedCost),
    unattributedCostMicrosUsd: micros(attribution.totals.unattributedCost),
    totalCount: rows.length,
    availableCount: rows.length,
    hasMore,
    ...(nextCursor ? { nextCursor } : {}),
    pullRequests: page,
  }
}

export type ActivityProjectionBuilders = {
  sessions: ActivitySessionsPageV1
  pullRequests: ActivityPullRequestsPageV1
}

export function buildActivityProjection(input: ActivityProjectionInput, cursors: { sessions?: string; pullRequests?: string } = {}): ActivityProjectionBuilders {
  return {
    sessions: buildActivitySessionsPage(input, cursors.sessions),
    pullRequests: buildActivityPullRequestsPage(input, cursors.pullRequests),
  }
}

export function activityProjectionQueryFingerprint(query: ActivityQueryV1, kind: string): string {
  return activityQueryHash(query, kind)
}

export function activityPeriodQuery(query: {
  period?: string
  from?: string
  to?: string
}): { range: { start: Date; end: Date }; label: string } {
  return periodInfoFromQuery(query, 'month')
}

export function activityProjectsForQuery(
  projects: ProjectSummary[],
  registry: ProjectRegistry,
  query: ActivityQueryV1,
): ProjectSummary[] {
  return filterProjectsByMetroraScope(projects, registry, query.projectScopeId)
}
