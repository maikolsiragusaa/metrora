import { rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Qovrion does not transmit product telemetry.
 *
 * The CodeBurn-derived desktop shell expects a Telemetry-compatible object, so
 * this module intentionally preserves that local interface while making every
 * operation a no-op. Keeping the interface avoids a risky cross-cutting IPC
 * rewrite during the compatibility phase; keeping the implementation inert
 * guarantees that no inherited endpoint, identifier, queue, or consent state is
 * used by Qovrion.
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

export type TelemetryStatus = {
  installId: string
  country: string | null
  enabled: false
  defaultEnabled: false
  /** True so the inherited consent onboarding is never displayed. */
  onboarded: true
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

/**
 * Retained for compatibility with callers and tests. No sanitized payload is
 * sent anywhere; this merely returns a shallow, bounded primitive-only object.
 */
export function sanitizeProps(props: unknown): Record<string, unknown> {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props as Record<string, unknown>).slice(0, 16)) {
    if (typeof value === 'string') out[key.slice(0, 64)] = value.slice(0, 64)
    else if (typeof value === 'number' && Number.isFinite(value)) out[key.slice(0, 64)] = value
    else if (typeof value === 'boolean') out[key.slice(0, 64)] = value
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
    // an existing CodeBurn desktop profile. This file contains no usage data.
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
