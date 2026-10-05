import type { CacheTokenEvidence, ReasoningTokenSemantics, UsageTokenEvidence } from './token-semantics.js'

/** Optional source authority carried across the durable CachedCall boundary. */
export type CachedCallTokenAuthority = {
  /** Source-specific reasoning inclusion authority, when one was proven. */
  reasoningSemantics?: ReasoningTokenSemantics
  /** OTel cache subfield evidence; absent on legacy/provider paths and old cache. */
  cacheTokenEvidence?: CacheTokenEvidence
  /** Primary input/output counter evidence; absent on legacy records and old cache. */
  usageEvidence?: UsageTokenEvidence
}
