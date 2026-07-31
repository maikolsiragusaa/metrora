import { randomBytes, createHash, timingSafeEqual } from 'crypto'

// Device identity is the SHA-256 of its self-signed TLS certificate
// (trust-on-first-use, like SSH/Syncthing). No certificate authority involved:
// once two devices have each other's fingerprint, that pin is the trust anchor.
export function certFingerprint(cert: Buffer | string): string {
  const buf = typeof cert === 'string' ? Buffer.from(cert) : cert
  return createHash('sha256').update(buf).digest('hex')
}

// Short, human-typed pairing PIN: 6 uniform digits. Rejection-sampled so the
// distribution is even (no modulo bias across 0..999999).
export function generatePin(): string {
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000
  let n = randomBytes(4).readUInt32BE(0)
  while (n >= limit) n = randomBytes(4).readUInt32BE(0)
  return (n % 1_000_000).toString().padStart(6, '0')
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function mintToken(): string {
  return randomBytes(32).toString('base64url')
}

// Six-digit confirmation code shown on BOTH devices during approve-style
// pairing. It is derived from the two certificate fingerprints, so an active
// intermediary creates a different code on each side. The user must compare
// the complete code before approving. This is a SAS, not a secret or password.
export function pairingCode(fingerprintA: string, fingerprintB: string): string {
  const [lo, hi] = [fingerprintA.toLowerCase(), fingerprintB.toLowerCase()].sort()
  const digest = createHash('sha256').update(`${lo}|${hi}`).digest()
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0')
}

// An open pairing window on the device being added: a one-time PIN that expires.
// Kept as a compatibility fallback for older clients. New first-party clients
// use approve-style pairing with a code compared on both devices.
// `now` is injectable so the lifecycle is deterministic in tests.
export class PairingWindow {
  readonly pin: string
  readonly openedAt: number
  private used = false
  private attempts = 0

  constructor(ttlMs = 60_000, now: number = Date.now(), pin: string = generatePin(), maxAttempts = 5) {
    this.ttlMs = ttlMs
    this.pin = pin
    this.openedAt = now
    this.maxAttempts = maxAttempts
  }

  private readonly ttlMs: number
  private readonly maxAttempts: number

  isOpen(now: number = Date.now()): boolean {
    return !this.used && now - this.openedAt <= this.ttlMs
  }

  // Verify a submitted PIN. A correct match consumes the window (one-time use).
  // Wrong guesses are counted and the window closes after maxAttempts, so a
  // 6-digit PIN cannot be brute-forced by a LAN peer within the TTL.
  verify(pin: string, now: number = Date.now()): boolean {
    if (!this.isOpen(now)) return false
    if (!constantTimeEqual(pin, this.pin)) {
      this.attempts += 1
      if (this.attempts >= this.maxAttempts) this.used = true
      return false
    }
    this.used = true
    return true
  }
}

export type PairedPeer = {
  fingerprint: string
  name: string
  token: string
  pairedAt: number
}

// The devices this device trusts. A pull is authorized only when BOTH the
// bearer token AND the TLS peer fingerprint match the same paired peer, so a
// token stolen and replayed from a different device is useless on its own.
export class PeerStore {
  private byFingerprint = new Map<string, PairedPeer>()

  constructor(peers: PairedPeer[] = []) {
    for (const p of peers) this.byFingerprint.set(p.fingerprint, p)
  }

  list(): PairedPeer[] {
    return [...this.byFingerprint.values()]
  }

  get(fingerprint: string): PairedPeer | undefined {
    const peer = this.byFingerprint.get(fingerprint)
    return peer ? { ...peer } : undefined
  }

  pair(fingerprint: string, name: string, now: number = Date.now()): PairedPeer {
    const peer: PairedPeer = { fingerprint, name, token: mintToken(), pairedAt: now }
    this.byFingerprint.set(fingerprint, peer)
    return peer
  }

  restore(peer: PairedPeer): void {
    this.byFingerprint.set(peer.fingerprint, { ...peer })
  }

  authorize(token: string, fingerprint: string): boolean {
    const peer = this.byFingerprint.get(fingerprint)
    if (!peer) return false
    return constantTimeEqual(token, peer.token)
  }

  unpair(fingerprint: string): boolean {
    return this.byFingerprint.delete(fingerprint)
  }
}
