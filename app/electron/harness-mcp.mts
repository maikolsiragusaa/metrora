import path from 'node:path'

import type { Config as DshMcpConfig } from '@deepseek-ai/dsh-mcp-client'

import type { HarnessMcpServerConfig, HarnessMcpServerStatus } from './harness-runtime-types.js'

export const MCP_TOOL_PREFIX = 'mcp__'
const SERVER_NAME_PATTERN = /^[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+){0,7}$/u
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,96}$/u
const SECRET_REFERENCE_PATTERN = /^mcp:[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+){0,7}:[A-Za-z0-9_.-]{1,96}$/u
const MAX_SERVERS = 16
const MAX_ARGS = 64
const MAX_ENV_ENTRIES = 32
const MAX_HEADERS = 32

export function isHarnessProtectedSecretReference(value: unknown): value is string {
  return typeof value === 'string' && SECRET_REFERENCE_PATTERN.test(value)
}

function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${field} must be text.`)
  if (!allowEmpty && !value.trim()) throw new Error(`${field} is required.`)
  if (value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${field} is invalid or too long.`)
  return value
}

function safeRecord(value: unknown, field: string, maxEntries: number, keyPattern: RegExp, valueMax: number, rejectSecretKeys: boolean): Record<string, string> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be a record.`)
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (Object.keys(result).length >= maxEntries) throw new Error(`${field} has too many entries.`)
    if (!keyPattern.test(key)) throw new Error(`${field} contains an invalid name.`)
    if (rejectSecretKeys && /(?:^|[_-])(api[-_]?key|token|secret|password|authorization|credential)(?:$|[_-])/iu.test(key)) {
      throw new Error(`${field}.${key} must use a protected credential reference.`)
    }
    result[key] = text(raw, `${field}.${key}`, valueMax, true)
  }
  return result
}

function secretRefs(value: unknown, field: string, maxEntries: number, keyPattern: RegExp): Record<string, string> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be a record.`)
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (Object.keys(result).length >= maxEntries) throw new Error(`${field} has too many entries.`)
    if (!keyPattern.test(key) || typeof raw !== 'string' || !isHarnessProtectedSecretReference(raw)) throw new Error(`${field} contains an invalid protected reference.`)
    result[key] = raw
  }
  return result
}

function args(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('MCP stdio args must be an array.')
  if (value.length > MAX_ARGS) throw new Error('MCP stdio args are too numerous.')
  return value.map((item, index) => text(item, `MCP stdio arg ${index + 1}`, 1_024, true))
}

function serverName(value: unknown): string {
  const result = text(value, 'MCP server name', 32)
  if (!SERVER_NAME_PATTERN.test(result)) throw new Error('MCP server name must use letters, numbers, hyphens and single underscores.')
  return result
}

function normalizeServer(value: unknown): HarnessMcpServerConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP server configuration is invalid.')
  const row = value as Record<string, unknown>
  const name = serverName(row.serverName)
  const id = text(row.id ?? name, 'MCP server id', 32)
  if (id !== name) throw new Error('MCP server id must equal its stable server name.')
  const enabled = row.enabled !== false
  if (row.transport === 'stdio') {
    const rawCwd = row.cwd === undefined || row.cwd === null || row.cwd === '' ? null : text(row.cwd, 'MCP stdio cwd', 2_048)
    if (rawCwd && !path.isAbsolute(rawCwd)) throw new Error('MCP stdio cwd must be absolute.')
    const cwd = rawCwd ? path.resolve(rawCwd) : null
    return {
      id,
      serverName: name,
      enabled,
      transport: 'stdio',
      command: text(row.command, 'MCP stdio command', 512),
      args: args(row.args),
      cwd,
      env: safeRecord(row.env, 'MCP stdio env', MAX_ENV_ENTRIES, ENV_NAME_PATTERN, 512, true),
      envRefs: secretRefs(row.envRefs, 'MCP stdio envRefs', MAX_ENV_ENTRIES, ENV_NAME_PATTERN),
    }
  }
  if (row.transport === 'streamable-http') {
    const rawUrl = text(row.url, 'MCP Streamable HTTP URL', 2_048)
    let url: URL
    try { url = new URL(rawUrl) } catch { throw new Error('MCP Streamable HTTP URL is invalid.') }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('MCP Streamable HTTP URL must use http or https.')
    if (url.username || url.password) throw new Error('MCP Streamable HTTP URL must not contain credentials.')
    return {
      id,
      serverName: name,
      enabled,
      transport: 'streamable-http',
      url: url.toString(),
      headers: safeRecord(row.headers, 'MCP HTTP headers', MAX_HEADERS, HEADER_NAME_PATTERN, 512, true),
      headerRefs: secretRefs(row.headerRefs, 'MCP HTTP headerRefs', MAX_HEADERS, HEADER_NAME_PATTERN),
    }
  }
  throw new Error('MCP transport must be stdio or streamable-http.')
}

/** Strict boundary used by profile mutations and IPC configuration writes. */
export function validateHarnessMcpServers(value: unknown): HarnessMcpServerConfig[] {
  if (!Array.isArray(value)) throw new Error('MCP server configuration must be an array.')
  if (value.length > MAX_SERVERS) throw new Error(`MCP supports at most ${MAX_SERVERS} configured servers.`)
  const result = value.map(normalizeServer)
  const names = new Set<string>()
  for (const item of result) {
    if (names.has(item.serverName)) throw new Error(`MCP server "${item.serverName}" is configured more than once.`)
    names.add(item.serverName)
  }
  return structuredClone(result)
}

/** Lenient reader for old/corrupt profile files: invalid rows are dropped. */
export function parseHarnessMcpServers(value: unknown): HarnessMcpServerConfig[] {
  if (!Array.isArray(value)) return []
  const rows: HarnessMcpServerConfig[] = []
  const names = new Set<string>()
  for (const candidate of value.slice(0, MAX_SERVERS)) {
    try {
      const row = normalizeServer(candidate)
      if (names.has(row.serverName)) continue
      names.add(row.serverName)
      rows.push(row)
    } catch { /* malformed stored config is ignored and never mounted */ }
  }
  return rows
}

export async function resolveDshMcpConfig(server: HarnessMcpServerConfig, readSecret: (reference: string) => Promise<string | null>, fallbackCwd: string): Promise<DshMcpConfig> {
  if (server.transport === 'stdio') {
    const env = { ...server.env }
    for (const [name, reference] of Object.entries(server.envRefs)) {
      const value = await readSecret(reference)
      if (value === null) throw new Error(`Protected MCP environment reference ${reference} is not configured.`)
      env[name] = value
    }
    return {
      transport: 'stdio',
      serverName: server.serverName,
      command: server.command,
      args: [...server.args],
      env,
      cwd: server.cwd ?? path.resolve(fallbackCwd),
      toolCallTimeoutMs: 60_000,
      failOnStartupError: true,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    }
  }
  const headers = { ...server.headers }
  for (const [name, reference] of Object.entries(server.headerRefs)) {
    const value = await readSecret(reference)
    if (value === null) throw new Error(`Protected MCP header reference ${reference} is not configured.`)
    headers[name] = value
  }
  return {
    transport: 'streamable-http',
    serverName: server.serverName,
    url: server.url,
    headers,
    toolCallTimeoutMs: 60_000,
    failOnStartupError: true,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  }
}

export function mcpSourceForTool(name: string): { kind: 'mcp'; serverName: string; toolName: string } | undefined {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined
  const rest = name.slice(MCP_TOOL_PREFIX.length)
  const separator = rest.indexOf('__')
  if (separator <= 0 || separator === rest.length - 2) return undefined
  return { kind: 'mcp', serverName: rest.slice(0, separator), toolName: rest.slice(separator + 2) }
}

/** Startup errors are useful for status diagnosis but must not become a
 * renderer-side channel for command paths or credentials echoed by a server.
 * Keep this projection deliberately narrower than the full Harness text
 * projector because MCP errors can originate outside Metrora's code. */
export function projectMcpStatusDetail(value: unknown): string {
  const raw = typeof value === 'string' && value.trim() ? value : 'MCP server could not be connected.'
  const safe = raw
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>|]+/gu, '[redacted path]')
    .replace(/(?:^|\s)(?:\\\\|\/)(?:[^\s"'<>|]+[\\/])*[^\s"'<>|]+/gu, ' [redacted path]')
    .replace(/\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|password|credential|token)\b\s*(?:=|:)\s*[^\s,;]+/giu, '[redacted secret]')
    .replace(/\bbearer\s+[^\s,;]+/giu, '[redacted secret]')
    .replace(/\s+/gu, ' ')
    .trim()
  return text(safe, 'MCP status detail', 240, true)
}

export function statusForMcpServer(server: HarnessMcpServerConfig, state: HarnessMcpServerStatus['state'], toolNames: readonly string[], detail: string, checkedAt = new Date().toISOString()): HarnessMcpServerStatus {
  return {
    id: server.id,
    serverName: server.serverName,
    transport: server.transport,
    enabled: server.enabled,
    state,
    toolCount: Math.min(toolNames.length, 256),
    toolNames: [...toolNames].slice(0, 256),
    detail: projectMcpStatusDetail(detail),
    checkedAt,
  }
}
