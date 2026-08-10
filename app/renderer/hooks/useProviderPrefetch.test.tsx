// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { overviewMemoKey, useProviderPrefetch } from './useProviderPrefetch'

const getOverview = vi.fn()
vi.mock('../lib/ipc', () => ({ metrora: { getOverview } }))

describe('disabled speculative Overview prefetch', () => {
  it('keeps exact-scope keys while spawning no period or provider warmups', () => {
    renderHook(() => useProviderPrefetch({ ready: true }))

    expect(overviewMemoKey('codex', 'lifetime', null, null)).toBe('overview|codex|lifetime|-|')
    expect(getOverview).not.toHaveBeenCalled()
  })
})
