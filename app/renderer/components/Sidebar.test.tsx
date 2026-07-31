// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('renders all nine nav items in the desktop order', () => {
    render(<Sidebar active="overview" onNavigate={() => {}} />)
    const labels = screen.getAllByRole('button').map(item => item.textContent?.replace(/⌘[\d,]/, ''))
    expect(labels).toEqual(['Overview', 'Sessions', 'Pull requests', 'Spend', 'Optimize', 'Models', 'Compare', 'Plans', 'Settings'])
    expect(screen.getByRole('button', { name: /Sessions.*⌘2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pull requests.*⌘3/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Compare.*⌘7/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Plans.*⌘8/ })).toBeInTheDocument()
  })

  it('calls onNavigate with the section id when a nav item is clicked', () => {
    const onNavigate = vi.fn()
    render(<Sidebar active="overview" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: /Spend/ }))
    expect(onNavigate).toHaveBeenCalledWith('spend')
  })

  it('marks the active item with the "on" class', () => {
    render(<Sidebar active="models" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: /Models/ })).toHaveClass('on')
    expect(screen.getByRole('button', { name: /Overview/ })).not.toHaveClass('on')
  })

  it('renders the static Qovrion vector mark instead of the inherited flame asset', () => {
    const { container } = render(<Sidebar active="overview" onNavigate={() => {}} />)
    const mark = container.querySelector('.app svg')
    expect(mark?.tagName.toLowerCase()).toBe('svg')
    expect(container.querySelector('.flamemark')).toBeNull()
    expect(container.querySelector('.fm-flicker')).toBeNull()
    expect(container.querySelector('.app')?.textContent).toContain('Qovrion')
  })
})
