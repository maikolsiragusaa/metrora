import { createContext, useContext } from 'react'

import { readCompatStorage, writeCompatStorage } from './storage'

// The auto-refresh cadence, chosen in Settings > General. Metrora storage is
// canonical; the adapter dual-writes the legacy key during the migration window.
export const REFRESH_OPTIONS: ReadonlyArray<{ value: string; label: string; ms: number | null }> = [
  { value: 'manual', label: 'Manual', ms: null },
  { value: '30s', label: '30 seconds', ms: 30_000 },
  { value: '1m', label: '1 minute', ms: 60_000 },
  { value: '3m', label: '3 minutes', ms: 180_000 },
  { value: '5m', label: '5 minutes', ms: 300_000 },
  { value: '10m', label: '10 minutes', ms: 600_000 },
]

export const DEFAULT_REFRESH_VALUE = '1m'
const DEFAULT_MS = 60_000

export function refreshValueToMs(value: string): number | null {
  const option = REFRESH_OPTIONS.find(candidate => candidate.value === value)
  return option ? option.ms : DEFAULT_MS
}

export function readRefreshValue(): string {
  const saved = readCompatStorage('refreshInterval')
  if (saved && REFRESH_OPTIONS.some(option => option.value === saved)) return saved
  return DEFAULT_REFRESH_VALUE
}

export function persistRefreshValue(value: string): void {
  writeCompatStorage('refreshInterval', value)
}

export type RefreshCadence = {
  value: string
  intervalMs: number | null
  setValue: (value: string) => void
}

export const RefreshCadenceContext = createContext<RefreshCadence>({
  value: DEFAULT_REFRESH_VALUE,
  intervalMs: DEFAULT_MS,
  setValue: () => {},
})

export function useRefreshCadence(): RefreshCadence {
  return useContext(RefreshCadenceContext)
}
