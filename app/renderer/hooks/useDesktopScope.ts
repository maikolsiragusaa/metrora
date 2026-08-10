import { useCallback, useMemo, useState } from 'react'

import type { Section } from '../components/Sidebar'
import { DESKTOP_SECTION_CAPABILITIES } from '../lib/desktopSections'
import { readStorage, removeStorage, writeStorage } from '../lib/storage'
import type { DateRange, Period } from '../lib/types'

const STANDARD_PERIODS: Period[] = ['today', 'week', '30days', 'month', 'all', 'lifetime']

export type DetectedProvider = {
  id: string
  label: string
}

function isPeriod(value: string): value is Period {
  return (STANDARD_PERIODS as string[]).includes(value)
}

function initialPeriod(): Period {
  const saved = readStorage('defaultPeriod')
  return saved && isPeriod(saved) ? saved : 'today'
}

function initialConfigSource(): string | null {
  return readStorage('claudeConfigSource') || null
}

function persistConfigSource(id: string | null): void {
  if (id) writeStorage('claudeConfigSource', id)
  else removeStorage('claudeConfigSource')
}

export function providerName(provider: string): string {
  if (provider === 'all') return 'All providers'
  return provider
    .split(/[-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Owns only desktop scope state and compatibility transitions.
 * Provider discovery and background prefetch remain separate responsibilities. */
export function useDesktopScope({
  section,
  detectedProviders,
}: {
  section: Section
  detectedProviders: DetectedProvider[]
}) {
  const [period, setPeriod] = useState<Period>(initialPeriod)
  const [provider, setProvider] = useState<string>('all')
  const [customRange, setCustomRange] = useState<DateRange | null>(null)
  const [claudeConfigSource, setClaudeConfigSource] = useState<string | null>(initialConfigSource)

  const sectionCapabilities = DESKTOP_SECTION_CAPABILITIES[section]
  const scopedClaudeConfigSource = sectionCapabilities.claudeConfig ? claudeConfigSource : null

  const onPeriodChange = useCallback((value: string) => {
    if (!isPeriod(value)) return
    setCustomRange(null)
    setPeriod(value)
  }, [])

  const onRangeSelect = useCallback((range: DateRange | null) => {
    setCustomRange(range)
  }, [])

  // A Claude config scopes Claude usage only, so a non-Claude provider filter
  // would make the CLI reject the flag: reset it to all first.
  const onConfigSelect = useCallback((id: string) => {
    const next = id || null
    if (next && provider !== 'all' && provider !== 'claude') setProvider('all')
    setClaudeConfigSource(next)
    persistConfigSource(next)
  }, [provider])

  // Symmetric direction: picking a non-Claude provider while a config is scoped
  // would hit the same CLI rejection, so drop the config scope.
  const onProviderSelect = useCallback((value: string) => {
    if (claudeConfigSource && value !== 'all' && value !== 'claude') {
      setClaudeConfigSource(null)
      persistConfigSource(null)
    }
    setProvider(value)
  }, [claudeConfigSource])

  const providerOptions = useMemo(() => [
    { value: 'all', label: 'All providers' },
    ...detectedProviders.map(entry => ({ value: entry.id, label: entry.label })),
  ], [detectedProviders])

  const providerLabel = detectedProviders.find(entry => entry.id === provider)?.label ?? providerName(provider)

  return {
    period,
    provider,
    customRange,
    claudeConfigSource,
    sectionCapabilities,
    scopedClaudeConfigSource,
    providerOptions,
    providerLabel,
    onPeriodChange,
    onRangeSelect,
    onProviderSelect,
    onConfigSelect,
  }
}
