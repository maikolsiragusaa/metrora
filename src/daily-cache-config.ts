import { getLocalModelSavingsConfigHash, getPriceOverridesConfigHash } from './models.js'
import { runtimeHistoricalPricingCacheKeyV1 } from './pricing/runtime-cost-assignment.js'
import {
  CODEX_LEGACY_SESSION_META_AUTHORITY,
  COPILOT_CHAT_JOURNAL_AUTHORITY,
  COPILOT_CLI_RESUME_AUTHORITY,
  ensureCodexLegacySessionMetaAuthority,
  getProviderEnvConfigHash,
} from './provider-parse-authorities.js'
import { PROVIDER_PARSE_VERSIONS } from './session-cache.js'

/** Hashes every authority that can change a durable daily/model projection. */
export function getDailyCacheConfigHash(): string {
  const savingsHash = getLocalModelSavingsConfigHash()
  const overridesHash = getPriceOverridesConfigHash()
  const accountingHash = overridesHash
    ? `localModelSavings=${savingsHash}\u0002priceOverrides=${overridesHash}`
    : savingsHash
  const codexCollector = ensureCodexLegacySessionMetaAuthority()
  if (!codexCollector.includes(CODEX_LEGACY_SESSION_META_AUTHORITY)) {
    throw new Error('Codex legacy session-meta authority was not installed')
  }
  return `historicalPricing=${runtimeHistoricalPricingCacheKeyV1()}`
    + `\u0002providerEnv=${getProviderEnvConfigHash()}`
    + `\u0002claudeCollector=${PROVIDER_PARSE_VERSIONS['claude'] ?? ''}`
    + `\u0002clineCollector=${PROVIDER_PARSE_VERSIONS['cline'] ?? ''}`
    + `\u0002codexCollector=${codexCollector}`
    + `\u0002copilotCollector=${PROVIDER_PARSE_VERSIONS['copilot'] ?? ''}`
    + `\u0002copilotJournal=${COPILOT_CHAT_JOURNAL_AUTHORITY}`
    + `\u0002copilotCliResume=${COPILOT_CLI_RESUME_AUTHORITY}`
    + `\u0002antigravityCollector=${PROVIDER_PARSE_VERSIONS['antigravity'] ?? ''}`
    + `\u0002opencodeCollector=${PROVIDER_PARSE_VERSIONS['opencode'] ?? ''}`
    + `\u0002modelIdentity=v3`
    + `\u0002${accountingHash}`
}
