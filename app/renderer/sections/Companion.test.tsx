// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetPolledMemo } from '../hooks/usePolled'
import type { CompanionCapabilitiesV1, ShareStatus } from '../lib/types'
import { Companion } from './Companion'

const bridge = vi.hoisted(() => ({
  getShareStatus: vi.fn(),
  getCompanionCapabilities: vi.fn(),
  startShare: vi.fn(),
  stopShare: vi.fn(),
  approvePairing: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  metrora: bridge,
  normalizeCliError: (error: unknown) => ({
    kind: 'nonzero',
    message: error instanceof Error ? error.message : String(error),
  }),
}))

function shareStatus(overrides: Partial<ShareStatus> = {}): ShareStatus {
  return {
    sharing: false,
    name: 'Metrora Desktop',
    port: 7777,
    host: '192.168.1.10',
    addresses: ['192.168.1.10'],
    connectPayload: null,
    always: false,
    peers: 0,
    pending: [],
    ...overrides,
  }
}

function capabilities(options: { capacityAvailable?: boolean } = {}): CompanionCapabilitiesV1 {
  const available = [
    'home.usage',
    'projects',
    'activity.sessions',
    'activity.pullRequests',
    'analyze.models',
    'analyze.spend',
    'device.settings',
  ]
  if (options.capacityAvailable) available.push('home.capacity')
  const ids = [
    'home.usage',
    'home.capacity',
    'projects',
    'activity.sessions',
    'activity.pullRequests',
    'analyze.models',
    'analyze.spend',
    'workspace',
    'device.settings',
  ] as const
  return {
    kind: 'metrora.companion.capabilities',
    version: 1,
    generatedAt: '2026-09-21T00:00:00.000Z',
    capabilities: ids.map(id => ({
      id,
      versions: [1],
      availability: (available as string[]).includes(id) ? ('available' as const) : ('unavailable' as const),
      freshness: 'unknown' as const,
      scopes: { period: true, project: true, workspace: false },
      ...(id === 'workspace' ? { reason: 'no-authority' as const } : {}),
    })),
  }
}

describe('Companion product surface', () => {
  beforeEach(() => {
    __resetPolledMemo()
    bridge.getShareStatus.mockReset()
    bridge.getCompanionCapabilities.mockReset()
    bridge.startShare.mockReset()
    bridge.stopShare.mockReset()
    bridge.approvePairing.mockReset()
    bridge.getShareStatus.mockResolvedValue(shareStatus({ sharing: false, peers: 6 }))
    bridge.getCompanionCapabilities.mockResolvedValue(capabilities({ capacityAvailable: true }))
    bridge.startShare.mockImplementation(async () => shareStatus({ sharing: true, peers: 6, connectPayload: 'metrora://pair-test' }))
    bridge.stopShare.mockImplementation(async () => shareStatus({ sharing: false, peers: 6 }))
    bridge.approvePairing.mockImplementation(async () => shareStatus({ sharing: true, peers: 6 }))
  })

  it('renders the Companion top bar with the local subtitle', async () => {
    render(<Companion />)
    expect(await screen.findByText('Companion')).toBeInTheDocument()
    expect(screen.getByText('Your local Android companion')).toBeInTheDocument()
    expect(screen.queryByText('Android pairing and local device sync')).not.toBeInTheDocument()
  })

  it('removes the global Overview refresh button', async () => {
    render(<Companion />)
    await screen.findByText('Companion')
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Refreshing/)).not.toBeInTheDocument()
  })

  it('renders the product hero', async () => {
    render(<Companion />)
    expect(await screen.findByRole('heading', { name: /Take Metrora with you\./ })).toBeInTheDocument()
    expect(screen.getByText(/Desktop remains the authority; Companion receives only bounded mobile data\./)).toBeInTheDocument()
  })

  it('uses the approved hero artwork without duplicating raster text', async () => {
    const { container } = render(<Companion />)
    await screen.findByRole('heading', { name: /Take Metrora with you\./ })
    const art = container.querySelector('.companion-hero-art')
    expect(art).not.toBeNull()
    expect(art?.getAttribute('aria-hidden')).toBe('true')
    const img = container.querySelector('.companion-hero-device') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toMatch(/companion-hero/)
    expect(img?.getAttribute('alt')).toBe('')
    // Live semantic copy stays real HTML; the raster headline is never
    // duplicated as a second visible heading.
    expect(screen.getAllByText(/Take Metrora/).length).toBe(1)
  })

  it('labels peer count as paired, never connected', async () => {
    render(<Companion />)
    expect(await screen.findByTestId('companion-paired-count')).toHaveTextContent('6')
    expect(screen.getByText('Paired devices')).toBeInTheDocument()
    expect(screen.queryByText(/6 connected/)).not.toBeInTheDocument()
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/online/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/active now/i)).not.toBeInTheDocument()
  })

  it('maps Local sharing from ShareStatus.sharing', async () => {
    const first = render(<Companion />)
    expect(await first.findByText('Pairing service stopped')).toBeInTheDocument()
    expect(first.container.textContent).toContain('Off')
    first.unmount()

    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({ sharing: true, peers: 2, connectPayload: 'metrora://x' }))
    render(<Companion />)
    expect(await screen.findByText('Ready for local pairing')).toBeInTheDocument()
  })

  it('surfaces the local network warning instead of a healthy claim', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 1,
      connectPayload: 'metrora://x',
      networkWarning: 'No non-loopback LAN address was detected; choose a local network address manually.',
    }))
    render(<Companion />)
    const warnings = await screen.findAllByText(/No non-loopback LAN address was detected/)
    expect(warnings.length).toBeGreaterThanOrEqual(1)
  })

  it('shows an unavailable connection state when sharing state cannot be read', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockRejectedValue(new Error('share unavailable'))
    bridge.getCompanionCapabilities.mockResolvedValue(capabilities())
    render(<Companion />)
    const unavailable = await screen.findAllByText('Unable to read local sharing state.')
    expect(unavailable.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Start pairing when sharing is off and starts the real service', async () => {
    render(<Companion />)
    const start = await screen.findByRole('button', { name: 'Start pairing' })
    fireEvent.click(start)
    await waitFor(() => expect(bridge.startShare).toHaveBeenCalledTimes(1))
  })

  it('renders the real QR path and waiting state when sharing is on', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
    }))
    const { container } = render(<Companion />)
    expect(await screen.findByText('Scan with Metrora Android')).toBeInTheDocument()
    expect(await screen.findByText('Waiting for a device…')).toBeInTheDocument()
    expect(container.querySelector('[aria-label="Metrora connection QR code"]')).not.toBeNull()
    expect(screen.getByText(/After scanning, a pairing request will appear here\./)).toBeInTheDocument()
  })

  it('never shows a six-digit code without a pending request', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 1,
      connectPayload: 'metrora://pair-qr-payload',
    }))
    render(<Companion />)
    await screen.findByText('Waiting for a device…')
    expect(screen.queryByText(/Pairing request/)).not.toBeInTheDocument()
    // No bare six-digit SAS code in the QR-only state.
    expect(document.body.textContent).not.toMatch(/\b\d{6}\b/)
  })

  it('promotes a pending pairing with device name and exact SAS', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
      pending: [{ id: 'pair-1', name: 'Pixel 8', code: '482913' }],
    }))
    render(<Companion />)
    expect(await screen.findByText('Pixel 8')).toBeInTheDocument()
    expect(screen.getByText('482913')).toBeInTheDocument()
    expect(screen.getByText(/Compare the six-digit verification code on both devices before approving/)).toBeInTheDocument()
  })

  it('approves and declines through the existing bridge actions', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
      pending: [{ id: 'pair-9', name: 'Pixel 8', code: '112233' }],
    }))
    render(<Companion />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(bridge.approvePairing).toHaveBeenCalledWith('pair-9', true))

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(bridge.approvePairing).toHaveBeenCalledWith('pair-9', false))
  })

  it('keeps copy as connection payload and stop sharing real', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
    }))
    render(<Companion />)
    expect(await screen.findByRole('button', { name: 'Copy connection payload' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy pairing code/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))
    await waitFor(() => expect(bridge.stopShare).toHaveBeenCalledTimes(1))
  })

  it('renders the factual capability list', async () => {
    render(<Companion />)
    expect(await screen.findByRole('heading', { name: 'Available on your Companion' })).toBeInTheDocument()
    expect(screen.getByText('Home / Usage')).toBeInTheDocument()
    expect(screen.getByText('Monitor usage and the mobile overview.')).toBeInTheDocument()
    expect(screen.getByText('Activity')).toBeInTheDocument()
    expect(screen.getByText('Models')).toBeInTheDocument()
    expect(screen.getByText('Inspect model usage and economics.')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Browse Projects and change scope.')).toBeInTheDocument()
    expect(screen.getByText('Spend')).toBeInTheDocument()
    expect(screen.getByText('Capacity')).toBeInTheDocument()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
  })

  it('follows canonical Capacity availability', async () => {
    const first = render(<Companion />)
    const capacityRow = (await screen.findByText('Capacity')).closest('li')!
    expect(within(capacityRow).getByText('Available')).toBeInTheDocument()
    first.unmount()

    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({ sharing: false, peers: 0 }))
    bridge.getCompanionCapabilities.mockResolvedValue(capabilities({ capacityAvailable: false }))
    render(<Companion />)
    const row = (await screen.findByText('Capacity')).closest('li')!
    expect(await within(row).findByText('Unavailable')).toBeInTheDocument()
    expect(within(row).queryByText('Available')).not.toBeInTheDocument()
  })

  it('keeps Workspace Desktop-only and non-interactive', async () => {
    render(<Companion />)
    const workspaceRow = (await screen.findByText('Workspace')).closest('li')!
    expect(within(workspaceRow).getByText('Desktop only')).toBeInTheDocument()
    expect(within(workspaceRow).getByText('Not available on Android.')).toBeInTheDocument()
    expect(within(workspaceRow).queryByRole('button')).not.toBeInTheDocument()
    expect(workspaceRow.getAttribute('aria-disabled')).toBe('true')
  })

  it('makes no fake Project management or model comparison claims', async () => {
    render(<Companion />)
    await screen.findByRole('heading', { name: 'Available on your Companion' })
    expect(screen.queryByText(/Manage projects/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Compare models/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Compare.*model/i)).not.toBeInTheDocument()
  })

  it('advertises no unshipped product UI', async () => {
    render(<Companion />)
    await screen.findByRole('heading', { name: 'Available on your Companion' })
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/Metrora Pro/i)
    expect(text).not.toMatch(/Remote access/i)
    expect(text).not.toMatch(/Remote control/i)
    expect(text).not.toMatch(/Cloud sync/i)
    expect(text).not.toMatch(/Coming soon/i)
    expect(text).not.toMatch(/Team access/i)
    expect(text).not.toMatch(/Organization/i)
    expect(text).not.toMatch(/chatbot/i)
  })

  it('explains Local by design without claiming no data leaves the computer', async () => {
    render(<Companion />)
    expect(await screen.findByRole('heading', { name: 'Local by design' })).toBeInTheDocument()
    expect(screen.getByText('Desktop stays authoritative')).toBeInTheDocument()
    expect(screen.getAllByText('Secure local pairing').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Bounded mobile data').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/no data leaves the computer/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/all your data stays on this machine/i)).not.toBeInTheDocument()
  })

  it('retries capabilities through a bounded local action', async () => {
    __resetPolledMemo()
    bridge.getCompanionCapabilities.mockRejectedValueOnce(new Error('unavailable'))
    render(<Companion />)
    expect(await screen.findByText('Companion capabilities are unavailable.')).toBeInTheDocument()
    bridge.getCompanionCapabilities.mockResolvedValue(capabilities())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Home / Usage')).toBeInTheDocument()
  })
})
