import type { SessionCache } from './session-cache.js'

let latestCompletedSessionCache: SessionCache | undefined

export function getLatestCompletedSessionCacheV1(): SessionCache | undefined {
  return latestCompletedSessionCache
}

export function setLatestCompletedSessionCacheV1(cache: SessionCache): void {
  latestCompletedSessionCache = cache
}
