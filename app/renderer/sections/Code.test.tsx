// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  opencodeActivate: vi.fn(async () => ({ state: 'ready', version: '1.18.27', commit: 'b04697366f05419e9bd7a92f841813dd976161c9', customToolRegistered: true, detail: null })),
  opencodeUpdateBounds: vi.fn(async () => true),
  opencodeDeactivate: vi.fn(async () => true),
}))

vi.mock('../lib/ipc', () => ({ metrora: bridge }))

import { Code } from './Code'

describe('Code upstream surface', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the renderer as an empty layout host and owns activation lifecycle through the bridge', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 4, top: 5, width: 800, height: 600, right: 804, bottom: 605, x: 4, y: 5, toJSON: () => ({}) })
    const rendered = render(<Code />)

    expect(screen.getByRole('region', { name: 'Code' })).toBeInTheDocument()
    expect(screen.getByTestId('opencode-web-contents-host')).toBeInTheDocument()
    await waitFor(() => expect(bridge.opencodeActivate).toHaveBeenCalledWith({ x: 4, y: 5, width: 800, height: 600 }))
    expect(bridge.opencodeUpdateBounds).not.toHaveBeenCalled()

    rendered.unmount()
    await waitFor(() => expect(bridge.opencodeDeactivate).toHaveBeenCalledOnce())
  })
})
