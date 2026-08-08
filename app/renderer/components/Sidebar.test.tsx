// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('renders every destination exactly once in task-oriented groups', () => {
    render(<Sidebar active="overview" onNavigate={() => {}} />)

    expect(screen.getByRole('navigation', { name: 'Metrora navigation' })).toBeInTheDocument()
    const home = screen.getByRole('group', { name: 'Home' })
    const activity = screen.getByRole('group', { name: 'Activity' })
    const analyze = screen.getByRole('group', { name: 'Analyze' })
    const control = screen.getByRole('group', { name: 'Control' })
    const product = screen.getByRole('group', { name: 'Product' })

    expect(within(home).getByRole('button', { name: /Home.*⌘1/ })).toBeInTheDocument()
    expect(within(activity).getAllByRole('button').map(item => item.textContent)).toEqual(['Sessions⌘2', 'Pull requests⌘3'])
    expect(within(analyze).getAllByRole('button').map(item => item.textContent)).toEqual([
      'Spend⌘4',
      'Insights⌘5',
      'Models⌘6',
      'Compare⌘7',
    ])
    expect(within(control).getAllByRole('button').map(item => item.textContent)).toEqual(['Workspace⌘8'])
    expect(within(product).getByRole('button', { name: /Settings.*⌘,/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(9)
  })

  it('routes by click and keyboard without changing section ids', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<Sidebar active="overview" onNavigate={onNavigate} />)

    await user.click(screen.getByRole('button', { name: /Spend/ }))
    expect(onNavigate).toHaveBeenCalledWith('spend')

    const compare = screen.getByRole('button', { name: /Compare/ })
    compare.focus()
    await user.keyboard('{Enter}')
    expect(onNavigate).toHaveBeenCalledWith('compare')
  })

  it('marks the active item with the current-page contract', () => {
    render(<Sidebar active="models" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: /Models/ })).toHaveClass('on')
    expect(screen.getByRole('button', { name: /Models/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /Home/ })).not.toHaveClass('on')
  })

  it('opens About without competing with the ten product destinations', () => {
    render(<Sidebar active="overview" onNavigate={() => {}} />)
    fireEvent.click(screen.getByRole('link', { name: 'About' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders the static Metrora vector mark instead of the inherited flame asset', () => {
    const { container } = render(<Sidebar active="overview" onNavigate={() => {}} />)
    const mark = container.querySelector('.app svg')
    expect(mark?.tagName.toLowerCase()).toBe('svg')
    expect(container.querySelector('.flamemark')).toBeNull()
    expect(container.querySelector('.fm-flicker')).toBeNull()
    expect(container.querySelector('.app')?.textContent).toContain('Metrora')
  })
})
