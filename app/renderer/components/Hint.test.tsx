// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Hint } from './Hint'

describe('Hint', () => {
  it('keeps the established range readable and exposes Workspace as Command-9', () => {
    render(<Hint items={[{ k: '⌘1-9', label: 'Navigate' }]} />)

    expect(screen.getByText('⌘1-8')).toBeInTheDocument()
    expect(screen.getByText('⌘9')).toBeInTheDocument()
    expect(screen.getByText('Navigate')).toBeInTheDocument()
  })

  it('renders ordinary keycaps unchanged', () => {
    render(<Hint items={[{ k: '⌘R', label: 'Refresh' }]} />)

    expect(screen.getByText('⌘R')).toBeInTheDocument()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
  })
})
