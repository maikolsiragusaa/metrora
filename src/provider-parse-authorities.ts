import { createHash } from 'node:crypto'

import { PROVIDER_ENV_VARS, PROVIDER_PARSE_VERSIONS } from './session-cache.js'

export const CODEX_LEGACY_SESSION_META_AUTHORITY = 'legacy-session-meta-v1'
export const COPILOT_CHAT_JOURNAL_AUTHORITY = 'current-chat-journal-v3'
export const COPILOT_CHAT_JOURNAL_PROVIDER = `copilot-chat-journal-${COPILOT_CHAT_JOURNAL_AUTHORITY}`
export const COPILOT_CLI_RESUME_AUTHORITY = 'resumed-shutdown-delta-v1'
export const COPILOT_CLI_RESUME_PROVIDER = `copilot-cli-resume-${COPILOT_CLI_RESUME_AUTHORITY}`

/**
 * Provider env reads that materially change discovery, parsing, or the account
 * queried by a provider. Metrora inherited a smaller declaration map than its
 * current provider set actually reads, so changing one of these overrides could
 * leave a warm session-cache section attached to the previous source/profile.
 *
 * Keep this list Metrora-owned: names intentionally use Metrora's compatibility
 * env contract rather than upstream aliases.
 */
export const PROVIDER_ENV_FINGERPRINT_ADDITIONS: Readonly<Record<string, readonly string[]>> = {
  claude: ['METRORA_DESKTOP_SESSIONS_DIR', 'APPDATA', 'LOCALAPPDATA'],
  'cline-cli': ['CLINE_SESSION_DATA_DIR', 'CLINE_DATA_DIR', 'CLINE_DIR'],
  codebuff: ['CODEBUFF_DATA_DIR'],
  cursor: ['METRORA_CURSOR_MAX_BUBBLES'],
  'open-design': ['METRORA_OPEN_DESIGN_DIR', 'APPDATA'],
  goose: ['GOOSE_PATH_ROOT'],
  grok: ['GROK_HOME'],
  crush: ['CRUSH_GLOBAL_DATA', 'LOCALAPPDATA'],
  'kilo-code': ['XDG_DATA_HOME'],
  kimi: ['KIMI_SHARE_DIR', 'KIMI_MODEL_NAME'],
  kiro: ['KIRO_HOME'],
  'mistral-vibe': ['VIBE_HOME'],
  mux: ['MUX_ROOT', 'METRORA_MUX_DIR'],
  zerostack: ['ZS_DATA_DIR', 'XDG_DATA_HOME'],
  'ibm-bob': ['APPDATA'],
  'vercel-gateway': ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'],
}

/**
 * Copilot is deliberately excluded from PROVIDER_ENV_VARS for now. Its durable
 * OTel cache can contain conversations already pruned from a still-existing DB
 * path. A provider-wide fingerprint change currently drops that present-path
 * cache entry before reparse, which can destroy history that raw evidence can no
 * longer recreate. The current-chat journal has its own non-durable namespace,
 * so its snapshot semantics do not require this unsafe provider-wide bump.
 */
export const COPILOT_DEFERRED_ENV_FINGERPRINTS = [
  'METRORA_COPILOT_SESSION_STATE_DIR',
  'METRORA_COPILOT_OTEL_DB',
  'METRORA_COPILOT_JETBRAINS_DIR',
  'METRORA_COPILOT_WS_STORAGE_DIR',
  'METRORA_COPILOT_DISABLE_OTEL',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
] as const

/** Install the static provider env declarations before any cache fingerprint. */
export function ensureProviderEnvFingerprintAuthorities(): void {
  for (const [provider, additions] of Object.entries(PROVIDER_ENV_FINGERPRINT_ADDITIONS)) {
    const current = PROVIDER_ENV_VARS[provider] ?? []
    const next = [...current]
    for (const name of additions) {
      if (!next.includes(name)) next.push(name)
    }
    PROVIDER_ENV_VARS[provider] = next
  }
}

/**
 * Hash, never serialize, the values behind every declared provider env input.
 * Daily history must move with the same source/account identity as the session
 * cache, while credential values themselves must never land in the config key.
 */
export function getProviderEnvConfigHash(): string {
  ensureProviderEnvFingerprintAuthorities()
  const parts: string[] = []
  for (const provider of Object.keys(PROVIDER_ENV_VARS).sort()) {
    const vars = [...(PROVIDER_ENV_VARS[provider] ?? [])].sort()
    for (const name of vars) parts.push(`${provider}\u0001${name}\u0001${process.env[name] ?? ''}`)
  }
  return createHash('sha256').update(parts.join('\u0002')).digest('hex').slice(0, 24)
}

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
