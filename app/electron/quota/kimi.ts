import os from 'node:os'
import path from 'node:path'

import { emptyQuota, markObserved, type QuotaProvider, type QuotaWindow } from './types'
import { quotaRequestSignal, readSecureFile, sanitizeError } from './security'

const USAGE_ENDPOINT = 'https://api.kimi.com/coding/v1/usages'
const SOURCE = { kind: 'provider-api', stability: 'experimental' } as const
const kimiHome = process.env['KIMI_CODE_HOME'] ?? path.join(os.homedir(), '.kimi-code')

export type KimiDeps = {
  fetch: typeof fetch
  credentialPath: string
  deviceIdPath: string
  readFile: typeof readSecureFile
  now: () => number
}

const defaults: KimiDeps = {
  fetch: globalThis.fetch,
  credentialPath: path.join(kimiHome, 'credentials', 'kimi-code.json'),
  deviceIdPath: path.join(kimiHome, 'device_id'),
  readFile: readSecureFile,
  now: Date.now,
}

function empty(connection: QuotaProvider['connection']): QuotaProvider {
  return { ...emptyQuota('kimi', connection), source: SOURCE }
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function freshToken(deps: KimiDeps): Promise<string | null | 'expired'> {
  const raw = await deps.readFile(deps.credentialPath, 64 * 1024)
  if (!raw) return null
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const token = parsed.access_token
  if (typeof token !== 'string' || !token) return null
  const expiresAt = finiteNumber(parsed.expires_at)
  if (expiresAt === null || expiresAt <= deps.now() / 1000 + 60) return 'expired'
  return token
}

async function readDeviceId(deps: KimiDeps): Promise<string | null> {
  try {
    const raw = await deps.readFile(deps.deviceIdPath, 4 * 1024)
    return raw?.trim() || null
  } catch {
    return null
  }
}

function resetAt(value: unknown): string | null {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const date = new Date(Number(raw) * 1000)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function secondsForWindow(duration: unknown, timeUnit: unknown): number | null {
  const value = finiteNumber(duration)
  if (value === null || value <= 0 || typeof timeUnit !== 'string') return null
  const unit = timeUnit.toLowerCase().replace(/^time_unit_/, '').replace(/s$/, '')
  const multiplier = unit === 'second' ? 1
    : unit === 'minute' ? 60
      : unit === 'hour' ? 3600
        : unit === 'day' ? 86_400
          : unit === 'week' ? 604_800
            : null
  return multiplier === null ? null : Math.trunc(value * multiplier)
}

function windowLabel(duration: unknown, timeUnit: unknown): string {
  let value = finiteNumber(duration)
  if (value === null || value <= 0 || typeof timeUnit !== 'string' || !timeUnit) return 'Rate limit'
  let unit = timeUnit.toLowerCase().replace(/^time_unit_/, '').replace(/s$/, '')
  if (unit === 'minute' && value >= 60 && value % 60 === 0) { value /= 60; unit = 'hour' }
  const count = Math.trunc(value)
  if (unit === 'minute') return count === 1 ? 'Minutely' : `${count}-min`
  if (unit === 'hour') return count === 1 ? 'Hourly' : `${count}-hour`
  if (unit === 'day') return count === 1 ? 'Daily' : count === 7 ? 'Weekly' : `${count}-day`
  if (unit === 'week') return count === 1 ? 'Weekly' : `${count}-week`
  if (unit === 'month') return count === 1 ? 'Monthly' : `${count}-month`
  return `${count} ${unit}`
}

function quotaWindow(id: string, label: string, detail: unknown, windowSeconds: number | null = null): QuotaWindow | null {
  if (!detail || typeof detail !== 'object') return null
  const row = detail as Record<string, unknown>
  const limit = finiteNumber(row.limit)
  if (limit === null || limit <= 0) return null
  const remaining = finiteNumber(row.remaining)
  const used = finiteNumber(row.used) ?? Math.max(0, limit - (remaining ?? limit))
  return {
    id,
    label,
    usedFraction: Math.min(1, Math.max(0, used / limit)),
    resetsAt: resetAt(row.resetTime ?? row.resetAt ?? row.reset_time ?? row.reset_at),
    windowSeconds,
  }
}

function planLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return value.trim().replace(/^LEVEL_/i, '').replace(/_/g, ' ').toLowerCase()
    .replace(/(^|\s)\w/g, match => match.toUpperCase())
}

export function decodeKimiUsage(body: unknown): QuotaProvider | null {
  const data = body && typeof body === 'object' ? body as Record<string, any> : {}
  const windows: QuotaWindow[] = []
  const weekly = quotaWindow('weekly', 'Weekly', data.usage, 604_800)
  if (weekly) windows.push(weekly)
  for (const [index, limit] of (Array.isArray(data.limits) ? data.limits : []).entries()) {
    const duration = limit?.window?.duration
    const timeUnit = limit?.window?.timeUnit
    const window = quotaWindow(`rate:${index}`, windowLabel(duration, timeUnit), limit?.detail, secondsForWindow(duration, timeUnit))
    if (window) windows.push(window)
  }
  if (windows.length === 0) return null
  return {
    ...empty('connected'),
    planLabel: planLabel(data.user?.membership?.level),
    windows,
  }
}

function retryAfterSeconds(response: Response, now: number): number {
  const raw = response.headers.get('Retry-After')
  const numeric = raw === null ? NaN : Number(raw)
  if (Number.isFinite(numeric)) return Math.max(60, Math.ceil(numeric))
  const date = raw ? Date.parse(raw) : NaN
  return Math.max(60, Number.isFinite(date) ? Math.ceil((date - now) / 1000) : 300)
}

export type KimiResult = { quota: QuotaProvider; retryAfterSeconds?: number }

export async function fetchKimiQuota(options: Partial<KimiDeps> & { signal?: AbortSignal } = {}): Promise<KimiResult> {
  const deps = { ...defaults, ...options }
  try {
    const token = await freshToken(deps)
    if (token === null) return { quota: empty('disconnected') }
    if (token === 'expired') return { quota: empty('terminalFailure') }
    const deviceId = await readDeviceId(deps)
    const response = await deps.fetch(USAGE_ENDPOINT, {
      method: 'GET',
      signal: quotaRequestSignal(options.signal),
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'Metrora',
        'X-Msh-Platform': 'kimi_code_cli',
        ...(deviceId ? { 'X-Msh-Device-Id': deviceId } : {}),
      },
    })
    if (response.status === 401 || response.status === 403) return { quota: empty('terminalFailure') }
    if (response.status === 429) return { quota: empty('transientFailure'), retryAfterSeconds: retryAfterSeconds(response, deps.now()) }
    if (!response.ok) return { quota: empty(response.status >= 400 && response.status < 500 ? 'terminalFailure' : 'transientFailure') }
    const quota = decodeKimiUsage(await response.json())
    return { quota: quota ? markObserved(quota, deps.now()) : empty('transientFailure') }
  } catch (error) {
    console.warn(`Kimi Code capacity unavailable: ${sanitizeError(error)}`)
    return { quota: empty('transientFailure') }
  }
}