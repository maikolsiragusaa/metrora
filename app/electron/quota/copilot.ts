import os from 'node:os'
import path from 'node:path'

import { emptyQuota, markObserved, type QuotaProvider, type QuotaWindow } from './types'
import { quotaRequestSignal, readSecureFile, sanitizeError } from './security'

const USAGE_ENDPOINT = 'https://api.github.com/copilot_internal/user'
const SOURCE = { kind: 'provider-internal-api', stability: 'experimental' } as const
const HEADERS = {
  Accept: 'application/json',
  'Editor-Version': 'vscode/1.96.2',
  'Editor-Plugin-Version': 'copilot-chat/0.26.7',
  'User-Agent': 'GitHubCopilotChat/0.26.7',
  'X-Github-Api-Version': '2025-04-01',
} as const

type HostRecord = Record<string, unknown> & { oauth_token?: unknown }
type JsonRecord = Record<string, unknown>

export type CopilotDeps = {
  fetch: typeof fetch
  hostsPath: string
  appsPath: string
  readFile: typeof readSecureFile
  now: () => number
}

const defaults: CopilotDeps = {
  fetch: globalThis.fetch,
  hostsPath: path.join(os.homedir(), '.config', 'github-copilot', 'hosts.json'),
  appsPath: path.join(os.homedir(), '.config', 'github-copilot', 'apps.json'),
  readFile: readSecureFile,
  now: Date.now,
}

function empty(connection: QuotaProvider['connection']): QuotaProvider {
  return { ...emptyQuota('copilot', connection), source: SOURCE }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function tokenValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function credentialCandidates(raw: string): { preferred: string[]; all: string[] } {
  const parsed = asRecord(JSON.parse(raw)) as Record<string, HostRecord> | null
  if (!parsed) return { preferred: [], all: [] }

  const entries = Object.entries(parsed).flatMap(([key, record]) => {
    const token = tokenValue(record?.oauth_token)
    return token ? [{ key, token }] : []
  })
  const preferred = entries.filter(({ key }) => /^github\.com(?::|$)/iu.test(key)).map(({ token }) => token)
  return {
    preferred: [...new Set(preferred)],
    all: [...new Set(entries.map(({ token }) => token))],
  }
}

async function credentialFromFiles(deps: CopilotDeps): Promise<string | null> {
  const preferred = new Set<string>()
  const all = new Set<string>()
  for (const filePath of [deps.hostsPath, deps.appsPath]) {
    try {
      const raw = await deps.readFile(filePath, 64 * 1024)
      if (!raw) continue
      const candidates = credentialCandidates(raw)
      for (const token of candidates.preferred) preferred.add(token)
      for (const token of candidates.all) all.add(token)
    } catch {
      // A malformed or unreadable provider-owned file does not authorize a
      // wider search. Try the other known Copilot-owned credential document.
    }
  }

  // A github.com (or github.com:<app-id>) key is the provider's own account
  // selector. If more than one distinct provider-owned token is visible, there
  // is no safe way for this read-only adapter to choose the active account.
  if (preferred.size === 1) return preferred.values().next().value ?? null
  if (preferred.size > 1) return null
  return all.size === 1 ? all.values().next().value ?? null : null
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function numericField(row: JsonRecord, names: string[]): number | null {
  for (const name of names) {
    const value = finiteNumber(row[name])
    if (value !== null) return value
  }
  return null
}

function presentField(row: JsonRecord, names: string[]): unknown {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null) return row[name]
  }
  return undefined
}

function booleanMarker(value: unknown): 'true' | 'false' | 'unknown' | 'absent' {
  if (value === undefined || value === null) return 'absent'
  if (value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true')) return 'true'
  if (value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false')) return 'false'
  return 'unknown'
}

function hasTokenBillingMarker(data: JsonRecord, row: JsonRecord): boolean {
  const values = [
    data.token_based_billing,
    data.tokenBasedBilling,
    row.token_based_billing,
    row.tokenBasedBilling,
    row.unmetered,
    row.is_unmetered,
  ]
  return values.some(value => booleanMarker(value) === 'true' || booleanMarker(value) === 'unknown')
    || [data.billing_type, data.billingType, row.billing_type, row.billingType]
      .some(value => typeof value === 'string' && ['token', 'token-based', 'token_based_billing', 'usage-based', 'usage_based', 'ai-credit', 'ai-credits', 'ai_credits', 'unmetered'].includes(value.trim().toLowerCase()))
}

function isUnlimited(data: JsonRecord, row: JsonRecord, entitlement: number | null): boolean {
  return [data.unlimited, row.unlimited, row.isUnlimitedEntitlement]
    .some(value => booleanMarker(value) === 'true' || booleanMarker(value) === 'unknown')
    || entitlement === -1
}

function resetAt(value: unknown): string | null {
  const numeric = finiteNumber(value)
  if (numeric !== null) {
    const date = new Date(Math.abs(numeric) > 1e12 ? numeric : numeric * 1000)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  return null
}

function windowOf(id: string, label: string, snapshot: unknown, data: JsonRecord): QuotaWindow | null {
  const row = asRecord(snapshot)
  if (!row) return null
  const entitlement = numericField(row, ['entitlement', 'entitlementRequests'])
  const rawRemaining = numericField(row, ['percent_remaining', 'percentRemaining', 'remainingPercentage'])
  if (entitlement === null || entitlement <= 0 || entitlement === -1 || rawRemaining === null || rawRemaining < 0 || rawRemaining > 100) return null
  if (isUnlimited(data, row, entitlement) || hasTokenBillingMarker(data, row)) return null

  const remainingFraction = rawRemaining / 100
  const reset = resetAt(presentField(row, ['quota_reset_at', 'quotaResetAt', 'reset_at', 'resetAt', 'resetDate', 'reset_date']))
    ?? resetAt(presentField(data, ['quota_reset_date_utc', 'quota_reset_date', 'quotaResetDateUtc', 'quotaResetDate']))
  return {
    id,
    label,
    usedFraction: Number((1 - remainingFraction).toFixed(6)),
    resetsAt: reset,
    windowSeconds: null,
  }
}

function planLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const lower = value.trim().toLowerCase()
  const known: Record<string, string> = {
    free: 'Free',
    individual: 'Individual',
    pro: 'Pro',
    business: 'Business',
    enterprise: 'Enterprise',
    for_educators: 'Educators',
    'for-educators': 'Educators',
  }
  return known[lower] ?? lower.replace(/(^|[_-])\w/g, match => match.replace(/[_-]/, ' ').toUpperCase())
}

export function decodeCopilotUsage(body: unknown): QuotaProvider {
  const data = asRecord(body) ?? {}
  const snapshots = asRecord(data.quota_snapshots) ?? asRecord(data.quotaSnapshots) ?? {}
  const premium = windowOf('premium_interactions', 'Premium requests', snapshots.premium_interactions ?? snapshots.premiumInteractions, data)
  const chat = windowOf('chat', 'Chat', snapshots.chat, data)
  const windows = [premium, chat].filter((row): row is QuotaWindow => row !== null)
  return {
    ...empty('connected'),
    windows,
    planLabel: planLabel(data.copilot_plan ?? data.copilotPlan),
  }
}

async function request(token: string, deps: CopilotDeps, parent?: AbortSignal): Promise<Response> {
  return deps.fetch(USAGE_ENDPOINT, {
    method: 'GET',
    signal: quotaRequestSignal(parent),
    redirect: 'error',
    headers: { ...HEADERS, Authorization: `token ${token}` },
  })
}

function retryAfterSeconds(response: Response, now: number): number {
  const raw = response.headers.get('Retry-After')
  const numeric = raw === null ? NaN : Number(raw)
  if (Number.isFinite(numeric)) return Math.max(60, Math.ceil(numeric))
  const date = raw ? Date.parse(raw) : NaN
  return Math.max(60, Number.isFinite(date) ? Math.ceil((date - now) / 1000) : 300)
}

export type CopilotResult = { quota: QuotaProvider; retryAfterSeconds?: number }

export async function fetchCopilotQuota(options: Partial<CopilotDeps> & { signal?: AbortSignal } = {}): Promise<CopilotResult> {
  const deps = { ...defaults, ...options }
  try {
    let token = await credentialFromFiles(deps)
    if (!token) return { quota: empty('disconnected') }

    let response = await request(token, deps, options.signal)
    if (response.status === 401) {
      const reread = await credentialFromFiles(deps)
      if (!reread || reread === token) return { quota: empty('transientFailure') }
      token = reread
      response = await request(token, deps, options.signal)
      if (response.status === 401) return { quota: empty('transientFailure') }
    }
    if (response.status === 429) return { quota: empty('transientFailure'), retryAfterSeconds: retryAfterSeconds(response, deps.now()) }
    if (!response.ok) return { quota: empty(response.status >= 400 && response.status < 500 ? 'terminalFailure' : 'transientFailure') }
    return { quota: markObserved(decodeCopilotUsage(await response.json()), deps.now()) }
  } catch (error) {
    console.warn(`GitHub Copilot capacity unavailable: ${sanitizeError(error)}`)
    return { quota: empty('transientFailure') }
  }
}
