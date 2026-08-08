// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AboutModal, type SocialLink } from './AboutModal'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>(),
}))

vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, metrora: { ...actual.metrora, openExternal: mocks.openExternal } }
})

const SOCIALS: SocialLink[] = [
  {
    label: 'GitHub',
    url: 'https://github.com/maikolsiragusaa/metrora',
    icon: <span aria-hidden="true">G</span>,
  },
]

function renderAbout(onClose = vi.fn()) {
  return { onClose, ...render(<AboutModal socials={SOCIALS} onClose={onClose} />) }
}

describe('Metrora About modal', () => {
  beforeEach(() => {
    mocks.openExternal.mockReset().mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('shows only current Metrora distribution identity', () => {
    renderAbout()

    expect(screen.getByRole('dialog', { name: 'Metrora' })).toBeInTheDocument()
    expect(screen.getByText('Local-first intelligence for AI usage, cost and efficiency.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('active distribution channel')
    expect(screen.getByRole('status')).toHaveTextContent('does not use a separate in-app updater')
    expect(screen.getByText('Metrora · Published by Vensent')).toBeInTheDocument()
    expect(screen.queryByText(/CodeBurn/i)).toBeNull()
    expect(screen.queryByText(/0\.9\.19/)).toBeNull()
  })

  it('does not expose inherited update or download controls', () => {
    renderAbout()

    expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull()
    expect(screen.queryByText(/update available/i)).toBeNull()
  })

  it('opens only the explicitly supplied Metrora link', () => {
    renderAbout()

    fireEvent.click(screen.getByRole('link', { name: /github/i }))
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(mocks.openExternal).toHaveBeenCalledWith('https://github.com/maikolsiragusaa/metrora')
  })

  it('closes from the close button and Escape', () => {
    const first = renderAbout()
    fireEvent.click(screen.getByRole('button', { name: 'Close About' }))
    expect(first.onClose).toHaveBeenCalledTimes(1)

    cleanup()
    const second = renderAbout()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(second.onClose).toHaveBeenCalledTimes(1)
  })
})
