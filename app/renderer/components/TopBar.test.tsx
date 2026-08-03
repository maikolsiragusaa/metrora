// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
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

function renderTopBar(capabilities: DesktopSectionCapabilities) {
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
})
