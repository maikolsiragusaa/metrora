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

  it('uses last activity for Recent and keeps the table columns fixed across sorting', async () => {
    const user = userEvent.setup()
    getSessions.mockResolvedValue([
      session({ sessionId: 'started-late', title: 'Started later', project: 'metrora', provider: 'codex', cost: 99, startedAt: '2026-08-08T12:00:00.000Z', endedAt: '2026-08-08T12:10:00.000Z' }),
      session({ sessionId: 'active-late', title: 'Active later', project: 'metrora', provider: 'codex', startedAt: '2026-08-08T10:00:00.000Z', endedAt: '2026-08-08T12:30:00.000Z' }),
    ])
    render(<Sessions period="lifetime" provider="all" />)
    const table = await screen.findByRole('table', { name: 'Detailed sessions' })
    const headers = within(table).getAllByRole('columnheader').map(header => header.textContent)
    const initialRows = within(table).getAllByRole('row').slice(1)
    expect(initialRows[0]).toHaveTextContent('Active later')
    expect(within(table).getByRole('columnheader', { name: 'Last Active' })).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Started' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Cost' }))
    const sortedTable = screen.getByRole('table', { name: 'Detailed sessions' })
    expect(within(sortedTable).getAllByRole('row').slice(1)[0]).toHaveTextContent('Started later')
    expect(within(sortedTable).getAllByRole('columnheader').map(header => header.textContent)).toEqual(headers)
  })

  it('sorts by Calls while changing row order only', async () => {
    const user = userEvent.setup()
    getSessions.mockResolvedValue([
      session({ sessionId: 'few-calls', title: 'Few calls', project: 'metrora', provider: 'codex', calls: 2, endedAt: '2026-08-08T12:30:00.000Z' }),
      session({ sessionId: 'many-calls', title: 'Many calls', project: 'metrora', provider: 'codex', calls: 20, endedAt: '2026-08-08T10:30:00.000Z' }),
    ])
    render(<Sessions period="lifetime" provider="all" />)

    const table = await screen.findByRole('table', { name: 'Detailed sessions' })
    const headers = within(table).getAllByRole('columnheader').map(header => header.textContent)
    expect(headers).toEqual(['Session', 'Client', 'Model', 'Turn', 'Calls', 'Input', 'Output', 'Cache R', 'Cache W', 'Cache×', 'Total', 'Cost', 'Cost/1M', 'Duration', 'Last Active'])
    expect(table.closest('[data-scroll-mode="page"]')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Calls' }))

    const sortedTable = screen.getByRole('table', { name: 'Detailed sessions' })
    expect(within(sortedTable).getAllByRole('row').slice(1)[0]).toHaveTextContent('Many calls')
    expect(within(sortedTable).getAllByRole('columnheader').map(header => header.textContent)).toEqual(headers)
  })

  it('sorts by exact Duration while retaining the full table schema', async () => {
    const user = userEvent.setup()
    getSessions.mockResolvedValue([
      session({ sessionId: 'short', title: 'Short session', project: 'metrora', provider: 'codex', durationMs: 60_000 }),
      session({ sessionId: 'long', title: 'Long session', project: 'metrora', provider: 'codex', durationMs: 3_600_000 }),
    ])
    render(<Sessions period="lifetime" provider="all" />)

    const table = await screen.findByRole('table', { name: 'Detailed sessions' })
    await user.click(screen.getByRole('tab', { name: 'Duration' }))

    expect(within(table).getAllByRole('row').slice(1)[0]).toHaveTextContent('Long session')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(15)
  })

  it('explains available detail versus durable historical session totals', async () => {
    render(<Sessions period="lifetime" provider="all" historicalSessionCount={4} />)

    const heading = await screen.findByRole('heading', { name: 'Sessions' })
    expect(heading.parentElement).toHaveTextContent('3 sessions')
    expect(heading.parentElement).toHaveTextContent('$13.00 total spend')
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
    expect(within(table).getByRole('columnheader', { name: 'Cache×' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Cost/1M' })).toBeInTheDocument()
  })

  it('preserves observed mixed reasoning while adding only the explicit subtotal', async () => {
    const user = userEvent.setup()
    getSessions.mockResolvedValue([session({
      sessionId: 'mixed',
      title: 'Mixed reasoning',
      project: 'metrora',
      provider: 'copilot',
      inputTokens: 0,
      outputTokens: 200,
      reasoningTokens: 50,
      additiveReasoningTokens: 30,
      reasoningSemantics: 'mixed',
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 2.3,
    })])
    render(<Sessions period="lifetime" provider="all" />)

    const table = await screen.findByRole('table', { name: 'Detailed sessions' })
    const row = within(table).getAllByRole('row')[1]!
    expect(row).toHaveTextContent('230')
    await user.click(within(row).getByRole('button', { name: /Select session: Mixed reasoning/i }))
    const detail = screen.getByRole('complementary', { name: 'Mixed reasoning' })
    expect(within(detail).getByRole('tab', { name: 'Reasoning' })).toBeInTheDocument()
    expect(within(detail).getByText('50 observed tokens', { exact: true })).toBeInTheDocument()
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

  it('keeps every detected provider directly reachable in one overflow strip', async () => {
    const providers = Array.from({ length: 11 }, (_, index) => ({ id: `provider-${index}`, label: `Provider ${index}` }))
    render(<Sessions period="lifetime" provider="all" detectedProviders={providers} />)

    await screen.findByRole('table', { name: 'Detailed sessions' })
    expect(screen.getByRole('button', { name: 'Provider 10' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^More$/ })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Filter sessions by provider' })).toHaveAttribute('data-provider-strip', 'true')
  })

  it('keeps the visible Project, Model, Client, and Date controls as real row filters', async () => {
    const user = userEvent.setup()
    render(<Sessions period="lifetime" provider="all" />)
    const table = await screen.findByRole('table', { name: 'Detailed sessions' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'obsign')
    expect(within(table).getByText('Newest Claude')).toBeInTheDocument()
    expect(within(table).queryByText('Middle Codex')).not.toBeInTheDocument()
    expect(within(table).queryByText('Older Codex')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'claude-opus-4-6')
    expect(within(table).getByText('Newest Claude')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Client' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Date' })).toBeInTheDocument()
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

  it('opens a persistent inspector with truthful aggregate detail and hides unsupported actions', async () => {
    const user = userEvent.setup()
    render(<Sessions period="lifetime" provider="all" />)
    await screen.findByRole('table', { name: 'Detailed sessions' })

    const open = screen.getByRole('button', { name: /Select session: Newest Claude/i })
    await user.click(open)
    const detail = screen.getByRole('complementary', { name: 'Newest Claude' })
    const metrics = detail.querySelector('.session-inspector-metrics-primary') as HTMLElement

    for (const label of ['Total cost', 'Total tokens', 'API calls', 'Duration', 'Cache read', 'Cache write']) {
      expect(within(metrics).getByText(label, { exact: true })).toBeInTheDocument()
    }
    const tokenMetrics = detail.querySelector('.session-inspector-metrics-secondary') as HTMLElement
    for (const label of ['Cache multiplier', 'Input', 'Output']) {
      expect(within(tokenMetrics).getByText(label, { exact: true })).toBeInTheDocument()
    }
    expect(within(detail).getByText('9×')).toBeInTheDocument()
    expect(within(detail).getByText('Token activity')).toBeInTheDocument()
    expect(within(detail).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(within(detail).getByRole('status')).toHaveTextContent('Temporal call activity is unavailable')
    expect(within(detail).queryByText('Open in Code')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More filters' })).not.toBeInTheDocument()

    await user.click(within(detail).getByRole('button', { name: 'Close session inspector' }))
    expect(screen.queryByRole('complementary', { name: 'Newest Claude' })).not.toBeInTheDocument()
    expect(open).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders canonical token activity when the bounded series reconciles exactly', async () => {
    const user = userEvent.setup()
    getSessions.mockResolvedValue([session({
      sessionId: 'activity',
      title: 'Activity session',
      project: 'metrora',
      provider: 'codex',
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 2,
      tokenActivity: [{
        timestamp: '2026-08-07T10:10:00.000Z',
        calls: 1,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 2,
        additiveReasoningTokens: 0,
        totalTokens: 62,
      }],
    })])
    render(<Sessions period="lifetime" provider="all" />)
    await user.click(await screen.findByRole('button', { name: /Select session: Activity session/i }))

    const detail = screen.getByRole('complementary', { name: 'Activity session' })
    expect(within(detail).getByRole('img', { name: /Token activity: 1 canonical calls across 1 points, reconciling to 62 total tokens/i })).toBeInTheDocument()
    expect(within(detail).queryByRole('status')).not.toBeInTheDocument()
  })

  it('uses a shortened session id when both title and project are unavailable', async () => {
    getSessions.mockResolvedValue([session({ sessionId: '123456789012345678901234', title: '', project: '', provider: 'codex' })])
    render(<Sessions period="lifetime" provider="all" />)

    const table = await screen.findByRole('table', { name: 'Detailed sessions' })
    const row = within(table).getAllByRole('row')[1]!
    expect(within(row).getByText('1234567890…01234')).toBeInTheDocument()
  })

  it('switches the single inspector between selected rows without duplicating the list', async () => {
    const user = userEvent.setup()
    render(<Sessions period="lifetime" provider="all" />)
    await screen.findByRole('table', { name: 'Detailed sessions' })

    await user.click(screen.getByRole('button', { name: /Select session: Newest Claude/i }))
    expect(screen.getByRole('heading', { name: 'Newest Claude' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Select session: Older Codex/i }))

    expect(screen.getByRole('heading', { name: 'Older Codex' })).toBeInTheDocument()
    expect(screen.getAllByRole('complementary')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Selected session: Older Codex/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Select session: Newest Claude/i })).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows exact linked pull requests when the canonical session projection provides them', async () => {
    getSessions.mockResolvedValue([session({
      sessionId: 'linked',
      title: 'Linked work',
      project: 'metrora',
      provider: 'codex',
      prLinks: ['https://github.com/org/repo/pull/42'],
    })])
    const user = userEvent.setup()
    render(<Sessions period="lifetime" provider="all" />)
    await user.click(await screen.findByRole('button', { name: /Select session: Linked work/i }))

    const prs = screen.getByRole('region', { name: 'Linked pull requests' })
    expect(within(prs).getByText('org/repo#42')).toBeInTheDocument()
    expect(within(prs).getByText('Exact session linkage')).toBeInTheDocument()
    expect(within(prs).getByRole('link', { name: 'org/repo#42' })).toHaveAttribute('href', 'https://github.com/org/repo/pull/42')
  })

  it('paginates the bounded list client-side without fetching again', async () => {
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

    expect(await screen.findByText(`Showing 1–${INITIAL_VISIBLE} of ${INITIAL_VISIBLE + 5}`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Go to page 2' }))
    expect(screen.getByText(`Showing ${INITIAL_VISIBLE + 1}–${INITIAL_VISIBLE + 5} of ${INITIAL_VISIBLE + 5}`)).toBeInTheDocument()
    expect(screen.getByText(`Session ${INITIAL_VISIBLE + 4}`)).toBeInTheDocument()
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
