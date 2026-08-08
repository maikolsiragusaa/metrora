// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionRow } from '../lib/types'
import { INITIAL_VISIBLE, Sessions } from './Sessions'

const { getSessions } = vi.hoisted(() => ({
  getSessions: vi.fn<(period: string, provider: string) => Promise<SessionRow[]>>(),
}))

vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, metrora: { ...actual.metrora, getSessions } }
})

function session(overrides: Partial<SessionRow> & Pick<SessionRow, 'sessionId' | 'project' | 'provider'>): SessionRow {
  return {
    title: '',
    models: ['Default model'],
    cost: 1,
    savingsUSD: 0,
    calls: 10,
    turns: 4,
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 9_000_000,
    cacheWriteTokens: 0,
    startedAt: '2026-08-07T10:00:00.000Z',
    endedAt: '2026-08-07T10:30:00.000Z',
    durationMs: 30 * 60_000,
    ...overrides,
  }
}

const rows: SessionRow[] = [
  session({ sessionId: 'older', title: 'Older Codex', project: 'metrora', provider: 'codex', endedAt: '2026-08-07T10:30:00.000Z' }),
  session({ sessionId: 'newest', title: 'Newest Claude', project: 'obsign', provider: 'claude', models: ['claude-opus-4-6'], cost: 11, endedAt: '2026-08-07T12:30:00.000Z' }),
  session({ sessionId: 'middle', title: 'Middle Codex', project: 'metrora-site', provider: 'codex', endedAt: '2026-08-07T11:30:00.000Z' }),
]

describe('Sessions', () => {
  beforeEach(() => {
    getSessions.mockReset()
    getSessions.mockResolvedValue(rows)
  })

  it('shows a clear available-detail loading state', async () => {
    let resolve!: (value: SessionRow[]) => void
    getSessions.mockReturnValue(new Promise<SessionRow[]>(r => { resolve = r }))
    render(<Sessions period="lifetime" provider="all" />)

    expect(screen.getByText('Loading available session detail…')).toBeInTheDocument()
    resolve(rows)
    expect(await screen.findByRole('table', { name: 'Detailed sessions' })).toBeInTheDocument()
  })

  it('defaults to genuine global newest-first chronology instead of provider grouping', async () => {
    render(<Sessions period="lifetime" provider="all" />)

    await waitFor(() => expect(getSessions).toHaveBeenCalledWith('lifetime', 'all'))
    const table = await screen.findByRole('table', { name: 'Detailed sessions' })
    const bodyRows = within(table).getAllByRole('row').slice(1)

    expect(bodyRows[0]).toHaveTextContent('Newest Claude')
    expect(bodyRows[1]).toHaveTextContent('Middle Codex')
    expect(bodyRows[2]).toHaveTextContent('Older Codex')
    expect(screen.getByRole('button', { name: 'Group by provider' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('explains available detail versus durable historical session totals', async () => {
    render(<Sessions period="lifetime" provider="all" historicalSessionCount={4} />)

    expect(await screen.findByText(/3 detailed sessions/)).toHaveTextContent('4 sessions in historical totals')
    expect(screen.getByText(/1 older session remain in durable historical totals/i)).toBeInTheDocument()
  })

  it('uses the same token, cache-reuse and cost-per-million definitions as Models', async () => {
    render(<Sessions period="lifetime" provider="all" />)

    const table = await screen.findByRole('table', { name: 'Detailed sessions' })
    const newest = within(table).getByText('Newest Claude').closest('tr')!
    expect(newest).toHaveTextContent('9×')
    expect(newest).toHaveTextContent('11M')
    expect(newest).toHaveTextContent('$11.00')
    expect(newest).toHaveTextContent('$1.00')
    expect(within(table).getByRole('columnheader', { name: 'Cache ×' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Cost / 1M' })).toBeInTheDocument()
  })

  it('keeps provider grouping as an explicit optional lens', async () => {
    const user = userEvent.setup()
    render(<Sessions period="lifetime" provider="all" />)
    await screen.findByRole('table', { name: 'Detailed sessions' })

    const toggle = screen.getByRole('button', { name: 'Group by provider' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const table = screen.getByRole('table', { name: 'Detailed sessions' })
    expect(within(table).getByRole('row', { name: /Claude.*1 sessions/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Codex.*2 sessions/ })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Recent' }))
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls the all-provider filter by its actual meaning and lifts internal ids', async () => {
    const user = userEvent.setup()
    const onProviderChange = vi.fn()
    render(
      <Sessions
        period="lifetime"
        provider="codex"
        detectedProviders={[{ id: 'codex', label: 'Codex' }, { id: 'claude', label: 'Claude' }]}
        onProviderChange={onProviderChange}
      />,
    )

    await screen.findByRole('table', { name: 'Detailed sessions' })
    await user.click(screen.getByRole('button', { name: 'All providers' }))
    expect(onProviderChange).toHaveBeenCalledWith('all')
    await user.click(screen.getByRole('button', { name: 'Claude' }))
    expect(onProviderChange).toHaveBeenLastCalledWith('claude')
  })

  it('filters searchable session metadata and clears an empty search', async () => {
    const user = userEvent.setup()
    render(<Sessions period="lifetime" provider="all" />)
    const search = await screen.findByRole('textbox', { name: 'Search sessions' })

    await user.type(search, 'opus')
    const table = screen.getByRole('table', { name: 'Detailed sessions' })
    expect(within(table).getByText('Newest Claude')).toBeInTheDocument()
    expect(within(table).queryByText('Older Codex')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'nothing-here')
    expect(screen.getByText('No sessions match "nothing-here".')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('table', { name: 'Detailed sessions' })).toBeInTheDocument()
  })

  it('expands richer session detail and hides Saved when it is zero', async () => {
    const user = userEvent.setup()
    render(<Sessions period="lifetime" provider="all" />)
    await screen.findByRole('table', { name: 'Detailed sessions' })

    const open = screen.getByRole('button', { name: /Open session: Newest Claude/i })
    await user.click(open)
    const detail = screen.getByRole('region', { name: 'obsign session details' })

    for (const label of ['Cost', 'Cost / 1M', 'Calls', 'Turns', 'Input', 'Output', 'Cache read', 'Cache write', 'Cache reuse', 'Total']) {
      expect(within(detail).getByText(label)).toBeInTheDocument()
    }
    expect(within(detail).getByText('9×')).toBeInTheDocument()
    expect(within(detail).getByText('90% cache share')).toBeInTheDocument()
    expect(within(detail).queryByText('Saved')).not.toBeInTheDocument()
  })

  it('caps large lists client-side without fetching again', async () => {
    const user = userEvent.setup()
    const largeRows = Array.from({ length: INITIAL_VISIBLE + 5 }, (_, index) => session({
      sessionId: `session-${index}`,
      project: `project-${index}`,
      provider: 'codex',
      title: `Session ${index}`,
      endedAt: new Date(Date.UTC(2026, 7, 7, 12, 0, 0) - index * 60_000).toISOString(),
    }))
    getSessions.mockResolvedValue(largeRows)
    render(<Sessions period="lifetime" provider="all" />)

    expect(await screen.findByText(`Showing ${INITIAL_VISIBLE} of ${INITIAL_VISIBLE + 5}`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show 5 more · 5 remaining' }))
    expect(screen.getByText(`Showing ${INITIAL_VISIBLE + 5} of ${INITIAL_VISIBLE + 5}`)).toBeInTheDocument()
    expect(getSessions).toHaveBeenCalledTimes(1)
  })

  it('renders an honest empty state while keeping provider recovery controls', async () => {
    const user = userEvent.setup()
    getSessions.mockResolvedValue([])
    const onProviderChange = vi.fn()
    render(
      <Sessions
        period="week"
        provider="gemini"
        detectedProviders={[{ id: 'codex', label: 'Codex' }]}
        onProviderChange={onProviderChange}
      />,
    )

    expect(await screen.findByText('No detailed sessions are available in this range.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All providers' }))
    expect(onProviderChange).toHaveBeenCalledWith('all')
  })
})
