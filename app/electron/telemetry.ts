import { rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Metrora does not transmit product telemetry.
 *
 * The Metrora-derived desktop shell expects a Telemetry-compatible object, so
 * this module intentionally preserves that local interface while making every
 * operation a no-op. Keeping the interface avoids a risky cross-cutting IPC
 * rewrite during the compatibility phase; keeping the implementation inert
 * guarantees that no inherited endpoint, identifier, queue, or consent state is
 * used by Metrora.
 */

export const TELEMETRY_ENDPOINT = null
export const TELEMETRY_SCHEMA = 0

export const EVENT_NAMES = new Set([
  'app_open',
  'app_close',
  'section_view',
  'cold_start',
  'usage_snapshot',
  'cli_error',
])

const MAX_STRING = 64
const MAX_ARRAY = 12
const MAX_KEYS = 16

export type TelemetryStatus = {
  installId: string
  country: string | null
  enabled: boolean
  defaultEnabled: boolean
  /** True so the inherited consent onboarding is never displayed. */
  onboarded: boolean
}

type Deps = {
  stateDir: string
  country: string | null
  isPackaged: boolean
  appVersion: string
  platform?: string
  arch?: string
  endpoint?: string
  fetchFn?: typeof fetch
  now?: () => Date
}

export function defaultEnabledFor(_country: string | null | undefined): false {
  return false
}

function sanitizeValue(value: unknown): unknown | undefined {
  if (typeof value === 'string') return value.slice(0, MAX_STRING)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  return undefined
}

/**
 * Retained for compatibility with local analytics helpers and tests. This
 * bounded whitelist never sends anything; it only produces primitive values
 * and one level of arrays containing flat primitive-only objects.
 */
export function sanitizeProps(props: unknown): Record<string, unknown> {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {}
  const out: Record<string, unknown> = {}
  let keys = 0

  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (keys >= MAX_KEYS) break
    const safeKey = key.slice(0, MAX_STRING)

    if (Array.isArray(value)) {
      const items: Record<string, unknown>[] = []
      for (const entry of value.slice(0, MAX_ARRAY)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        const flat: Record<string, unknown> = {}
        let innerKeys = 0
        for (const [innerKey, innerValue] of Object.entries(entry as Record<string, unknown>)) {
          if (innerKeys >= MAX_KEYS) break
          const sanitized = sanitizeValue(innerValue)
          if (sanitized === undefined) continue
          flat[innerKey.slice(0, MAX_STRING)] = sanitized
          innerKeys++
        }
        if (Object.keys(flat).length > 0) items.push(flat)
      }
      if (items.length > 0) {
        out[safeKey] = items
        keys++
      }
      continue
    }

    const sanitized = sanitizeValue(value)
    if (sanitized === undefined) continue
    out[safeKey] = sanitized
    keys++
  }

  return out
}

export class Telemetry {
  private readonly value: TelemetryStatus

  constructor(deps: Deps) {
    this.value = {
      installId: 'disabled',
      country: deps.country,
      enabled: false,
      defaultEnabled: false,
      onboarded: true,
    }

    // Remove the inherited consent/install identifier if this tree is run over
    // an existing Metrora desktop profile. This file contains no usage data.
    try { rmSync(join(deps.stateDir, 'telemetry.v1.json'), { force: true }) } catch { /* best effort */ }
  }

  status(): TelemetryStatus {
    return { ...this.value }
  }

  setEnabled(_enabled: boolean): TelemetryStatus {
    return this.status()
  }

  completeOnboarding(_enabled: boolean): TelemetryStatus {
    return this.status()
  }

  track(_name: string, _props: unknown): void {}

  trackClose(): void {}

  async flush(): Promise<boolean> {
    return false
  }

  get queueLength(): number {
    return 0
  }
}
