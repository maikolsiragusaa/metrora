import { getLocalModelSavingsConfigHash, getPriceOverridesConfigHash } from './models.js'
import { runtimeHistoricalPricingCacheKeyV1 } from './pricing/runtime-cost-assignment.js'
import { PROVIDER_PARSE_VERSIONS } from './session-cache.js'

/** Hashes every authority that can change a durable daily/model projection. */
export function getDailyCacheConfigHash(): string {
  const savingsHash = getLocalModelSavingsConfigHash()
  const overridesHash = getPriceOverridesConfigHash()
  const accountingHash = overridesHash
    ? `localModelSavings=${savingsHash}\u0002priceOverrides=${overridesHash}`
    : savingsHash
  return `historicalPricing=${runtimeHistoricalPricingCacheKeyV1()}`
    + `\u0002clineCollector=${PROVIDER_PARSE_VERSIONS['cline'] ?? ''}`
    + `\u0002copilotCollector=${PROVIDER_PARSE_VERSIONS['copilot'] ?? ''}`
    + `\u0002antigravityCollector=${PROVIDER_PARSE_VERSIONS['antigravity'] ?? ''}`
    + `\u0002opencodeCollector=${PROVIDER_PARSE_VERSIONS['opencode'] ?? ''}`
    + `\u0002modelIdentity=v3`
    + `\u0002${accountingHash}`
}
