import os from 'node:os'
import path from 'node:path'

import { emptyQuota, markObserved, type QuotaProvider, type QuotaWindow } from './types'
import { fraction, quotaRequestSignal, readSecureFile, sanitizeError } from './security'

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

function tokenFromMap(raw: string): string | null {
  const parsed = JSON.parse(raw) as Record<string, HostRecord>
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const preferred = parsed['github.com'] ?? Object.values(parsed)[0]
  const token = preferred?.oauth_token
  return typeof token === 'string' && token.trim() ? token : null
}

async function credentialFromFiles(deps: CopilotDeps): Promise<string | null> {
  for (const filePath of [deps.hostsPath, deps.appsPath]) {
    try {
      const raw = await deps.readFile(filePath, 64 * 1024)
      if (!raw) continue
      const token = tokenFromMap(raw)
      if (token) return token
    } catch {
      // A malformed or unreadable provider-owned file does not authorize a
      // wider search. Try the other known Copilot-owned credential document.
    }
  }
  return null
}

function windowOf(id: string, label: string, snapshot: unknown): QuotaWindow | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const row = snapshot as Record<string, unknown>
  const rawRemaining = row.percent_remaining ?? row.percentRemaining
  const remainingFraction = fraction(rawRemaining)
  if (remainingFraction === null) return null
  return {
    id,
    label,
    usedFraction: Number((1 - remainingFraction).toFixed(6)),
    resetsAt: null,
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
  const data = body && typeof body === 'object' ? body as Record<string, any> : {}
  const snapshots = data.quota_snapshots ?? data.quotaSnapshots
  const premium = windowOf('premium_interactions', 'Premium requests', snapshots?.premium_interactions ?? snapshots?.premiumInteractions)
  const chat = windowOf('chat', 'Chat', snapshots?.chat)
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