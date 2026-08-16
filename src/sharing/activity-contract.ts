import { createHash } from 'node:crypto'

export const ACTIVITY_SESSIONS_KIND = 'metrora.companion.activity.sessions' as const
export const ACTIVITY_PULL_REQUESTS_KIND = 'metrora.companion.activity.pullRequests' as const
export const ACTIVITY_CONTRACT_VERSION = 1 as const

export type ActivityOrderV1 = 'newest' | 'cost' | 'tokens' | 'calls'
export type ActivityCoverageV1 = 'complete' | 'partial' | 'unavailable'
export type ActivityFreshnessV1 = 'live' | 'cached' | 'unknown'
export type ActivityReasoningSemanticsV1 = 'separate' | 'aggregate-output' | 'unavailable' | 'mixed'

export type ActivityQueryV1 = {
  period: string
  projectScopeId: string
  effectiveFrom: string
  effectiveTo: string
  provider?: string
  route?: string
  model?: string
  /** Stable Source Project identity (`sp_...`), never a display label. */
  source?: string
  order: ActivityOrderV1
  limit: number
}

export type ActivitySessionSummaryV1 = {
  id: string
  projectId: string
  /** Stable Source Project identity used for filtering; never a display label or path. */
  sourceProjectId: string
  /** Safe display label for the Source Project identity. */
  sourceProjectName: string
  /** Always metadata-only. User-authored session titles never cross this boundary. */
  title: string
  sourceIds: string[]
  routeIds: string[]
  brandIds: string[]
  models: string[]
  /** Null when the canonical authority cannot support a priced value. */
  costMicrosUsd: number | null
  estimatedCostMicrosUsd: number | null
  calls: number
  turns: number
  totalTokens: number | null
  tokenCoverage: ActivityCoverageV1
  pricingCoverage: ActivityCoverageV1
  startedAt: string
  endedAt: string
}

export type ActivitySessionDetailV1 = ActivitySessionSummaryV1 & {
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  cacheReusePercent: number | null
  reasoningSemantics: ActivityReasoningSemanticsV1
  detailCoverage: ActivityCoverageV1
}

export type ActivitySessionsPageV1 = {
  kind: typeof ACTIVITY_SESSIONS_KIND
  version: typeof ACTIVITY_CONTRACT_VERSION
  desktopId?: string
  generatedAt: string
  query: ActivityQueryV1
  freshness: ActivityFreshnessV1
  coverage: ActivityCoverageV1
  /** Null means the canonical authority cannot prove a filtered total. */
  totalCount: number | null
  /** Number of matching surviving metadata rows represented by this authority read. */
  availableCount: number
  hasMore: boolean
  nextCursor?: string
  sessions: ActivitySessionSummaryV1[]
}

export type ActivitySessionDetailPayloadV1 = {
  kind: 'metrora.companion.activity.session'
  version: typeof ACTIVITY_CONTRACT_VERSION
  desktopId?: string
  generatedAt: string
  query: ActivityQueryV1
  freshness: ActivityFreshnessV1
  session: ActivitySessionDetailV1
}

export type ActivityPullRequestV1 = {
  id: string
  /** Safe display reference, never an arbitrary raw URL. */
  reference: string
  /** Present only for canonical GitHub pull-request URLs. */
  url?: string
  dateFrom: string
  dateTo: string
  costMicrosUsd: number
  calls: number
  linkedSessionCount: number
  models: string[]
  approximate: boolean
  categoryCoverage: ActivityCoverageV1
  categories?: Array<{ name: string; costMicrosUsd: number }>
}

export type ActivityPullRequestsPageV1 = {
  kind: typeof ACTIVITY_PULL_REQUESTS_KIND
  version: typeof ACTIVITY_CONTRACT_VERSION
  desktopId?: string
  generatedAt: string
  query: ActivityQueryV1
  freshness: ActivityFreshnessV1
  coverage: ActivityCoverageV1
  attributedCostMicrosUsd: number
  unattributedCostMicrosUsd: number
  totalCount: number
  availableCount: number
  hasMore: boolean
  nextCursor?: string
  pullRequests: ActivityPullRequestV1[]
}

export type ActivityCursorBoundaryV1 = {
  value: number | string
  secondary: string
  id: string
}

type ActivityCursorV1 = {
  version: 1
  queryHash: string
  boundary: ActivityCursorBoundaryV1
}

const MAX_CURSOR_LENGTH = 768

/** The cursor binds transport state to every semantic query dimension. */
export function activityQueryHash(query: ActivityQueryV1, kind: string): string {
  const canonical = JSON.stringify({
    kind,
    period: query.period,
    projectScopeId: query.projectScopeId,
    effectiveFrom: query.effectiveFrom,
    effectiveTo: query.effectiveTo,
    provider: query.provider ?? null,
    route: query.route ?? null,
    model: query.model ?? null,
    source: query.source ?? null,
    order: query.order,
    limit: query.limit,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export function encodeActivityCursor(
  query: ActivityQueryV1,
  kind: string,
  boundary: ActivityCursorBoundaryV1,
): string {
  const value: ActivityCursorV1 = {
    version: 1,
    queryHash: activityQueryHash(query, kind),
    boundary,
  }
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function decodeActivityCursor(
  query: ActivityQueryV1,
  kind: string,
  encoded: string,
): ActivityCursorBoundaryV1 {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > MAX_CURSOR_LENGTH) {
    throw new Error('invalid activity cursor')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new Error('invalid activity cursor')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid activity cursor')
  const cursor = parsed as Partial<ActivityCursorV1>
  if (cursor.version !== 1 || cursor.queryHash !== activityQueryHash(query, kind)) {
    throw new Error('activity cursor does not match query')
  }
  const boundary = cursor.boundary
  if (typeof boundary !== 'object' || boundary === null || Array.isArray(boundary)) throw new Error('invalid activity cursor')
  const value = (boundary as Partial<ActivityCursorBoundaryV1>).value
  const secondary = (boundary as Partial<ActivityCursorBoundaryV1>).secondary
  const id = (boundary as Partial<ActivityCursorBoundaryV1>).id
  if (!((typeof value === 'string' && value.length <= 240) || (typeof value === 'number' && Number.isFinite(value))) ||
    typeof secondary !== 'string' || secondary.length > 240 ||
    typeof id !== 'string' || id.length === 0 || id.length > 120) {
    throw new Error('invalid activity cursor')
  }
  return { value, secondary, id }
}
