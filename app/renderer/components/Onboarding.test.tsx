// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Onboarding } from './Onboarding'

function next(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
}

describe('Onboarding', () => {
  it('walks the three Metrora feature screens and completes locally', () => {
    const onDone = vi.fn()
    render(<Onboarding defaultEnabled onDone={onDone} />)

    expect(screen.getByRole('dialog', { name: 'Welcome to Metrora' })).toBeInTheDocument()
    expect(screen.getByText('Every tool. One clear view.')).toBeInTheDocument()

    next()
    expect(screen.getByText('Local-first by default.')).toBeInTheDocument()
    expect(screen.getByText(/sends no product telemetry/i)).toBeInTheDocument()

    next()
    expect(screen.getByText('Measure before you optimize.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Local-first by default.')).toBeInTheDocument()

    next()
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(onDone).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledWith(false)
  })

  it('does not render inherited telemetry consent or external-policy controls', () => {
    render(<Onboarding defaultEnabled={false} onDone={() => {}} />)
    next()
    next()

    expect(screen.queryByRole('switch', { name: /telemetry/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /what data we collect/i })).toBeNull()
    expect(screen.queryByText(/Metrora/i)).toBeNull()
  })
})
