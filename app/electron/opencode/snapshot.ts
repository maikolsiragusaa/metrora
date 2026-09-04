export type MetroraUsageSnapshot = {
  schemaVersion: 'metrora.usage-snapshot.v1'
  generatedAt: string
  period: 'today'
  available: boolean
  costUSD: number | null
  calls: number | null
  sessions: number | null
  inputTokens: number | null
  outputTokens: number | null
  providers: Array<{ id: string; label: string; costUSD: number }>
}

type MenubarCurrent = {
  cost?: unknown
  calls?: unknown
  sessions?: unknown
  inputTokens?: unknown
  outputTokens?: unknown
  providerDetails?: unknown
}

type MenubarPayloadLike = { generated?: unknown; current?: MenubarCurrent }

const MAX_PROVIDER_ROWS = 20
const MAX_NUMBER = 1_000_000_000_000

function boundedText(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0) return fallback
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, max) || fallback
}

function boundedNumber(value: unknown, integer = false): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const bounded = Math.min(MAX_NUMBER, value)
  return integer ? Math.floor(bounded) : bounded
}

function generatedAt(value: unknown, now: Date): string {
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return now.toISOString()
}

function unavailable(now: Date): MetroraUsageSnapshot {
  return {
    schemaVersion: 'metrora.usage-snapshot.v1',
    generatedAt: now.toISOString(),
    period: 'today',
    available: false,
    costUSD: null,
    calls: null,
    sessions: null,
    inputTokens: null,
    outputTokens: null,
    providers: [],
  }
}

/** Project only bounded, non-content Metrora facts for the OpenCode tool. */
export function sanitizeUsageSnapshot(value: unknown, now = new Date()): MetroraUsageSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable(now)
  const payload = value as MenubarPayloadLike
  const current = payload.current
  if (!current || typeof current !== 'object') return unavailable(now)

  const providers = Array.isArray(current.providerDetails)
    ? current.providerDetails.slice(0, MAX_PROVIDER_ROWS).flatMap(provider => {
        if (!provider || typeof provider !== 'object') return []
        const row = provider as { id?: unknown; label?: unknown; cost?: unknown }
        const costUSD = boundedNumber(row.cost)
        if (costUSD === null) return []
        return [{
          id: boundedText(row.id, 'unknown', 80),
          label: boundedText(row.label, 'Unknown provider', 120),
          costUSD,
        }]
      })
    : []

  return {
    schemaVersion: 'metrora.usage-snapshot.v1',
    generatedAt: generatedAt(payload.generated, now),
    period: 'today',
    available: true,
    costUSD: boundedNumber(current.cost),
    calls: boundedNumber(current.calls, true),
    sessions: boundedNumber(current.sessions, true),
    inputTokens: boundedNumber(current.inputTokens, true),
    outputTokens: boundedNumber(current.outputTokens, true),
    providers,
  }
}
