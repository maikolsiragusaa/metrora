// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetroraSidebar } from './MetroraSidebar'

describe('MetroraSidebar', () => {
  beforeEach(() => localStorage.clear())

  it('keeps every current destination reachable and persists collapse state', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<MetroraSidebar active="overview" onNavigate={onNavigate} />)

    expect(screen.getByRole('navigation', { name: 'Metrora navigation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Code/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Spend/ }))
    expect(onNavigate).toHaveBeenCalledWith('spend')

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(localStorage.getItem('metrora.sidebar.collapsed')).toBe('true')
    expect(screen.getByRole('button', { name: /Settings/ })).toHaveAttribute('title', 'Settings · ⌘,')
  })

  it('keeps constrained-height navigation scrollable while utility and footer stay reachable', () => {
    const onNavigate = vi.fn()
    const { container } = render(
      <div style={{ height: '720px' }}>
        <MetroraSidebar active="settings" onNavigate={onNavigate} status={<span>Today <b>$0.00</b></span>} />
      </div>,
    )

    const sidebar = container.querySelector<HTMLElement>('.metrora-sidebar')
    const navigationScroll = sidebar?.querySelector<HTMLElement>('[data-sidebar-region="navigation-scroll"]')
    const utility = sidebar?.querySelector<HTMLElement>('[data-sidebar-region="utility"]')
    const status = sidebar?.querySelector<HTMLElement>('[data-sidebar-region="status"]')
    const footer = sidebar?.querySelector<HTMLElement>('[data-sidebar-region="footer"]')
    const settings = screen.getByRole('button', { name: /Settings/ })

    expect(sidebar).toHaveAttribute('data-collapsed', 'false')
    expect(sidebar?.querySelector('[data-sidebar-region="header"]')).toBeInTheDocument()
    expect(sidebar?.querySelector('[data-sidebar-region="search"]')).toBeInTheDocument()
    expect(navigationScroll).toHaveClass('metrora-sidebar__nav-scroll')
    expect(navigationScroll).toContainElement(screen.getByRole('button', { name: /Home/ }))
    expect(utility).toContainElement(settings)
    expect(settings).toHaveClass('on')
    expect(navigationScroll).not.toContainElement(settings)
    expect(status).toHaveTextContent('Today')
    expect(footer).toHaveTextContent('About')
  })

  it('hydrates collapsed state and keeps labels discoverable by keyboard and tooltip', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    localStorage.setItem('metrora.sidebar.collapsed', 'true')
    render(<MetroraSidebar active="models" onNavigate={onNavigate} />)

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(document.querySelector('[data-sidebar-region="navigation-scroll"]')).toBeInTheDocument()
    expect(document.querySelector('[data-sidebar-region="utility"]')).toContainElement(screen.getByRole('button', { name: /Settings/ }))
    const models = screen.getByRole('button', { name: /Models/ })
    expect(models).toHaveClass('on')
    expect(models).toHaveAttribute('title', 'Models · ⌘6')

    models.focus()
    await user.keyboard('{Enter}')
    expect(onNavigate).toHaveBeenCalledWith('models')
  })

  it('opens the Metrora section search without adding a second navigation model', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<MetroraSidebar active="overview" onNavigate={onNavigate} />)

    await user.click(screen.getByRole('button', { name: 'Search sections' }))
    const dialog = screen.getByRole('dialog', { name: 'Navigate' })
    expect(dialog).toBeInTheDocument()
    const input = within(dialog).getByRole('searchbox', { name: 'Search Metrora sections' })
    await user.type(input, 'Settings')
    await user.keyboard('{Enter}')

    expect(onNavigate).toHaveBeenCalledWith('settings')
    expect(screen.queryByRole('dialog', { name: 'Navigate' })).not.toBeInTheDocument()
  })

  it('supports the global command shortcut', () => {
    const onNavigate = vi.fn()
    render(<MetroraSidebar active="overview" onNavigate={onNavigate} />)

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Navigate' })).toBeInTheDocument()
  })
})
