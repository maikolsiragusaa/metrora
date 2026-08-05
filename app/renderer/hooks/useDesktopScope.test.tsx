// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Section } from '../components/Sidebar'
import { storageKeys } from '../lib/storage'
import { useDesktopScope } from './useDesktopScope'

const providers = [
  { id: 'claude', label: 'Claude' },
  { id: 'grok', label: 'Grok Build' },
]

describe('useDesktopScope', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('boots from the persisted default period and config source', () => {
    localStorage.setItem(storageKeys('defaultPeriod').canonical, 'week')
    localStorage.setItem(storageKeys('claudeConfigSource').canonical, 'claude-config:default')

    const { result } = renderHook(() => useDesktopScope({ section: 'overview', detectedProviders: providers }))

    expect(result.current.period).toBe('week')
    expect(result.current.claudeConfigSource).toBe('claude-config:default')
    expect(result.current.scopedClaudeConfigSource).toBe('claude-config:default')
  })

  it('clears a custom range when a standard period is selected', () => {
    const { result } = renderHook(() => useDesktopScope({ section: 'overview', detectedProviders: providers }))

    act(() => result.current.onRangeSelect({ from: '2026-08-01', to: '2026-08-03' }))
    expect(result.current.customRange).toEqual({ from: '2026-08-01', to: '2026-08-03' })

    act(() => result.current.onPeriodChange('30days'))
    expect(result.current.period).toBe('30days')
    expect(result.current.customRange).toBeNull()
  })

  it('resets an incompatible provider when a Claude config is selected', () => {
    const { result } = renderHook(() => useDesktopScope({ section: 'overview', detectedProviders: providers }))

    act(() => result.current.onProviderSelect('grok'))
    expect(result.current.provider).toBe('grok')

    act(() => result.current.onConfigSelect('claude-config:default'))
    expect(result.current.provider).toBe('all')
    expect(result.current.claudeConfigSource).toBe('claude-config:default')
    expect(localStorage.getItem(storageKeys('claudeConfigSource').canonical)).toBe('claude-config:default')
  })

  it('drops config scope when a non-Claude provider is selected', () => {
    localStorage.setItem(storageKeys('claudeConfigSource').canonical, 'claude-config:default')
    const { result } = renderHook(() => useDesktopScope({ section: 'overview', detectedProviders: providers }))

    act(() => result.current.onProviderSelect('grok'))

    expect(result.current.provider).toBe('grok')
    expect(result.current.claudeConfigSource).toBeNull()
    for (const key of Object.values(storageKeys('claudeConfigSource'))) {
      expect(localStorage.getItem(key)).toBeNull()
    }
  })

  it('keeps the persisted config while removing it from unsupported section scope', () => {
    localStorage.setItem(storageKeys('claudeConfigSource').canonical, 'claude-config:default')
    const { result, rerender } = renderHook(
      ({ section }: { section: Section }) => useDesktopScope({ section, detectedProviders: providers }),
      { initialProps: { section: 'overview' as Section } },
    )

    expect(result.current.scopedClaudeConfigSource).toBe('claude-config:default')
    rerender({ section: 'workspace' })
    expect(result.current.claudeConfigSource).toBe('claude-config:default')
    expect(result.current.scopedClaudeConfigSource).toBeNull()
    expect(result.current.sectionCapabilities.provider).toBe(false)
  })

  it('derives stable provider options and display labels', () => {
    const { result } = renderHook(() => useDesktopScope({ section: 'overview', detectedProviders: providers }))

    expect(result.current.providerOptions).toEqual([
      { value: 'all', label: 'All providers' },
      { value: 'claude', label: 'Claude' },
      { value: 'grok', label: 'Grok Build' },
    ])

    act(() => result.current.onProviderSelect('grok'))
    expect(result.current.providerLabel).toBe('Grok Build')
  })
})
