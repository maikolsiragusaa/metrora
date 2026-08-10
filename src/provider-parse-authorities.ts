import { PROVIDER_PARSE_VERSIONS } from './session-cache.js'

export const CODEX_LEGACY_SESSION_META_AUTHORITY = 'legacy-session-meta-v1'
export const COPILOT_CHAT_JOURNAL_AUTHORITY = 'current-chat-journal-v3'
export const COPILOT_CHAT_JOURNAL_PROVIDER = `copilot-chat-journal-${COPILOT_CHAT_JOURNAL_AUTHORITY}`

/**
 * The canonical provider parse-version map is the session-cache authority.
 * Install the Codex legacy identity marker before any Codex provider parse or
 * daily-cache hash calculation so warm caches and daily history advance under
 * the same authority. Idempotent by construction.
 */
export function ensureCodexLegacySessionMetaAuthority(): string {
  const current = PROVIDER_PARSE_VERSIONS['codex'] ?? ''
  if (current.includes(CODEX_LEGACY_SESSION_META_AUTHORITY)) return current
  const effective = current
    ? `${current}-${CODEX_LEGACY_SESSION_META_AUTHORITY}`
    : CODEX_LEGACY_SESSION_META_AUTHORITY
  PROVIDER_PARSE_VERSIONS['codex'] = effective
  return effective
}
