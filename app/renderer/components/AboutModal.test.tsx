// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AboutModal, type SocialLink } from './AboutModal'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>(),
}))

vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, codeburn: { ...actual.codeburn, openExternal: mocks.openExternal } }
})

const SOCIALS: SocialLink[] = [
  {
    label: 'GitHub',
    url: 'https://github.com/maikolsiragusaa/qovrion',
    icon: <span aria-hidden="true">G</span>,
  },
]

function renderAbout(onClose = vi.fn()) {
  return { onClose, ...render(<AboutModal socials={SOCIALS} onClose={onClose} />) }
}

describe('Qovrion About modal', () => {
  beforeEach(() => {
    mocks.openExternal.mockReset().mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('shows Qovrion identity and the static no-update-channel status', () => {
    renderAbout()

    expect(screen.getByRole('dialog', { name: 'Qovrion' })).toBeInTheDocument()
    expect(screen.getByText('Local-first intelligence for AI usage, cost and efficiency.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('does not yet publish an automatic update channel')
    expect(screen.getByRole('status')).toHaveTextContent('never checks or downloads CodeBurn releases')
  })

  it('does not expose inherited update or download controls', () => {
    renderAbout()

    expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull()
    expect(screen.queryByText(/update available/i)).toBeNull()
  })

  it('opens only the explicitly supplied Qovrion link', () => {
    renderAbout()

    fireEvent.click(screen.getByRole('link', { name: /github/i }))
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(mocks.openExternal).toHaveBeenCalledWith('https://github.com/maikolsiragusaa/qovrion')
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
