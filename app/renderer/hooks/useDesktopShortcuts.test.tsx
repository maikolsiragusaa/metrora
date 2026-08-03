// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Section } from '../components/Sidebar'
import { useDesktopShortcuts } from './useDesktopShortcuts'

function Harness({
  platform,
  navigate,
  refresh,
}: {
  platform: 'macos' | 'windows'
  navigate: (section: Section) => void
  refresh: () => void
}) {
  useDesktopShortcuts({ platform, navigate, refresh })
  return null
}

describe('useDesktopShortcuts', () => {
  it('uses Control on Windows', () => {
    const navigate = vi.fn()
    const refresh = vi.fn()
    render(<Harness platform="windows" navigate={navigate} refresh={refresh} />)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, cancelable: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, cancelable: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', metaKey: true, cancelable: true }))

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('overview')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('uses Command on macOS', () => {
    const navigate = vi.fn()
    const refresh = vi.fn()
    render(<Harness platform="macos" navigate={navigate} refresh={refresh} />)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, cancelable: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, cancelable: true }))

    expect(navigate).toHaveBeenCalledWith('settings')
    expect(refresh).not.toHaveBeenCalled()
  })
})
