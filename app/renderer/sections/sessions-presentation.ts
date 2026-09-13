import { formatCompact, formatDayLong, formatUsd, shortenProjectPath } from '../lib/format'
import { cacheReuseMultiple, cacheShare, costPerMillionTotal, formatReuseMultiple, totalTokenCount } from '../lib/usageMetrics'
import type { ReasoningLevelOrUnknown, ReasoningMix, SessionRow } from '../lib/types'

export const SESSION_PAGE_SIZE = 30

export type SessionSort = 'recent' | 'cost' | 'tokens' | 'calls' | 'cache' | 'unitCost' | 'duration'

/** Every table column that can drive row order, including per-token columns. */
export type SessionSortKey = SessionSort | 'turns' | 'input' | 'output' | 'cacheRead' | 'cacheWrite'

export type SessionSortDirection = 'desc' | 'asc'

export type SessionColumnSort = { key: SessionSortKey; direction: SessionSortDirection }

/** The column each legacy sort lens lands on when sorting from the headers. */
export const DEFAULT_SORT_DIRECTION: SessionSortDirection = 'desc'

export const SORT_OPTIONS = [
  { value: 'recent', label: 'Recent' },
  { value: 'cost', label: 'Cost' },
  { value: 'tokens', label: 'Total tokens' },
  { value: 'calls', label: 'Calls' },
  { value: 'cache', label: 'Cache reuse' },
  { value: 'unitCost', label: 'Cost/1M' },
  { value: 'duration', label: 'Duration' },
]

export const SORT_ANNOUNCEMENTS: Record<SessionSortKey, { desc: string; asc: string }> = {
  recent: { desc: 'most recent', asc: 'least recent' },
  cost: { desc: 'highest cost', asc: 'lowest cost' },
  tokens: { desc: 'most total tokens', asc: 'least total tokens' },
  calls: { desc: 'highest call count', asc: 'lowest call count' },
  cache: { desc: 'highest cache reuse', asc: 'lowest cache reuse' },
  unitCost: { desc: 'highest cost per million total tokens', asc: 'lowest cost per million total tokens' },
  duration: { desc: 'longest duration', asc: 'shortest duration' },
  turns: { desc: 'most turns', asc: 'least turns' },
  input: { desc: 'most input tokens', asc: 'least input tokens' },
  output: { desc: 'most output tokens', asc: 'least output tokens' },
  cacheRead: { desc: 'most cache-read tokens', asc: 'least cache-read tokens' },
  cacheWrite: { desc: 'most cache-write tokens', asc: 'least cache-write tokens' },
}

export function sessionSortAnnouncement(sort: SessionColumnSort): string {
  return SORT_ANNOUNCEMENTS[sort.key][sort.direction]
}

export const REASONING_LABELS: Record<ReasoningLevelOrUnknown, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  adaptive: 'Adaptive',
  unknown: 'Not identified',
}

export function providerName(provider: string): string {
  return provider
    .split(/[-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Unknown provider'
}

export function reasoningMixLabel(mix?: ReasoningMix): string {
  if (!mix) return 'Not available'
  if (mix.totalCalls === 0 || mix.rows.length === 0) return 'No attributed calls'
  const rows = mix.rows.filter(row => row.calls > 0)
  if (rows.length === 0) return 'No attributed calls'
  if (rows.length === 1 && rows[0]!.callShare === 1) return REASONING_LABELS[rows[0]!.level]
  const visible = rows.slice(0, 2).map(row => `${REASONING_LABELS[row.level]} ${Math.round(row.callShare * 100)}%`)
  if (rows.length > 2) visible.push(`+${rows.length - 2}`)
  return visible.join(' · ')
}

export function reasoningCoverageLabel(mix?: ReasoningMix): string {
  if (!mix) return 'Reasoning attribution unavailable'
  if (mix.totalCalls === 0) return 'No calls to attribute'
  return `${mix.knownCalls.toLocaleString('en-US')} of ${mix.totalCalls.toLocaleString('en-US')} calls known · ${Math.round(mix.coverage * 100)}% coverage`
}

export function sessionTotalTokens(row: SessionRow): number {
  return totalTokenCount(row)
}

export function sessionCacheReuse(row: SessionRow): number | null {
  return cacheReuseMultiple(row.inputTokens, row.cacheReadTokens)
}

export function sessionUnitCost(row: SessionRow): number | null {
  return costPerMillionTotal(row.cost, row)
}

export function sessionCacheShare(row: SessionRow): number | null {
  return cacheShare(row.inputTokens, row.cacheReadTokens)
}

export function hasObservedReasoning(row: Pick<SessionRow, 'reasoningSemantics' | 'reasoningTokens'>): boolean {
  return row.reasoningSemantics !== 'unavailable' && row.reasoningTokens !== undefined
}

export function sessionReasoningTitle(row: Pick<SessionRow, 'reasoningSemantics' | 'reasoningTokens'>): string {
  if (!hasObservedReasoning(row)) return 'Observed reasoning evidence is unavailable; it is not guessed.'
  if (row.reasoningSemantics === 'aggregate-output') return 'Observed reasoning is already included in Output; it is not added separately to Total.'
  if (row.reasoningSemantics === 'mixed') return 'Observed reasoning may include both output-included and separately additive tokens; only the additive subset is included separately in Total.'
  if (row.reasoningSemantics === 'separate') return 'Observed reasoning evidence; reasoning reported separately is included in Total.'
  return 'Observed reasoning evidence; only reasoning reported as additive contributes separately to Total.'
}

function endedAtTime(row: SessionRow): number {
  const time = new Date(row.endedAt).getTime()
  return Number.isNaN(time) ? 0 : time
}

function durationValue(row: SessionRow): number {
  return Number.isFinite(row.durationMs) && row.durationMs > 0 ? row.durationMs : 0
}

export function compareRows(sort: SessionSort, a: SessionRow, b: SessionRow): number {
  return compareRowsBy(sort, 'desc', a, b)
}

/**
 * Direction is always numeric (desc = larger values first) so the header arrow
 * and aria-sort stay truthful. Unavailable (null) metrics sort last in both
 * directions; the identity tiebreaker is direction-independent for stability.
 */
export function compareRowsBy(key: SessionSortKey, direction: SessionSortDirection, a: SessionRow, b: SessionRow): number {
  const sign = direction === 'asc' ? -1 : 1
  let result: number
  if (key === 'cache' || key === 'unitCost') {
    const left = key === 'cache' ? sessionCacheReuse(a) : sessionUnitCost(a)
    const right = key === 'cache' ? sessionCacheReuse(b) : sessionUnitCost(b)
    if (left == null && right == null) result = 0
    else if (left == null) result = 1
    else if (right == null) result = -1
    else result = sign * (right - left)
  } else {
    const left = sortMetric(key, a)
    const right = sortMetric(key, b)
    result = sign * (right - left)
  }
  return result || sessionIdentity(a).localeCompare(sessionIdentity(b))
}

function sortMetric(key: Exclude<SessionSortKey, 'cache' | 'unitCost'>, row: SessionRow): number {
  switch (key) {
    case 'cost': return row.cost
    case 'tokens': return sessionTotalTokens(row)
    case 'calls': return row.calls
    case 'duration': return durationValue(row)
    case 'turns': return row.turns
    case 'input': return row.inputTokens
    case 'output': return row.outputTokens
    case 'cacheRead': return row.cacheReadTokens
    case 'cacheWrite': return row.cacheWriteTokens
    default: return endedAtTime(row)
  }
}

export function groupSortValue(sort: SessionSortKey, rows: SessionRow[]): number {
  if (sort === 'cost') return rows.reduce((sum, row) => sum + row.cost, 0)
  if (sort === 'tokens') return rows.reduce((sum, row) => sum + sessionTotalTokens(row), 0)
  if (sort === 'calls') return rows.reduce((sum, row) => sum + row.calls, 0)
  if (sort === 'turns') return rows.reduce((sum, row) => sum + row.turns, 0)
  if (sort === 'input') return rows.reduce((sum, row) => sum + row.inputTokens, 0)
  if (sort === 'output') return rows.reduce((sum, row) => sum + row.outputTokens, 0)
  if (sort === 'cacheRead') return rows.reduce((sum, row) => sum + row.cacheReadTokens, 0)
  if (sort === 'cacheWrite') return rows.reduce((sum, row) => sum + row.cacheWriteTokens, 0)
  if (sort === 'cache') {
    const values = rows.map(sessionCacheReuse).filter((value): value is number => value != null)
    return values.length > 0 ? Math.max(...values) : 0
  }
  if (sort === 'unitCost') {
    const cost = rows.reduce((sum, row) => sum + row.cost, 0)
    const tokens = rows.reduce((sum, row) => sum + sessionTotalTokens(row), 0)
    return tokens > 0 ? cost / tokens * 1_000_000 : 0
  }
  if (sort === 'duration') return rows.reduce((longest, row) => Math.max(longest, durationValue(row)), 0)
  return rows.reduce((latest, row) => Math.max(latest, endedAtTime(row)), 0)
}

export function sessionHeadline(row: SessionRow): string {
  const title = row.title?.trim()
  if (title) return title
  const project = shortenProjectPath(row.project)
  if (project) return project
  const id = row.sessionId.trim()
  if (!id) return 'Untitled session'
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-5)}` : id
}

export function sessionIdentity(row: SessionRow): string {
  return row.sessionKey ?? [row.provider, row.project, row.sessionId].join('\u0000')
}

export function sessionDetailId(row: SessionRow): string {
  return `session-details-${sessionIdentity(row).replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

export function sessionRowLabel(row: SessionRow, selected: boolean): string {
  const headline = sessionHeadline(row)
  const project = shortenProjectPath(row.project)
  const parts = [`${selected ? 'Selected' : 'Select'} session: ${headline}.`]
  if (project && project !== headline) parts.push(`Project ${project}.`)
  parts.push(
    `Session ID ${row.sessionId}.`,
    `Last activity ${formatDayLong(row.endedAt)}.`,
    `Model${row.models.length === 1 ? '' : 's'} ${row.models.length > 0 ? row.models.join(', ') : 'not identified'}.`,
    `${row.turns.toLocaleString('en-US')} turns.`,
    `${row.calls.toLocaleString('en-US')} calls.`,
    `Cost ${formatUsd(row.cost)}.`,
    `${formatCompact(sessionTotalTokens(row))} total tokens.`,
  )
  return parts.join(' ')
}

export function formatSessionTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatUnitCost(value: number | null): string {
  return value == null ? '—' : formatUsd(value)
}

export function formatPrLabel(url: string): string {
  const github = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(url)
  if (github) return `${github[1]}/${github[2]}#${github[3]}`
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`.replace(/\/$/, '')
  } catch {
    return url
  }
}

export { formatReuseMultiple }
