import { isCacheComplete, type SessionCache } from './session-cache.js'

/** Apply the discovery gate and report whether the caller should publish the cache. */
export function applySessionCacheDiscoveryCompleteness(cache: SessionCache, discoveryComplete: boolean): boolean {
  const wasComplete = isCacheComplete(cache)
  if (discoveryComplete && !wasComplete) cache.complete = true
  if (!discoveryComplete && wasComplete) {
    cache.complete = false
    ;(cache as { _dirty?: boolean })._dirty = true
  }
  return (cache as { _dirty?: boolean })._dirty === true || discoveryComplete !== wasComplete
}
