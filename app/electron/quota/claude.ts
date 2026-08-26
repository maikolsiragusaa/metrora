import os from 'node:os'
import path from 'node:path'

import { emptyQuota, markObserved, type QuotaProvider, type QuotaWindow } from './types'
import { fraction, quotaRequestSignal, readKeychainPassword, readSecureFile, sanitizeError } from './security'
import type { KeychainOutcome } from './security'
import { knownIdentity, unknownIdentity, type IdentityObservation } from './identity'

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const KEYCHAIN_SERVICE = 'Claude Code-credentials'

type ClaudeCredential = { accessToken: string; expiresAt?: number; rateLimitTier?: string }
export type ClaudeDeps = {
  fetch: typeof fetch
  credentialPath: string
  readFile: typeof readSecureFile
  now: () => number
  keychain?: () => Promise<KeychainOutcome>
}

const defaults: ClaudeDeps = {
  fetch: globalThis.fetch,
  credentialPath: path.join(os.homedir(), '.claude', '.credentials.json'),
  readFile: readSecureFile,
  now: Date.now,
}

function empty(connection: QuotaProvider['connection']): QuotaProvider {
  return emptyQuota('claude', connection)
}

function parseCredential(raw: string): ClaudeCredential | null {
  const clean = raw.replace(/\r/g, '').replace(/\n[ \t]*/g, '')
  const oauth = (JSON.parse(clean) as { claudeAiOauth?: Record<string, unknown> }).claudeAiOauth
  if (!oauth || typeof oauth.accessToken !== 'string' || oauth.accessToken.length === 0) return null
  return {
    accessToken: oauth.accessToken,
    expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : undefined,
    rateLimitTier: typeof oauth.rateLimitTier === 'string' ? oauth.rateLimitTier : undefined,
  }
}

async function credentialFromFile(deps: ClaudeDeps): Promise<ClaudeCredential | null> {
  const raw = await deps.readFile(deps.credentialPath, 64 * 1024)
  return raw ? parseCredential(raw) : null
}

export async function readClaudeKeychain(): Promise<KeychainOutcome> {
  // Claude Code has written the item under both `$USER` (2.1.x) and the older
  // hardcoded "agentseal" account; a user-scoped miss must fall through to the
  // service-only lookup rather than reporting disconnected.
  const user = process.env.USER
  return readKeychainPassword(KEYCHAIN_SERVICE, user ? [user, null] : [null])
}

type CredentialSource = {
  credential: ClaudeCredential
  reread: () => Promise<ClaudeCredential | null>
}

async function discoverCredential(deps: ClaudeDeps, allowKeychain: boolean): Promise<CredentialSource | null | 'accessDenied'> {
  const fromFile = await credentialFromFile(deps)
  if (fromFile) return { credential: fromFile, reread: () => credentialFromFile(deps) }
  if (!allowKeychain || process.platform !== 'darwin') return null
  const outcome = await (deps.keychain ?? readClaudeKeychain)()
  if (outcome.status === 'accessDenied') return 'accessDenied'
  if (outcome.status !== 'found') return null
  const credential = parseCredential(outcome.value)
  if (!credential) return null
  return {
    credential,
    reread: async () => {
      const next = await (deps.keychain ?? readClaudeKeychain)()
      return next.status === 'found' ? parseCredential(next.value) : null
    },
  }
}

function resetAt(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function evidenceWindowSeconds(row: Record<string, unknown>): number | null {
  const raw = row.window_seconds ?? row.limit_window_seconds
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null
}

function windowOf(id: string, label: string, value: unknown): QuotaWindow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const usedFraction = fraction(row.utilization ?? row.percent)
  if (usedFraction === null) return null
  return {
    id,
    label,
    usedFraction,
    resetsAt: resetAt(row.resets_at),
    windowSeconds: evidenceWindowSeconds(row),
  }
}

function tierLabel(raw: string | undefined): string | null {
  const value = raw?.trim() ?? ''
  if (!value) return null
  const normalized = value.toLowerCase()
  if (normalized === 'max_20x' || normalized === 'max20x' || normalized === 'max-20x') return 'Max 20x'
  if (normalized === 'max_5x' || normalized === 'max5x' || normalized === 'max-5x' || normalized === 'max') return 'Max 5x'
  if (normalized === 'pro') return 'Pro'
  if (normalized === 'team') return 'Team'
  if (normalized === 'enterprise') return 'Enterprise'
  return value.replace(/(^|[_-])\w/g, match => match.replace(/[_-]/, ' ').toUpperCase())
}

function stableScopedIdentity(row: Record<string, any>, display: string): string {
  const candidates = [
    row.id,
    row.limit_id,
    row.scope_id,
    row.scope?.id,
    row.scope?.model?.id,
    row.scope?.model?.name,
    display,
  ]
  const identity = candidates.find(candidate => typeof candidate === 'string' && candidate.trim())
  return `weekly_scoped:${typeof identity === 'string' ? identity.trim() : display}`
}

export function decodeClaudeUsage(body: unknown, credential: ClaudeCredential): QuotaProvider {
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const windows: QuotaWindow[] = []
  const five = windowOf('five_hour', '5-hour', data.five_hour)
  const weekly = windowOf('seven_day', 'Weekly', data.seven_day)
  const opus = windowOf('seven_day_opus', 'Weekly · Opus', data.seven_day_opus)
  const sonnet = windowOf('seven_day_sonnet', 'Weekly · Sonnet', data.seven_day_sonnet)
  for (const row of [five, weekly, opus, sonnet]) if (row) windows.push(row)

  if (Array.isArray(data.limits)) {
    for (const item of data.limits) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, any>
      const display = row.scope?.model?.display_name
      const candidate = fraction(row.percent)
      if (row.kind !== 'weekly_scoped' || typeof display !== 'string' || !display.trim() || candidate === null) continue
      const scoped = windowOf(stableScopedIdentity(row, display), `Weekly · ${display}`, row)
      if (scoped) windows.push(scoped)
    }
  }

  const decoded = emptyQuota('claude', 'connected')
  return {
    ...decoded,
    planLabel: tierLabel(credential.rateLimitTier),
    windows,
    // Anthropic's usage response does not report an equivalent credits balance.
    credits: null,
  }
}

async function request(token: string, deps: ClaudeDeps, parent?: AbortSignal): Promise<Response> {
  return deps.fetch(ENDPOINT, {
    method: 'GET', signal: quotaRequestSignal(parent),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-code/2.1.0',
    },
  })
}

export type ClaudeResult = { quota: QuotaProvider; retryAfterSeconds?: number; identity: IdentityObservation }

export async function fetchClaudeQuota(options: Partial<ClaudeDeps> & { signal?: AbortSignal; allowKeychain?: boolean; identityOnly?: boolean } = {}): Promise<ClaudeResult> {
  const deps = { ...defaults, ...options }
  try {
    const discovered = await discoverCredential(deps, Boolean(options.allowKeychain))
    if (discovered === 'accessDenied') return { quota: empty('accessDenied'), identity: unknownIdentity() }
    if (!discovered) return { quota: empty('disconnected'), identity: unknownIdentity() }
    const source = discovered
    let credential = source.credential
    let identity = knownIdentity('claude', credential.accessToken)

    // Claude's CLI owns token rotation. A near-expiry credential gets one
    // bounded reread; Metrora never calls a provider refresh endpoint.
    if (credential.expiresAt !== undefined && credential.expiresAt - deps.now() <= 5 * 60_000) {
      const reread = await source.reread()
      if (!reread || reread.accessToken === credential.accessToken) return { quota: empty('transientFailure'), identity }
      credential = reread
      identity = knownIdentity('claude', credential.accessToken)
    }

    if (options.identityOnly) return { quota: empty('loading'), identity }

    let response = await request(credential.accessToken, deps, options.signal)
    if (response.status === 401) {
      const reread = await source.reread()
      if (!reread || reread.accessToken === credential.accessToken) return { quota: empty('transientFailure'), identity }
      credential = reread
      identity = knownIdentity('claude', credential.accessToken)
      response = await request(credential.accessToken, deps, options.signal)
      if (response.status === 401) return { quota: empty('transientFailure'), identity }
    }
    if (response.status === 429) {
      let hint: unknown
      try { hint = (await response.json() as Record<string, unknown>).retry_after } catch { hint = undefined }
      const parsed = typeof hint === 'number' ? hint : typeof hint === 'string' ? Number(hint) : NaN
      return { quota: empty('transientFailure'), retryAfterSeconds: Math.max(Number.isFinite(parsed) ? parsed : 300, 60), identity }
    }
    if (!response.ok) return { quota: empty(response.status >= 400 && response.status < 500 ? 'terminalFailure' : 'transientFailure'), identity }
    return { quota: markObserved(decodeClaudeUsage(await response.json(), credential), deps.now()), identity }
  } catch (error) {
    // Deliberately sanitize before the only diagnostic sink. Tokens and
    // provider response bodies are never returned or logged.
    console.warn(`Claude quota unavailable: ${sanitizeError(error)}`)
    return { quota: empty('transientFailure'), identity: unknownIdentity() }
  }
}
