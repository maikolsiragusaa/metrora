import { execFile } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import { promisify } from 'node:util'

import { emptyQuota, markObserved, type QuotaProvider, type QuotaWindow } from './types'
import { sanitizeError } from './security'

const SOURCE = { kind: 'provider-loopback', stability: 'experimental' } as const
const SUMMARY_PATH = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary'
const STATUS_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus'
const LOCAL_TIMEOUT_MS = 3_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_CANDIDATES = 8
const MAX_PORTS_PER_PROCESS = 16

export type ExecFileFn = (file: string, args: string[]) => Promise<{ stdout: string }>
export type LocalRequestFn = (
  port: number,
  tls: boolean,
  pathName: string,
  csrf: string,
) => Promise<{ status: number; text: string } | null>

export type AntigravityDeps = {
  execFile: ExecFileFn
  request: LocalRequestFn
  platform: NodeJS.Platform
  now: () => number
}

const execFileAsync: ExecFileFn = async (file, args) => promisify(execFile)(file, args, {
  encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
}) as Promise<{ stdout: string }>

function postLocal(port: number, tls: boolean, pathName: string, csrf: string): Promise<{ status: number; text: string } | null> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value: { status: number; text: string } | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const client = tls ? https : http
    const request = client.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: pathName,
      ...(tls ? { rejectUnauthorized: false } : {}),
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': csrf,
        'Content-Length': '2',
      },
      timeout: LOCAL_TIMEOUT_MS,
    }, response => {
      const chunks: Buffer[] = []
      let bytes = 0
      response.on('data', chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > MAX_RESPONSE_BYTES) {
          response.destroy()
          finish(null)
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => finish({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
      response.on('error', () => finish(null))
    })
    request.on('timeout', () => { request.destroy(); finish(null) })
    request.on('error', () => finish(null))
    request.end('{}')
  })
}

const defaults: AntigravityDeps = {
  execFile: execFileAsync,
  request: postLocal,
  platform: process.platform,
  now: Date.now,
}

function empty(connection: QuotaProvider['connection']): QuotaProvider {
  return { ...emptyQuota('antigravity', connection), source: SOURCE }
}

type Candidate = { pid: string; port: number | null; csrf: string }

function flagValue(line: string, names: string[]): string | null {
  for (const name of names) {
    const match = line.match(new RegExp(`--${name}(?:=|\\s+)(?:\"([^\"]+)\"|'([^']+)'|([^\\s]+))`, 'i'))
    const value = match?.[1] ?? match?.[2] ?? match?.[3]
    if (value && !value.startsWith('--')) return value
  }
  return null
}

function parseCandidate(pid: string, line: string): Candidate | null {
  const lower = line.toLowerCase().replace(/\\/g, '/')
  if (!lower.includes('language_server') || !lower.includes('antigravity')) return null
  // Capacity V1 deliberately attaches only to the desktop app. The IDE and
  // managed CLI lifecycle are separate sources with different evidence depth.
  const appData = flagValue(line, ['app_data_dir', 'app-data-dir'])?.toLowerCase() ?? ''
  if (appData.includes('antigravity-ide') || appData.includes('antigravity-cli')) return null
  const csrf = flagValue(line, ['csrf_token', 'extension_server_csrf_token', 'csrf-token', 'extension-server-csrf-token'])
  if (!csrf || csrf.length < 16 || !/^[A-Za-z0-9._~:/+=-]+$/.test(csrf)) return null
  const rawPort = flagValue(line, ['https_server_port', 'extension_server_port', 'https-server-port', 'extension-server-port'])
  const numericPort = rawPort ? Number(rawPort) : NaN
  const port = Number.isInteger(numericPort) && numericPort > 0 && numericPort <= 65535 ? numericPort : null
  return { pid, port, csrf }
}

async function processCandidates(deps: AntigravityDeps): Promise<Candidate[]> {
  const rows: Array<{ pid: string; command: string }> = []
  if (deps.platform === 'win32') {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*language_server*' -and $_.CommandLine -like '*antigravity*' } | ForEach-Object { @{ PID = $_.ProcessId; Cmd = $_.CommandLine } | ConvertTo-Json -Compress }",
    ].join('; ')
    const { stdout } = await deps.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script])
    for (const line of stdout.split(/\r?\n/).slice(0, 64)) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line) as { PID?: unknown; Cmd?: unknown }
        if (Number.isInteger(row.PID) && typeof row.Cmd === 'string') rows.push({ pid: String(row.PID), command: row.Cmd })
      } catch { /* ignore malformed process rows */ }
    }
  } else {
    const { stdout } = await deps.execFile('ps', ['-ww', '-eo', 'pid=,args='])
    for (const line of stdout.split('\n').slice(0, 512)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/)
      if (match) rows.push({ pid: match[1]!, command: match[2]! })
    }
  }
  return rows.flatMap(row => {
    const candidate = parseCandidate(row.pid, row.command)
    return candidate ? [candidate] : []
  }).slice(0, MAX_CANDIDATES)
}

async function listeningPorts(deps: AntigravityDeps, pid: string): Promise<number[]> {
  try {
    const stdout = deps.platform === 'win32'
      ? (await deps.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Get-NetTCPConnection -State Listen -OwningProcess ${pid} | Select-Object -ExpandProperty LocalPort`])).stdout
      : (await deps.execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', pid])).stdout
    const candidates = deps.platform === 'win32'
      ? stdout.split(/\r?\n/).map(row => Number(row.trim()))
      : [...stdout.matchAll(/:(\d+)\s+\(LISTEN\)/g)].map(match => Number(match[1]))
    return [...new Set(candidates)]
      .filter(port => Number.isInteger(port) && port > 0 && port <= 65535)
      .slice(0, MAX_PORTS_PER_PROCESS)
  } catch {
    return []
  }
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return null }
}

function resetAt(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value > 1e12 ? value : value * 1000)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  return null
}

function secondsFromLabel(label: string): number | null {
  const lower = label.toLowerCase()
  if (lower.includes('weekly') || lower.includes('7-day') || lower.includes('7 day')) return 604_800
  if (lower.includes('5-hour') || lower.includes('5 hour')) return 18_000
  if (lower.includes('daily')) return 86_400
  return null
}

function fromRemaining(id: string, label: string, remainingFraction: unknown, reset?: unknown): QuotaWindow | null {
  if (typeof remainingFraction !== 'number' || !Number.isFinite(remainingFraction)) return null
  const remaining = Math.min(1, Math.max(0, remainingFraction))
  return {
    id,
    label,
    usedFraction: Number((1 - remaining).toFixed(6)),
    resetsAt: resetAt(reset),
    windowSeconds: secondsFromLabel(label),
  }
}

export function decodeAntigravitySummary(body: unknown): QuotaWindow[] {
  const envelope = body && typeof body === 'object' ? body as Record<string, any> : {}
  const data = envelope.response && typeof envelope.response === 'object' ? envelope.response : envelope
  const windows: QuotaWindow[] = []
  for (const [groupIndex, group] of (Array.isArray(data.groups) ? data.groups : []).entries()) {
    const groupName = typeof group?.displayName === 'string' && group.displayName.trim() ? group.displayName.trim() : `Quota group ${groupIndex + 1}`
    for (const [bucketIndex, bucket] of (Array.isArray(group?.buckets) ? group.buckets : []).entries()) {
      const bucketName = typeof bucket?.displayName === 'string' && bucket.displayName.trim()
        ? bucket.displayName.trim()
        : typeof bucket?.bucketId === 'string' && bucket.bucketId.trim()
          ? bucket.bucketId.trim()
          : `Window ${bucketIndex + 1}`
      const identity = typeof bucket?.bucketId === 'string' && bucket.bucketId.trim() ? bucket.bucketId.trim() : `${groupIndex}:${bucketIndex}`
      const window = fromRemaining(`summary:${identity}`, `${groupName} · ${bucketName}`, bucket?.remaining?.remainingFraction)
      if (window) windows.push(window)
    }
  }
  return windows
}

export function decodeAntigravityStatus(body: unknown): { windows: QuotaWindow[]; planLabel: string | null } {
  const envelope = body && typeof body === 'object' ? body as Record<string, any> : {}
  const data = envelope.response && typeof envelope.response === 'object' ? envelope.response : envelope
  const configs = data.userStatus?.cascadeModelConfigData?.clientModelConfigs ?? data.cascadeModelConfigData?.clientModelConfigs
  const windows: QuotaWindow[] = []
  for (const [index, config] of (Array.isArray(configs) ? configs : []).entries()) {
    const label = typeof config?.modelName === 'string' && config.modelName.trim() ? config.modelName.trim() : `Model ${index + 1}`
    const window = fromRemaining(`model:${label}`, label, config?.quotaInfo?.remainingFraction, config?.quotaInfo?.resetTime)
    if (window) windows.push(window)
  }
  const rawPlan = data.planName ?? data.userStatus?.planName ?? data.account_plan
  return { windows, planLabel: typeof rawPlan === 'string' && rawPlan.trim() ? rawPlan.trim() : null }
}

async function probe(deps: AntigravityDeps, candidate: Candidate, port: number): Promise<QuotaProvider | null> {
  for (const tls of [true, false]) {
    const summary = await deps.request(port, tls, SUMMARY_PATH, candidate.csrf)
    if (summary?.status === 200) {
      const windows = decodeAntigravitySummary(parseJson(summary.text))
      if (windows.length > 0) return { ...empty('connected'), windows }
    }
    const status = await deps.request(port, tls, STATUS_PATH, candidate.csrf)
    if (status?.status === 200) {
      const decoded = decodeAntigravityStatus(parseJson(status.text))
      if (decoded.windows.length > 0 || decoded.planLabel) return { ...empty('connected'), ...decoded }
    }
  }
  return null
}

export async function fetchAntigravityQuota(options: Partial<AntigravityDeps> = {}): Promise<{ quota: QuotaProvider }> {
  const deps = { ...defaults, ...options }
  try {
    const candidates = await processCandidates(deps)
    for (const candidate of candidates) {
      const ports = candidate.port ? [candidate.port] : await listeningPorts(deps, candidate.pid)
      for (const port of ports) {
        const quota = await probe(deps, candidate, port)
        if (quota) return { quota: markObserved(quota, deps.now()) }
      }
    }
    return { quota: empty('disconnected') }
  } catch (error) {
    console.warn(`Antigravity capacity unavailable: ${sanitizeError(error)}`)
    return { quota: empty('transientFailure') }
  }
}