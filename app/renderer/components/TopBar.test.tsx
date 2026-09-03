// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DesktopSectionCapabilities } from '../lib/desktopSections'
import { TopBar } from './TopBar'

const full: DesktopSectionCapabilities = {
  period: true,
  customRange: true,
  provider: true,
  claudeConfig: true,
  globalRefresh: true,
}

function renderTopBar(capabilities: DesktopSectionCapabilities, onAskHarness?: () => void, onRefresh?: () => void) {
  render(
    <TopBar
      title="Workspace"
      scope="Last 7 days · All providers"
      period="week"
      onPeriodChange={vi.fn()}
      customRange={null}
      onRangeSelect={vi.fn()}
      provider="all"
      providerLabel="All providers"
      providerOptions={[{ value: 'all', label: 'All providers' }]}
      onProviderSelect={vi.fn()}
      claudeConfigs={{
        selectedId: null,
        options: [{ id: 'default', label: 'Default', path: '/config/default' }],
      }}
      configSource={null}
      onConfigSelect={vi.fn()}
      capabilities={capabilities}
      onAskHarness={onAskHarness}
      onRefresh={onRefresh}
    />,
  )
}

describe('TopBar scope capabilities', () => {
  it('shows the supported analytics controls', () => {
    renderTopBar(full)
    expect(screen.getByText('7D')).toBeInTheDocument()
    expect(screen.getByLabelText('Choose date range')).toBeInTheDocument()
    expect(screen.getByText('All providers')).toBeInTheDocument()
    expect(screen.getByLabelText('Claude config source')).toBeInTheDocument()
  })

  it('wires the visible Refresh control only when the section exposes it', () => {
    const onRefresh = vi.fn()
    renderTopBar(full, undefined, onRefresh)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('keeps read-only scope context without implying Workspace filters', () => {
    renderTopBar({
      period: false,
      customRange: false,
      provider: false,
      claudeConfig: false,
      globalRefresh: true,
    })
    expect(screen.getByText('Last 7 days · All providers')).toBeInTheDocument()
    expect(screen.queryByText('7D')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Choose date range')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Claude config source')).not.toBeInTheDocument()
  })

  it('renders one page-level Ask Harness action without adding card-level advice controls', () => {
    const onAskHarness = vi.fn()
    renderTopBar(full, onAskHarness)

    fireEvent.click(screen.getByRole('button', { name: 'Ask Harness' }))

    expect(onAskHarness).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('button', { name: 'Ask Harness' })).toHaveLength(1)
  })
})
