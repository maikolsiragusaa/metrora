import { createHash } from 'node:crypto'

import type { DateRange, ProjectSummary } from './types.js'

const OPTIMIZE_CACHE_KEY_VERSION = 'optimize-project-summary-v2'

/**
 * Keep the cache and detector-scope decisions on the same canonical provider
 * value. CLI callers already pass validated provider names; this also keeps
 * direct library callers from creating distinct keys for casing/whitespace
 * variants and makes an omitted provider mean the existing all-provider view.
 */
export function normalizeOptimizeProvider(provider?: string): string {
  const normalized = provider?.trim().toLowerCase()
  return normalized || 'all'
}

function dateScope(dateRange: DateRange | undefined): string {
  return dateRange
    ? `${dateRange.start.getTime()}-${dateRange.end.getTime()}`
    : 'all'
}

/**
 * Content-address the complete Optimize input rather than a few aggregate
 * counters. The digest stays process-local: serialized project data is never
 * placed in the key or persisted by this cache.
 */
export function optimizeResultCacheKey(
  projects: ProjectSummary[],
  dateRange: DateRange | undefined,
  provider?: string,
): string {
  const providerScope = normalizeOptimizeProvider(provider)
  const scope = dateScope(dateRange)
  const hash = createHash('sha256')
  hash.update(OPTIMIZE_CACHE_KEY_VERSION)
  hash.update('\0')
  hash.update(providerScope)
  hash.update('\0')
  hash.update(scope)

  for (const project of projects) {
    hash.update('\0')
    hash.update(JSON.stringify(project))
  }

  return `${OPTIMIZE_CACHE_KEY_VERSION}:${providerScope}:${scope}:${hash.digest('base64url')}`
}
