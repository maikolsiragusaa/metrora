export type RecoverableServer = {
  port: number
  csrfToken: string
}

type DiscoveryEntry<S> = {
  value: S | null
  recordedAt: number
}

export class ExpiringServerDiscoveryCache<K, S extends RecoverableServer> {
  readonly #entries = new Map<K, DiscoveryEntry<S>>()
  readonly #inFlight = new Map<K, Promise<S | null>>()

  constructor(
    readonly negativeTtlMs: number,
    readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(negativeTtlMs) || negativeTtlMs < 0) {
      throw new Error('negativeTtlMs must be a finite number >= 0')
    }
  }

  async getOrDiscover(key: K, discover: () => Promise<S | null>): Promise<S | null> {
    const cached = this.#entries.get(key)
    if (cached) {
      if (cached.value !== null) return cached.value
      if (this.now() - cached.recordedAt < this.negativeTtlMs) return null
      this.#entries.delete(key)
    }

    const pending = this.#inFlight.get(key)
    if (pending) return pending

    const request = (async () => {
      const value = await discover()
      this.#entries.set(key, { value, recordedAt: this.now() })
      return value
    })().finally(() => {
      this.#inFlight.delete(key)
    })

    this.#inFlight.set(key, request)
    return request
  }

  invalidate(key: K, expected: S): boolean {
    const cached = this.#entries.get(key)
    if (!cached?.value) return false
    if (!sameServer(cached.value, expected)) return false
    this.#entries.delete(key)
    return true
  }
}

export async function runWithSingleServerRediscovery<S extends RecoverableServer, T>(input: {
  detect: () => Promise<S | null>
  invalidate: (server: S) => void
  operation: (server: S) => Promise<T>
}): Promise<T | null> {
  let server = await input.detect()
  if (!server) return null

  try {
    return await input.operation(server)
  } catch {
    input.invalidate(server)
  }

  server = await input.detect()
  if (!server) return null

  try {
    return await input.operation(server)
  } catch {
    input.invalidate(server)
    return null
  }
}

function sameServer(left: RecoverableServer, right: RecoverableServer): boolean {
  return left.port === right.port && left.csrfToken === right.csrfToken
}
