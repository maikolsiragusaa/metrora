// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SectionFreshness } from './SectionFreshness'
import type { Polled } from '../hooks/usePolled'

function report(overrides: Partial<Polled<unknown>> = {}): Polled<unknown> {
  return {
    data: {},
    error: null,
    loading: false,
    switching: false,
    lastSuccessAt: Date.now(),
    refresh: () => {},
    refreshFresh: () => {},
    ...overrides,
  }
}

describe('SectionFreshness', () => {
  it('reports updating while a section poll is in flight', () => {
    render(<SectionFreshness report={report({ loading: true, lastSuccessAt: null })} />)
    expect(screen.getByText('updating…')).toBeDefined()
  })

  it('reports updating while stale memoized data paints behind a switch', () => {
    render(<SectionFreshness report={report({ switching: true })} />)
    expect(screen.getByText('updating…')).toBeDefined()
  })

  it('reports the section own last success', () => {
    render(<SectionFreshness report={report({ lastSuccessAt: Date.now() - 45_000 })} />)
    expect(screen.getByText('updated 45s ago')).toBeDefined()
  })

  it('flags last-good data after a failed section poll', () => {
    render(<SectionFreshness report={report({ error: { kind: 'timeout', message: 'timed out' } })} />)
    const badge = screen.getByText('showing last good data')
    expect(badge.className).toContain('section-freshness--stale')
  })

  it('renders nothing before the first success', () => {
    const { container } = render(<SectionFreshness report={report({ lastSuccessAt: null })} />)
    expect(container.textContent).toBe('')
  })
})
