import { isCacheComplete, type SessionCache } from './session-cache.js'

export type SessionCacheHydrationScope = 'all' | 'provider'

/**
 * Mark a parser run as a completed cache hydration and report whether the cache
 * should be published.
 *
 * `SessionCache.complete` is the warm/cold hydration marker. It must not be
 * demoted merely because one provider's discovery is unavailable, failed or
 * partial: provider-scoped discovery authority already gates destructive source
 * reconciliation, while live snapshot completeness separately re-checks the
 * current discovery outcomes and fingerprints.
 *
 * Conflating those authorities makes every later refresh re-enter cold
 * hydration whenever any unrelated provider is degraded. A successful
 * provider-safe parse therefore completes the cache even when the overall
 * discovery set remains degraded. A provider-scoped parse is different: it
 * has not hydrated the other providers and must not stamp the global cache as
 * complete.
 */
export function applySessionCacheDiscoveryCompleteness(
  cache: SessionCache,
  _discoveryComplete: boolean,
  scope: SessionCacheHydrationScope = 'all',
): boolean {
  const wasComplete = isCacheComplete(cache)
  if (scope === 'all' && !wasComplete) {
    cache.complete = true
    ;(cache as { _dirty?: boolean })._dirty = true
  }
  return (cache as { _dirty?: boolean })._dirty === true || (scope === 'all' && !wasComplete)
}
