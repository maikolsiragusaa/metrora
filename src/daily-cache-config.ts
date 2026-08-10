import { getLocalModelSavingsConfigHash, getPriceOverridesConfigHash } from './models.js'
import { runtimeHistoricalPricingCacheKeyV1 } from './pricing/runtime-cost-assignment.js'
import { PROVIDER_PARSE_VERSIONS } from './session-cache.js'
import { COPILOT_CHAT_JOURNAL_AUTHORITY } from './providers/copilot-chat-journal.js'

const CODEX_LEGACY_SESSION_META_AUTHORITY = 'legacy-session-meta-v1'

function extendAuthority(base: string | undefined, authority: string): string {
  if (!base) return authority
  return base.includes(authority) ? base : `${base}-${authority}`
}

/** Hashes every authority that can change a durable daily/model projection. */
export function getDailyCacheConfigHash(): string {
  const savingsHash = getLocalModelSavingsConfigHash()
  const overridesHash = getPriceOverridesConfigHash()
  const accountingHash = overridesHash
    ? `localModelSavings=${savingsHash}\u0002priceOverrides=${overridesHash}`
    : savingsHash
  const codexCollector = extendAuthority(
    PROVIDER_PARSE_VERSIONS['codex'],
    CODEX_LEGACY_SESSION_META_AUTHORITY,
  )
  return `historicalPricing=${runtimeHistoricalPricingCacheKeyV1()}`
    + `\u0002clineCollector=${PROVIDER_PARSE_VERSIONS['cline'] ?? ''}`
    + `\u0002codexCollector=${codexCollector}`
    + `\u0002copilotCollector=${PROVIDER_PARSE_VERSIONS['copilot'] ?? ''}`
    + `\u0002copilotJournal=${COPILOT_CHAT_JOURNAL_AUTHORITY}`
    + `\u0002antigravityCollector=${PROVIDER_PARSE_VERSIONS['antigravity'] ?? ''}`
    + `\u0002opencodeCollector=${PROVIDER_PARSE_VERSIONS['opencode'] ?? ''}`
    + `\u0002modelIdentity=v3`
    + `\u0002${accountingHash}`
}