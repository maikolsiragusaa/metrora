// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('renders the control-center destinations in primary and utility groups', () => {
    render(<Sidebar active="overview" onNavigate={() => {}} />)

    expect(screen.getByRole('navigation', { name: 'Metrora navigation' })).toBeInTheDocument()
    const home = screen.getByRole('group', { name: 'Home' })
    const primary = screen.getByRole('group', { name: 'Sessions' })
    const utility = screen.getByRole('group', { name: 'Companion' })

    expect(within(home).getByRole('button', { name: /Home.*⌘1/ })).toBeInTheDocument()
    expect(within(primary).getAllByRole('button').map(item => item.textContent)).toEqual([
      'Sessions⌘2',
      'Models⌘4',
      'Spend⌘3',
      'Capacity⌘6',
      'Bench⌘5',
      'Workspace⌘7',
      'Code',
    ])
    expect(within(utility).getAllByRole('button').map(item => item.textContent)).toEqual(['Companion', 'Settings⌘,'])
    expect(screen.queryByRole('button', { name: /Insights/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Compare/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(11)
  })

  it('routes by click and keyboard without changing section ids', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<Sidebar active="overview" onNavigate={onNavigate} />)

    await user.click(screen.getByRole('button', { name: /Spend/ }))
    expect(onNavigate).toHaveBeenCalledWith('spend')

    const sessions = screen.getByRole('button', { name: /Sessions/ })
    sessions.focus()
    await user.keyboard('{Enter}')
    expect(onNavigate).toHaveBeenCalledWith('sessions')
    expect(screen.queryByRole('button', { name: /Activity/ })).not.toBeInTheDocument()
  })

  it('marks the active item with the current-page contract', () => {
    render(<Sidebar active="models" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: /Models/ })).toHaveClass('on')
    expect(screen.getByRole('button', { name: /Models/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /Home/ })).not.toHaveClass('on')
  })

  it('opens About without competing with the visible product destinations', () => {
    render(<Sidebar active="overview" onNavigate={() => {}} />)
    fireEvent.click(screen.getByRole('link', { name: 'About' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders the static Metrora vector mark instead of the inherited flame asset', () => {
    const { container } = render(<Sidebar active="overview" onNavigate={() => {}} />)
    const mark = container.querySelector('.app img.metrora-mark-light')
    expect(mark?.tagName.toLowerCase()).toBe('img')
    expect(container.querySelector('.flamemark')).toBeNull()
    expect(container.querySelector('.fm-flicker')).toBeNull()
    expect(container.querySelector('.app')?.textContent).toContain('Metrora')
  })
})
