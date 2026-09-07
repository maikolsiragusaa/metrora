// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  opencodeActivate: vi.fn(async () => ({ state: 'ready', version: '1.18.27', commit: 'b04697366f05419e9bd7a92f841813dd976161c9', customToolRegistered: true, detail: null })),
  opencodeUpdateBounds: vi.fn(async () => true),
  opencodeDeactivate: vi.fn(async () => true),
  importOpenCodeSessions: vi.fn(async () => ({ discovered: 0, newSessions: 0, imported: 0, alreadyPresent: 0, skipped: 0, failed: 0, reason: null, reasons: [] })),
}))

vi.mock('../lib/ipc', () => ({ metrora: bridge }))

import { Code } from './Code'

describe('Code upstream surface', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('keeps the renderer as an empty layout host and owns activation lifecycle through the bridge', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 4, top: 5, width: 800, height: 600, right: 804, bottom: 605, x: 4, y: 5, toJSON: () => ({}) })
    const rendered = render(<Code />)

    expect(screen.getByRole('region', { name: 'Code' })).toBeInTheDocument()
    expect(screen.getByTestId('opencode-web-contents-host')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Preparing OpenCode')
    await waitFor(() => expect(bridge.opencodeActivate).toHaveBeenCalledWith({ x: 4, y: 5, width: 800, height: 600 }))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(bridge.opencodeUpdateBounds).not.toHaveBeenCalled()

    rendered.unmount()
    await waitFor(() => expect(bridge.opencodeDeactivate).toHaveBeenCalledOnce())
  })

  it('requires a lightweight confirmation and reports a successful Metrora-owned import', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 4, top: 5, width: 800, height: 600, right: 804, bottom: 605, x: 4, y: 5, toJSON: () => ({}) })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    bridge.importOpenCodeSessions.mockResolvedValue({ discovered: 2, newSessions: 1, imported: 1, alreadyPresent: 1, skipped: 0, failed: 0, reason: null, reasons: [] })

    render(<Code />)
    fireEvent.click(screen.getByRole('button', { name: 'Import new OpenCode sessions' }))

    await waitFor(() => expect(bridge.importOpenCodeSessions).toHaveBeenCalledOnce())
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByText('OpenCode import: 1 new session; 1 already present.')).toBeInTheDocument()
  })
})
