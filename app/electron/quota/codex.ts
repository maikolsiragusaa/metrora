import os from 'node:os'
import path from 'node:path'

import { emptyQuota, markObserved, type QuotaProvider, type QuotaWindow } from './types'
import { fraction, quotaRequestSignal, readKeychainPassword, readSecureFile, sanitizeError } from './security'
import type { KeychainOutcome } from './security'
import { knownIdentity, sameIdentity, unknownIdentity, type IdentityObservation } from './identity'

const USAGE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage'
// The Metrora menubar caches its ChatGPT-mode Codex OAuth here as a
// `CredentialRecord` JSON blob (accessToken/refreshToken/idToken/accountId/…),
// account "default". Same brand, same machine, already consented — preferred
// over any OpenAI-owned storage. It remains read-only to this quota path.
const MENUBAR_KEYCHAIN_SERVICE = 'eu.metrora.menubar.codex.oauth.v1'

type AuthDoc = Record<string, any> & {
  auth_mode?: string
  tokens?: { access_token?: string; refresh_token?: string; id_token?: string; account_id?: string; [key: string]: unknown }
  last_refresh?: string
}

export type CodexDeps = {
  fetch: typeof fetch
  authPath: string
  openaiAuthPath: string
  /** Read-only credential source. Codex owns rotation of this document. */
  readFile: typeof readSecureFile
  keychain: (service: string) => Promise<KeychainOutcome>
  now: () => number
}

const defaults: CodexDeps = {
  fetch: globalThis.fetch,
  authPath: path.join(os.homedir(), '.codex', 'auth.json'),
  openaiAuthPath: path.join(os.homedir(), 'Library', 'Application Support', 'com.openai.codex', 'auth.json'),
  readFile: readSecureFile,
  keychain: service => readKeychainPassword(service, ['default', null]),
  now: Date.now,
}

/** Every Codex credential source is provider-owned and read-only here. */
type CodexSource = {
  name: 'menubarKeychain' | 'authFile' | 'openaiAppSupport'
  auth: AuthDoc
  reread: () => Promise<AuthDoc | null>
}

function empty(connection: QuotaProvider['connection']): QuotaProvider {
  return emptyQuota('codex', connection)
}

function identityForAuth(auth: AuthDoc): IdentityObservation {
  const accountId = typeof auth.tokens?.account_id === 'string' ? auth.tokens.account_id.trim() : ''
  if (accountId) return knownIdentity('codex', 'account', accountId)
  const token = typeof auth.tokens?.access_token === 'string' ? auth.tokens.access_token : ''
  return token ? knownIdentity('codex', 'credential', token) : unknownIdentity()
}

async function readAuth(deps: CodexDeps, filePath: string = deps.authPath): Promise<AuthDoc | null> {
  const raw = await deps.readFile(filePath, 64 * 1024)
  return raw ? JSON.parse(raw) as AuthDoc : null
}

// The menubar stores a Swift `CredentialRecord` (camelCase, Date fields as
// numbers) rather than the CLI's snake_case auth.json. Normalize to AuthDoc and
// mark it chatgpt-mode (the menubar only ever caches ChatGPT subscriptions).
function authFromMenubarRecord(raw: string): AuthDoc | null {
  let record: Record<string, unknown>
  try { record = JSON.parse(raw) as Record<string, unknown> } catch { return null }
  const access = typeof record.accessToken === 'string' ? record.accessToken : ''
  if (!access) return null
  return {
    auth_mode: 'chatgpt',
    tokens: {
      access_token: access,
      refresh_token: typeof record.refreshToken === 'string' ? record.refreshToken : undefined,
      id_token: typeof record.idToken === 'string' ? record.idToken : undefined,
      account_id: typeof record.accountId === 'string' ? record.accountId : undefined,
    },
  }
}

async function discoverSource(deps: CodexDeps, allowKeychain: boolean): Promise<CodexSource | 'accessDenied' | null> {
  let denied = false
  // (a) Metrora menubar's own cached Codex OAuth. Read-only: the menubar owns
  // rotation, so this path never writes it back or proactively refreshes it.
  if (allowKeychain && process.platform === 'darwin') {
    const outcome = await deps.keychain(MENUBAR_KEYCHAIN_SERVICE)
    if (outcome.status === 'accessDenied') denied = true
    else if (outcome.status === 'found') {
      const auth = authFromMenubarRecord(outcome.value)
      if (auth) {
        return {
          name: 'menubarKeychain', auth,
          reread: async () => {
            const next = await deps.keychain(MENUBAR_KEYCHAIN_SERVICE)
            return next.status === 'found' ? authFromMenubarRecord(next.value) : null
          },
        }
      }
    }
  }
  // (b) The Codex CLI's own ~/.codex/auth.json. Read-only: Codex owns refresh
  // token rotation and Metrora must never write this provider-owned file.
  const fileAuth = await readAuth(deps)
  if (fileAuth) return { name: 'authFile', auth: fileAuth, reread: () => readAuth(deps) }
  // (c) com.openai.codex App Support, only if it holds a plaintext auth JSON
  // with a usable token. Tokens encrypted via "Codex Safe Storage" have no
  // plaintext access_token here, so they fall through — we never decrypt.
  const openaiAuth = await readAuth(deps, deps.openaiAuthPath).catch(() => null)
  if (openaiAuth?.tokens?.access_token) {
    return { name: 'openaiAppSupport', auth: openaiAuth, reread: () => readAuth(deps, deps.openaiAuthPath).catch(() => null) }
  }
  return denied ? 'accessDenied' : null
}

function windowSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null
}

function labelForSeconds(value: number | null): string {
  const seconds = value ?? 0
  if (seconds <= 0) return 'Quota window'
  if (seconds < 3600) return 'Hourly'
  if (seconds < 7200) return 'Hour'
  if (seconds >= 18_000 && seconds < 19_000) return '5-hour'
  if (seconds >= 86_400 && seconds < 87_000) return 'Daily'
  if (seconds >= 604_800 && seconds < 605_000) return 'Weekly'
  const hours = Math.floor(seconds / 3600)
  return hours < 24 ? `${hours}-hour` : `${Math.floor(hours / 24)}-day`
}

function resetAt(value: unknown): string | null {
  const date = typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000)
    : typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? new Date(value)
      : null
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function windowOf(value: unknown, id: string, override?: string): QuotaWindow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const usedFraction = fraction(row.used_percent)
  if (usedFraction === null) return null
  const seconds = windowSeconds(row.limit_window_seconds)
  return {
    id,
    label: override ?? labelForSeconds(seconds),
    usedFraction,
    resetsAt: resetAt(row.reset_at),
    windowSeconds: seconds,
  }
}

function planLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()
  const lower = raw.toLowerCase()
  const known: Record<string, string> = {
    guest: 'Guest', free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro',
    prolite: 'Pro Lite', pro_lite: 'Pro Lite', 'pro-lite': 'Pro Lite',
    free_workspace: 'Free Workspace', team: 'Team', business: 'Business',
    education: 'Education', quorum: 'Quorum', k12: 'K-12', enterprise: 'Enterprise', edu: 'Edu',
  }
  return known[lower] ?? lower.replace(/(^|[_-])\w/g, match => match.replace(/[_-]/, ' ').toUpperCase())
}

function credits(value: unknown): QuotaProvider['credits'] {
  if (!value || typeof value !== 'object') return null
  const raw = (value as Record<string, unknown>).balance
  const balance = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? Number(raw)
      : NaN
  return Number.isFinite(balance) ? { balance, currency: 'USD' } : null
}

export function decodeCodexUsage(body: unknown): QuotaProvider {
  const data = body && typeof body === 'object' ? body as Record<string, any> : {}
  const windows: QuotaWindow[] = []
  const primary = windowOf(data.rate_limit?.primary_window, 'primary')
  const secondary = windowOf(data.rate_limit?.secondary_window, 'secondary')
  if (primary) windows.push(primary)
  if (secondary) windows.push(secondary)

  if (Array.isArray(data.additional_rate_limits)) {
    for (const additional of data.additional_rate_limits) {
      if (!additional || typeof additional !== 'object' || typeof additional.limit_name !== 'string' || !additional.limit_name.trim()) continue
      const name = additional.limit_name.trim()
      const primaryAdditional = windowOf(additional.rate_limit?.primary_window, `additional:${name}:primary`, `${name} · ${labelForSeconds(windowSeconds(additional.rate_limit?.primary_window?.limit_window_seconds))}`)
      const secondaryAdditional = windowOf(additional.rate_limit?.secondary_window, `additional:${name}:secondary`, `${name} · ${labelForSeconds(windowSeconds(additional.rate_limit?.secondary_window?.limit_window_seconds))}`)
      if (primaryAdditional) windows.push(primaryAdditional)
      if (secondaryAdditional) windows.push(secondaryAdditional)
    }
  }

  const decoded = emptyQuota('codex', 'connected')
  return {
    ...decoded,
    planLabel: planLabel(data.plan_type),
    windows,
    credits: credits(data.credits),
  }
}

async function usage(auth: AuthDoc, deps: CodexDeps, signal?: AbortSignal): Promise<Response | null> {
  const token = auth.tokens?.access_token
  if (!token) return null
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'Metrora' }
  if (auth.tokens?.account_id) headers['ChatGPT-Account-Id'] = auth.tokens.account_id
  return deps.fetch(USAGE_ENDPOINT, { method: 'GET', headers, signal: quotaRequestSignal(signal) })
}

export type CodexResult = { quota: QuotaProvider; retryAfterSeconds?: number; identity: IdentityObservation }

export async function fetchCodexQuota(options: Partial<CodexDeps> & { signal?: AbortSignal; allowKeychain?: boolean; identityOnly?: boolean } = {}): Promise<CodexResult> {
  const deps = { ...defaults, ...options }
  try {
    const discovered = await discoverSource(deps, Boolean(options.allowKeychain))
    if (discovered === 'accessDenied') return { quota: empty('accessDenied'), identity: unknownIdentity() }
    if (!discovered) return { quota: empty('disconnected'), identity: unknownIdentity() }
    const source = discovered
    let auth = source.auth
    let identity = identityForAuth(auth)
    if (auth.auth_mode !== 'chatgpt') return { quota: empty('terminalFailure'), identity }
    if (!auth.tokens?.access_token) return { quota: empty('disconnected'), identity: unknownIdentity() }
    if (options.identityOnly) return { quota: empty('loading'), identity }

    // Provider-owned Codex OAuth is observationally read-only. In particular,
    // a stale refresh_token in auth.json is never spent by this code.
    let response = await usage(auth, deps, options.signal)
    if (!response) return { quota: empty('disconnected'), identity }
    if (response.status === 401) {
      // One bounded reread lets the owner win a concurrent rotation. If the
      // access token did not change, truthfully wait rather than refreshing or
      // mutating the provider-owned credential source.
      const reread = await source.reread()
      const nextToken = reread?.tokens?.access_token
      const nextIdentity = reread ? identityForAuth(reread) : unknownIdentity()
      if (!nextToken || (nextToken === auth.tokens?.access_token && sameIdentity(nextIdentity, identity))) return { quota: empty('transientFailure'), identity }
      if (reread?.auth_mode !== 'chatgpt') return { quota: empty('terminalFailure'), identity: nextIdentity }
      auth = reread
      identity = nextIdentity
      response = await usage(auth, deps, options.signal)
      if (!response) return { quota: empty('transientFailure'), identity }
      if (response.status === 401) return { quota: empty('transientFailure'), identity }
    }
    if (response.status === 429) {
      const raw = response.headers.get('Retry-After')
      let seconds = raw === null ? NaN : Number(raw)
      if (!Number.isFinite(seconds) && raw) seconds = (Date.parse(raw) - deps.now()) / 1000
      return { quota: empty('transientFailure'), retryAfterSeconds: Math.max(Number.isFinite(seconds) ? Math.ceil(seconds) : 300, 60), identity }
    }
    if (!response.ok) return { quota: empty(response.status >= 400 && response.status < 500 ? 'terminalFailure' : 'transientFailure'), identity }
    return { quota: markObserved(decodeCodexUsage(await response.json()), deps.now()), identity }
  } catch (error) {
    console.warn(`Codex quota unavailable: ${sanitizeError(error)}`)
    return { quota: empty('transientFailure'), identity: unknownIdentity() }
  }
}
