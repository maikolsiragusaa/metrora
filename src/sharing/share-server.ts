import { createServer, type Server } from 'https'
import type { IncomingMessage, ServerResponse } from 'http'
import type { TLSSocket } from 'tls'
import type { AddressInfo } from 'net'

import { periodInfoFromQuery, UsageQueryError } from '../cli-date.js'
import { toDateString } from '../daily-cache.js'
import { companionTrendGranularity, toCompanionUsageV1 } from './companion-contract.js'
import { certFingerprint, pairingCode, PeerStore, PairingWindow, type PairedPeer } from './pairing.js'
import type { Identity } from './identity.js'
import {
  type ActivityOrderV1,
  type ActivityQueryV1,
} from './activity-contract.js'

export type UsageQuery = {
  period?: string
  from?: string
  to?: string
  granularity?: 'day' | 'week' | 'month' | string
  projectScopeId?: string
  /** Desktop-resolved bounds; never supplied by the HTTP caller. */
  effectiveFrom?: string
  effectiveTo?: string
}

export type ActivityQuery = UsageQuery & {
  provider?: string
  route?: string
  model?: string
  source?: string
  order?: ActivityOrderV1 | string
  limit?: number | string
  cursor?: string
}

/**
 * Resolve the request once at the Desktop authority boundary. Usage and
 * Foundation must receive the same effective period, Project scope and trend
 * dimension; Android must never have to guess a period-dependent default.
 */
export function canonicalCompanionQuery(query: UsageQuery): UsageQuery {
  const normalized = { ...query, period: query.period?.trim() || 'month' }
  const periodInfo = periodInfoFromQuery(normalized, 'month')
  const bounds = {
    from: toDateString(periodInfo.range.start),
    to: toDateString(periodInfo.range.end),
  }
  const requestedGranularity = normalized.granularity?.trim() || undefined
  if (requestedGranularity && !['day', 'week', 'month'].includes(requestedGranularity)) {
    throw new UsageQueryError('Unknown trend granularity. Valid values: day, week, month.')
  }
  return {
    ...normalized,
    effectiveFrom: bounds.from,
    effectiveTo: bounds.to,
    granularity: requestedGranularity ?? companionTrendGranularity(normalized, bounds),
    projectScopeId: normalized.projectScopeId?.trim() || 'all',
  }
}

function boundedActivityFilter(value: string | undefined, label: string): string | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new UsageQueryError(`Invalid Activity ${label} filter.`)
  }
  return normalized
}

/** Resolve Activity query identity once at the Desktop authority boundary. */
export function canonicalActivityQuery(query: ActivityQuery): ActivityQueryV1 & { cursor?: string } {
  const base = canonicalCompanionQuery(query)
  const order = query.order?.trim() || 'newest'
  if (!['newest', 'cost', 'tokens', 'calls'].includes(order)) {
    throw new UsageQueryError('Unknown Activity ordering. Valid values: newest, cost, tokens, calls.')
  }
  const rawLimit = query.limit === undefined || query.limit === '' ? 40 : Number(query.limit)
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
    throw new UsageQueryError('Activity page size must be an integer from 1 to 50.')
  }
  const cursor = query.cursor?.trim() || undefined
  if (cursor && cursor.length > 768) throw new UsageQueryError('Activity cursor is too long.')
  return {
    period: base.period ?? 'month',
    projectScopeId: base.projectScopeId ?? 'all',
    effectiveFrom: base.effectiveFrom!,
    effectiveTo: base.effectiveTo!,
    ...(boundedActivityFilter(query.provider, 'provider') ? { provider: boundedActivityFilter(query.provider, 'provider') } : {}),
    ...(boundedActivityFilter(query.route, 'route') ? { route: boundedActivityFilter(query.route, 'route') } : {}),
    ...(boundedActivityFilter(query.model, 'model') ? { model: boundedActivityFilter(query.model, 'model') } : {}),
    ...(boundedActivityFilter(query.source, 'source') ? { source: boundedActivityFilter(query.source, 'source') } : {}),
    order: order as ActivityOrderV1,
    limit: rawLimit,
    ...(cursor ? { cursor } : {}),
  }
}

// An approve-style pairing request, surfaced to the user on the sharing device.
export type PairRequest = { name: string; fingerprint: string; code: string }

export type ShareServerOptions = {
  identity: Identity
  peers: PeerStore
  getUsage: (query: UsageQuery) => Promise<unknown>
  /** Optional bounded capability discovery; absent means unavailable. */
  getCapabilities?: () => Promise<unknown>
  /** Optional bounded mobile foundation projection. */
  getFoundation?: (query: UsageQuery) => Promise<unknown>
  /** Optional non-period-scoped Project catalog projection. */
  getProjectCatalog?: () => Promise<unknown>
  /** Additive bounded Activity projections; Foundation remains unchanged. */
  getActivitySessions?: (query: ActivityQuery) => Promise<unknown>
  getActivitySessionDetail?: (query: ActivityQuery, id: string) => Promise<unknown | null>
  getActivityPullRequests?: (query: ActivityQuery) => Promise<unknown>
  // Legacy callback kept for compatibility with existing embedders.
  onPaired?: () => void | Promise<void>
  // Called after pairing or revocation so the caller can durably persist peers.
  onPeersChanged?: () => void | Promise<void>
  // Enables the interactive approve flow (POST /api/peer/pair-request): return
  // true to accept. The user confirms the matching `code` shown on both devices.
  approve?: (req: PairRequest) => Promise<boolean>
}

export const SHARE_API_VERSION = 1 as const

const SHARE_REQUEST_BASE_URL = 'https://localhost'
const INVALID_SHARE_REQUEST_URL = 'invalid sharing request URL'

class ShareRequestUrlError extends Error {}

/** Parse only HTTPS/origin-form request targets without reflecting private input. */
export function parseShareRequestUrl(value: string | undefined): URL {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ShareRequestUrlError(INVALID_SHARE_REQUEST_URL)
  }
  let parsed: URL
  try {
    parsed = new URL(value, SHARE_REQUEST_BASE_URL)
  } catch {
    throw new ShareRequestUrlError(INVALID_SHARE_REQUEST_URL)
  }
  if (parsed.protocol !== 'https:') throw new ShareRequestUrlError(INVALID_SHARE_REQUEST_URL)
  return parsed
}

/**
 * Keep the inherited unversioned routes working while making `/api/v1` the
 * stable first-party surface for Metrora companions and integrations.
 */
export function canonicalSharePath(pathname: string): string {
  if (pathname === '/api/v1') return '/api'
  if (pathname.startsWith('/api/v1/')) return `/api/${pathname.slice('/api/v1/'.length)}`
  return pathname
}

// A device's HTTPS sharing endpoint. Mutual TLS: the server presents its own
// self-signed cert (clients pin its fingerprint) and requests the client's cert
// so it can bind tokens to the caller's fingerprint. A pull is served only when
// the bearer token AND the client cert fingerprint match the same paired peer.
export class ShareServer {
  readonly server: Server
  private pairing: PairingWindow | null = null

  constructor(private readonly opts: ShareServerOptions) {
    this.server = createServer(
      { key: opts.identity.key, cert: opts.identity.cert, requestCert: true, rejectUnauthorized: false },
      (req, res) => {
        void this.handle(req, res)
      },
    )
    // Swallow server-level socket/TLS errors (e.g. a malformed handshake from a
    // LAN peer) so they can never crash the host process. `listen()` attaches
    // its own one-time handler for bind failures.
    this.server.on('error', () => {})
    this.server.on('tlsClientError', () => {})
  }

  // Open a one-time legacy pairing window and return the PIN to show the user.
  openPairing(ttlMs = 60_000): string {
    this.pairing = new PairingWindow(ttlMs)
    return this.pairing.pin
  }

  closePairing(): void {
    this.pairing = null
  }

  listen(port: number, host = '0.0.0.0'): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, host, () => resolve((this.server.address() as AddressInfo).port))
    })
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  private clientFingerprint(req: IncomingMessage): string | null {
    const cert = (req.socket as TLSSocket).getPeerCertificate?.()
    if (!cert || !cert.raw) return null
    return certFingerprint(cert.raw)
  }

  private async notifyPeersChanged(): Promise<void> {
    if (this.opts.onPeersChanged) await this.opts.onPeersChanged()
    else await this.opts.onPaired?.()
  }

  private async pairAndPersist(fingerprint: string, name: string): Promise<PairedPeer> {
    const previous = this.opts.peers.get(fingerprint)
    const peer = this.opts.peers.pair(fingerprint, name)
    try {
      await this.notifyPeersChanged()
      return peer
    } catch (error) {
      if (previous) this.opts.peers.restore(previous)
      else this.opts.peers.unpair(fingerprint)
      throw error
    }
  }

  private async revokeAndPersist(fingerprint: string): Promise<boolean> {
    const previous = this.opts.peers.get(fingerprint)
    if (!previous || !this.opts.peers.unpair(fingerprint)) return false
    try {
      await this.notifyPeersChanged()
      return true
    } catch (error) {
      this.opts.peers.restore(previous)
      throw error
    }
  }

  private authorizedPeer(req: IncomingMessage): { fingerprint: string; token: string } | null {
    const fingerprint = this.clientFingerprint(req)
    const token = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '')
    if (!fingerprint || !token || !this.opts.peers.authorize(token, fingerprint)) return null
    return { fingerprint, token }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = (code: number, body: unknown): void => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    try {
      const url = parseShareRequestUrl(req.url)
      await this.route(url, req, res, json)
    } catch (err) {
      // Never leave a request hanging (a hung peer makes the caller time out
      // and drop this device); always answer, even on an internal error.
      if (!res.headersSent) {
        if (err instanceof ShareRequestUrlError) {
          json(400, { error: INVALID_SHARE_REQUEST_URL })
        } else if (err instanceof UsageQueryError) {
          json(400, { error: err.message })
        } else {
          const message = err instanceof Error ? err.message : String(err)
          json(500, { error: message })
        }
      }
    }
  }

  private async route(
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
    json: (code: number, body: unknown) => void,
  ): Promise<void> {
    const requestedPath = url.pathname
    const pathname = canonicalSharePath(requestedPath)

    // Unauthenticated: just enough for a joiner to learn who this is and whether
    // legacy PIN pairing is currently open. No usage data here.
    if (pathname === '/api/peer/hello' && req.method === 'GET') {
      json(200, {
        product: 'metrora',
        apiVersion: SHARE_API_VERSION,
        apiVersions: [SHARE_API_VERSION],
        fingerprint: this.opts.identity.fingerprint,
        name: this.opts.identity.name,
        pairingOpen: !!this.pairing?.isOpen(),
        pairingMethods: ['approve-sas', ...(this.pairing?.isOpen() ? ['legacy-pin'] : [])],
      })
      return
    }

    // Compatibility fallback for inherited clients. First-party Metrora
    // companions must use pair-request and compare the SAS on both devices.
    if (pathname === '/api/peer/pair' && req.method === 'POST') {
      const clientFp = this.clientFingerprint(req)
      if (!clientFp) {
        json(400, { error: 'client certificate required' })
        return
      }
      const body = safeJson(await readBody(req)) as { pin?: unknown; name?: unknown } | null
      const pin = typeof body?.pin === 'string' ? body.pin : ''
      const name = typeof body?.name === 'string' ? body.name.slice(0, 120) : 'device'
      if (!this.pairing || !this.pairing.verify(pin)) {
        json(401, { error: 'invalid or expired PIN' })
        return
      }
      this.pairing = null
      const peer = await this.pairAndPersist(clientFp, name)
      json(200, { token: peer.token, name: this.opts.identity.name, fingerprint: this.opts.identity.fingerprint })
      return
    }

    if (pathname === '/api/peer/pair-request' && req.method === 'POST') {
      const clientFp = this.clientFingerprint(req)
      if (!clientFp) {
        json(400, { error: 'client certificate required' })
        return
      }
      if (!this.opts.approve) {
        json(403, { error: 'this device is not accepting new pairings' })
        return
      }
      const body = safeJson(await readBody(req)) as { name?: unknown } | null
      const name = typeof body?.name === 'string' ? body.name.slice(0, 120) : 'device'
      const code = pairingCode(this.opts.identity.fingerprint, clientFp)
      const approved = await this.opts.approve({ name, fingerprint: clientFp, code })
      if (!approved) {
        json(403, { error: 'pairing declined' })
        return
      }
      const peer = await this.pairAndPersist(clientFp, name)
      json(200, { token: peer.token, name: this.opts.identity.name, fingerprint: this.opts.identity.fingerprint, code })
      return
    }

    if (pathname === '/api/peer/revoke' && req.method === 'POST') {
      const authorized = this.authorizedPeer(req)
      if (!authorized) {
        json(401, { error: 'unauthorized' })
        return
      }
      if (!await this.revokeAndPersist(authorized.fingerprint)) {
        json(401, { error: 'unauthorized' })
        return
      }
      json(200, { revoked: true })
      return
    }

    if (pathname === '/api/capabilities' && req.method === 'GET') {
      if (!this.authorizedPeer(req)) {
        json(401, { error: 'unauthorized' })
        return
      }
      if (!this.opts.getCapabilities) {
        json(404, { error: 'capability unavailable' })
        return
      }
      json(200, await this.opts.getCapabilities())
      return
    }

    if (pathname === '/api/foundation' && req.method === 'GET') {
      if (!this.authorizedPeer(req)) {
        json(401, { error: 'unauthorized' })
        return
      }
      if (!this.opts.getFoundation) {
        json(404, { error: 'capability unavailable' })
        return
      }
      const query = canonicalCompanionQuery({
        period: url.searchParams.get('period') ?? undefined,
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        granularity: url.searchParams.get('granularity') ?? undefined,
        projectScopeId: url.searchParams.get('projectScopeId') ?? undefined,
      })
      json(200, await this.opts.getFoundation(query))
      return
    }

    if (pathname === '/api/projects' && req.method === 'GET') {
      if (!this.authorizedPeer(req)) {
        json(401, { error: 'unauthorized' })
        return
      }
      if (!this.opts.getProjectCatalog) {
        json(404, { error: 'capability unavailable' })
        return
      }
      const payload = await this.opts.getProjectCatalog()
      if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
        json(200, { ...payload as Record<string, unknown>, desktopId: this.opts.identity.fingerprint })
      } else {
        json(200, payload)
      }
      return
    }

    const activitySessionDetail = pathname.match(/^\/api\/activity\/sessions\/([a-zA-Z0-9_-]{1,80})$/)
    if (activitySessionDetail && req.method === 'GET') {
      if (!this.authorizedPeer(req)) {
        json(401, { error: 'unauthorized' })
        return
      }
      if (!this.opts.getActivitySessionDetail) {
        json(404, { error: 'activity capability unavailable' })
        return
      }
      const query = canonicalActivityQuery(activityQueryFromUrl(url))
      const payload = await this.opts.getActivitySessionDetail(query, activitySessionDetail[1]!)
      if (payload === null) {
        json(404, { error: 'session not found' })
        return
      }
      json(200, withDesktopId(payload, this.opts.identity.fingerprint))
      return
    }

    if (pathname === '/api/activity/sessions' && req.method === 'GET') {
      if (!this.authorizedPeer(req)) {
        json(401, { error: 'unauthorized' })
        return
      }
      if (!this.opts.getActivitySessions) {
        json(404, { error: 'activity capability unavailable' })
        return
      }
      const query = canonicalActivityQuery(activityQueryFromUrl(url))
      json(200, withDesktopId(await this.opts.getActivitySessions(query), this.opts.identity.fingerprint))
      return
    }

    if (pathname === '/api/activity/pull-requests' && req.method === 'GET') {
      if (!this.authorizedPeer(req)) {
        json(401, { error: 'unauthorized' })
        return
      }
      if (!this.opts.getActivityPullRequests) {
        json(404, { error: 'activity capability unavailable' })
        return
      }
      const query = canonicalActivityQuery(activityQueryFromUrl(url))
      json(200, withDesktopId(await this.opts.getActivityPullRequests(query), this.opts.identity.fingerprint))
      return
    }

    if (pathname === '/api/usage' && req.method === 'GET') {
      if (!this.authorizedPeer(req)) {
        json(401, { error: 'unauthorized' })
        return
      }
      const query = canonicalCompanionQuery({
        period: url.searchParams.get('period') ?? undefined,
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        granularity: url.searchParams.get('granularity') ?? undefined,
        projectScopeId: url.searchParams.get('projectScopeId') ?? undefined,
      })
      const payload = await this.opts.getUsage(query)
      // The versioned companion surface is an explicit DTO. The inherited
      // unversioned route keeps its legacy payload for compatible desktop peers.
      json(200, requestedPath === '/api/v1/usage'
        ? toCompanionUsageV1(payload, query)
        : payload)
      return
    }

    json(404, { error: 'not found' })
  }
}

function activityQueryFromUrl(url: URL): ActivityQuery {
  return {
    period: url.searchParams.get('period') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    granularity: url.searchParams.get('granularity') ?? undefined,
    projectScopeId: url.searchParams.get('projectScopeId') ?? undefined,
    provider: url.searchParams.get('provider') ?? undefined,
    route: url.searchParams.get('route') ?? undefined,
    model: url.searchParams.get('model') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
    order: url.searchParams.get('order') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  }
}

function withDesktopId(payload: unknown, desktopId: string): unknown {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return { ...payload as Record<string, unknown>, desktopId }
  }
  return payload
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1_000_000) req.destroy() // guard against oversized bodies
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(data))
  })
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
