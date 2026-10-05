import { randomUUID } from 'crypto'

import { loadOrCreateIdentity, type Identity } from './identity.js'
import { PeerStore } from './pairing.js'
import { ShareServer, type ActivityQuery, type PairRequest, type PairResult, type UsageQuery } from './share-server.js'
import { advertise } from './discovery.js'
import { getSharingDir, loadPeers, savePeers } from './store.js'
import { buildPairingBootstrap } from './pairing-bootstrap.js'
import { getLanAddresses } from './network-address.js'

export type PendingPairing = { id: string; name: string; code: string }
/** Paired-device projection for UI lists. Never carries the token or the
 *  raw fingerprint — those stay in the PeerStore and the share server. */
export type PairedPeerSummary = { name: string; pairedAt: number }

/**
 * Terminal outcome of one approve-flow pairing request, confirmed for the
 * SPECIFIC request id. `paired` means the server persisted the peer;
 * anything else must never render as success. Carries no secret: only the
 * outcome class may cross to a UI, never tokens or fingerprints.
 */
export type PairingOutcome = 'paired' | 'declined' | 'expired' | 'persist-failed' | 'unknown'
export type ShareStatus = {
  sharing: boolean
  name: string
  port: number
  host: string | null
  addresses: string[]
  connectPayload: string | null
  networkWarning?: string
  always: boolean
  peers: number
  /** Optional so status payloads produced before the field existed stay valid. */
  peerList?: PairedPeerSummary[]
  pending: PendingPairing[]
}

const IDLE_TIMEOUT_MS = 10 * 60_000

// Runs the secure share server inside the dashboard process so the user can
// turn sharing on/off from the browser. Incoming approve-style pairings are
// queued and surfaced to the UI instead of prompting a terminal.
export class ShareController {
  private server: ShareServer | null = null
  private ad: ReturnType<typeof advertise> | null = null
  private peers: PeerStore | null = null
  private identity: Identity | null = null
  private always = false
  private boundPort = 0
  private lanAddresses: string[] = []
  private connectHost: string | null = null
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private lastActivity = 0
  private readonly dir = getSharingDir()
  private readonly pending = new Map<
    string,
    { name: string; code: string; fingerprint: string; resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >()
  // Request ids approved by the user but not yet confirmed persisted,
  // indexed by device fingerprint for the server's terminal hook.
  private readonly approvedPairings = new Map<string, string>()
  // Terminal outcomes per request id (bounded). A vanished pending entry is
  // NEVER completion evidence on its own: only a `paired` outcome recorded
  // here — after the server confirms persistence — proves the pairing.
  private readonly pairOutcomes = new Map<string, PairingOutcome>()
  private readonly pairOutcomeWaiters = new Map<string, Array<(outcome: PairingOutcome) => void>>()

  constructor(
    private readonly getUsage: (q: UsageQuery) => Promise<unknown>,
    private readonly port = 7777,
    private readonly getCapabilities?: () => Promise<unknown>,
    private readonly getFoundation?: (q: UsageQuery) => Promise<unknown>,
    private readonly getProjectCatalog?: () => Promise<unknown>,
    private readonly getActivitySessions?: (q: ActivityQuery) => Promise<unknown>,
    private readonly getActivitySessionDetail?: (q: ActivityQuery, id: string) => Promise<unknown | null>,
    private readonly getActivityPullRequests?: (q: ActivityQuery) => Promise<unknown>,
    private readonly getCapacity?: () => Promise<unknown>,
  ) {}

  private async getIdentity(): Promise<Identity> {
    if (!this.identity) this.identity = await loadOrCreateIdentity(this.dir)
    return this.identity
  }

  isSharing(): boolean {
    return !!this.server
  }

  async start(always: boolean): Promise<void> {
    if (this.server) {
      this.always = always
      this.refreshIdleWatch()
      return
    }
    const identity = await this.getIdentity()
    this.peers = new PeerStore(await loadPeers(this.dir))
    const server = new ShareServer({
      identity,
      peers: this.peers,
      getUsage: this.getUsage,
      getCapabilities: this.getCapabilities,
      getFoundation: this.getFoundation,
      getCapacity: this.getCapacity,
      getProjectCatalog: this.getProjectCatalog,
      getActivitySessions: this.getActivitySessions,
      getActivitySessionDetail: this.getActivitySessionDetail,
      getActivityPullRequests: this.getActivityPullRequests,
      onPeersChanged: () => this.peers ? savePeers(this.peers.list(), this.dir) : Promise.resolve(),
      approve: (req) => this.enqueueApproval(req),
      onPairResult: (result) => this.recordPairResult(result),
    })
    // listen() can reject (e.g. EADDRINUSE); only commit state after it binds,
    // so a failed start never leaves us reporting always/sharing incorrectly.
    const boundPort = await server.listen(this.port, '0.0.0.0')
    this.always = always
    this.server = server
    this.boundPort = boundPort
    this.lanAddresses = getLanAddresses()
    this.connectHost = this.lanAddresses[0] ?? '127.0.0.1'
    this.ad = advertise({ name: identity.name, port: boundPort, fingerprint: identity.fingerprint })
    this.lastActivity = Date.now()
    server.server.on('request', () => {
      this.lastActivity = Date.now()
    })
    this.refreshIdleWatch()
  }

  private refreshIdleWatch(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    if (this.always) return
    this.idleTimer = setInterval(() => {
      if (Date.now() - this.lastActivity > IDLE_TIMEOUT_MS) void this.stop()
    }, 30_000)
    this.idleTimer.unref?.()
  }

  async stop(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.resolve(false)
    }
    this.pending.clear()
    // An approval decided but not yet confirmed can no longer complete once
    // the service stops: settle its waiters instead of leaving them hanging
    // until the confirmation timeout.
    for (const id of [...this.pairOutcomeWaiters.keys()]) this.recordPairOutcome(id, 'expired')
    this.approvedPairings.clear()
    await this.ad?.stop().catch(() => {})
    await this.server?.close().catch(() => {})
    this.ad = null
    this.server = null
    this.boundPort = 0
    this.lanAddresses = []
    this.connectHost = null
  }

  private enqueueApproval(req: PairRequest): Promise<boolean> {
    // One outstanding request per device, and a hard cap, so a LAN peer cannot
    // flood the approval prompt or bury a legitimate request.
    for (const p of this.pending.values()) if (p.fingerprint === req.fingerprint) return Promise.resolve(false)
    if (this.pending.size >= 8) return Promise.resolve(false)
    return new Promise((resolve) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.recordPairOutcome(id, 'expired')
        resolve(false)
      }, 60_000)
      timer.unref?.()
      this.pending.set(id, { name: req.name, code: req.code, fingerprint: req.fingerprint, resolve, timer })
    })
  }

  listPending(): PendingPairing[] {
    return [...this.pending.entries()].map(([id, p]) => ({ id, name: p.name, code: p.code }))
  }

  resolvePending(id: string, approve: boolean): boolean {
    const p = this.pending.get(id)
    if (!p) return false
    clearTimeout(p.timer)
    this.pending.delete(id)
    if (approve) this.approvedPairings.set(p.fingerprint, id)
    p.resolve(approve)
    return true
  }

  /**
   * Resolve one pairing request with a positively confirmed terminal outcome
   * for that SPECIFIC request id. Approving a request that already vanished
   * (expiry, stop, concurrent decision) reports `expired`, never success.
   * An approval reports `paired` only after the server confirms the peer was
   * persisted; a failed save (rolled back server-side) reports
   * `persist-failed`. The confirmation wait is bounded: without a terminal
   * signal the outcome is `unknown`, which must also never render as success.
   */
  async approvePairingRequest(id: string, approve: boolean): Promise<PairingOutcome> {
    if (!approve) {
      const consumed = this.resolvePending(id, false)
      const outcome: PairingOutcome = consumed ? 'declined' : 'expired'
      this.recordPairOutcome(id, outcome)
      return outcome
    }
    if (!this.resolvePending(id, true)) {
      this.recordPairOutcome(id, 'expired')
      return 'expired'
    }
    return this.waitPairOutcome(id)
  }

  private recordPairOutcome(id: string, outcome: PairingOutcome): void {
    this.pairOutcomes.set(id, outcome)
    if (this.pairOutcomes.size > 32) {
      const oldest = this.pairOutcomes.keys().next()
      if (!oldest.done) this.pairOutcomes.delete(oldest.value)
    }
    const waiters = this.pairOutcomeWaiters.get(id)
    if (waiters) {
      this.pairOutcomeWaiters.delete(id)
      for (const waiter of waiters) waiter(outcome)
    }
  }

  private recordPairResult(result: PairResult): void {
    // Only approve-flow requests carry an id: the legacy PIN route pairs
    // without one, so an unmatched fingerprint is simply not a request
    // confirmation and must not fabricate an outcome.
    const id = this.approvedPairings.get(result.fingerprint)
    if (!id) return
    this.approvedPairings.delete(result.fingerprint)
    this.recordPairOutcome(id, result.ok ? 'paired' : 'persist-failed')
  }

  private waitPairOutcome(id: string, timeoutMs = 10_000): Promise<PairingOutcome> {
    const settled = this.pairOutcomes.get(id)
    if (settled !== undefined) return Promise.resolve(settled)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pairOutcomeWaiters.delete(id)
        this.approvedPairings.forEach((requestId, fingerprint) => {
          if (requestId === id) this.approvedPairings.delete(fingerprint)
        })
        resolve('unknown')
      }, timeoutMs)
      timer.unref?.()
      const waiter = (outcome: PairingOutcome): void => {
        clearTimeout(timer)
        resolve(outcome)
      }
      const existing = this.pairOutcomeWaiters.get(id)
      if (existing) existing.push(waiter)
      else this.pairOutcomeWaiters.set(id, [waiter])
    })
  }

  async status(): Promise<ShareStatus> {
    const identity = await this.getIdentity()
    const stored = this.peers ? this.peers.list() : await loadPeers(this.dir)
    const peerList: PairedPeerSummary[] = stored
      .map(peer => ({ name: peer.name, pairedAt: peer.pairedAt }))
      .sort((a, b) => b.pairedAt - a.pairedAt)
    return {
      sharing: this.isSharing(),
      name: identity.name,
      port: this.isSharing() ? this.boundPort : this.port,
      host: this.connectHost,
      addresses: [...this.lanAddresses],
      connectPayload: this.connectHost && this.isSharing()
        ? buildPairingBootstrap(this.connectHost, this.boundPort)
        : null,
      ...(this.isSharing() && this.connectHost === '127.0.0.1'
        ? { networkWarning: 'No non-loopback LAN address was detected; choose a local network address manually.' }
        : {}),
      always: this.always,
      peers: peerList.length,
      peerList,
      pending: this.listPending(),
    }
  }
}
