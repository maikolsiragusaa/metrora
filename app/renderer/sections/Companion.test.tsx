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

describe('Companion product surface v002', () => {
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
    bridge.approvePairing.mockImplementation(async () => ({
      status: shareStatus({ sharing: true, peers: 6 }),
      outcome: 'expired' as const,
    }))
  })

  it('starts the page with the product title, no section search band', async () => {
    render(<Companion />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Companion' })).toBeInTheDocument()
    expect(screen.getByText('Your Metrora control center, on Android.')).toBeInTheDocument()
    // The v002 reference removes the top band with its subtitle and reserved space.
    expect(screen.queryByText('Your local Android companion')).not.toBeInTheDocument()
    expect(document.querySelector('.companion-bar')).toBeNull()
  })

  it('shows the Local & encrypted pill', async () => {
    render(<Companion />)
    expect(await screen.findByText('Local & encrypted')).toBeInTheDocument()
  })

  it('labels peer count as paired, never connected', async () => {
    render(<Companion />)
    expect(await screen.findByTestId('companion-paired-count')).toHaveTextContent('6')
    expect(screen.getByText('paired devices')).toBeInTheDocument()
    expect(screen.getByText('Paired devices')).toBeInTheDocument()
    expect(screen.getByText('Devices paired with this Metrora instance.')).toBeInTheDocument()
    expect(screen.queryByText(/6 connected/)).not.toBeInTheDocument()
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/online/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/active now/i)).not.toBeInTheDocument()
  })

  it('maps Local sharing from ShareStatus.sharing', async () => {
    const first = render(<Companion />)
    const offLine = await screen.findByText((_, element) =>
      element?.classList.contains('companion-stat-line') === true && element.textContent === 'Sharing Off')
    expect(offLine).toBeInTheDocument()
    first.unmount()

    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({ sharing: true, peers: 2, connectPayload: 'metrora://x' }))
    render(<Companion />)
    expect(await screen.findByText((_, element) =>
      element?.classList.contains('companion-stat-line') === true && element.textContent === 'Sharing On')).toBeInTheDocument()
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

  it('renders real paired device names from the runtime peer list', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      peers: 2,
      peerList: [
        { name: 'Pixel 8', pairedAt: 1_759_500_000_000 },
        { name: 'A very long Android device name that must not break the row layout', pairedAt: 1_759_000_000_000 },
      ],
    }))
    render(<Companion />)
    expect(await screen.findByText('Pixel 8')).toBeInTheDocument()
    expect(screen.getByText(/A very long Android device name/)).toBeInTheDocument()
    // One paired-date caption per device row (month-initial, so the bare
    // "Paired" state label and "paired devices" stat don't collide).
    expect(screen.getAllByText(/^Paired [A-Z]/).length).toBe(2)
  })

  it('supports zero devices and the legacy count-only payload', async () => {
    const first = render(<Companion />)
    expect(await screen.findByText('No paired devices yet')).toBeInTheDocument()
    first.unmount()

    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({ peers: 3 }))
    render(<Companion />)
    expect(await screen.findByText('3 paired devices')).toBeInTheDocument()
  })

  it('shows Start pairing when sharing is off and starts the real service', async () => {
    render(<Companion />)
    const start = await screen.findByRole('button', { name: 'Start pairing' })
    fireEvent.click(start)
    await waitFor(() => expect(bridge.startShare).toHaveBeenCalledTimes(1))
    // Opening the pairing surface is the v002 dialog, not an inline QR swap.
    expect(await screen.findByText('Scan to connect')).toBeInTheDocument()
  })

  it('offers Show pairing code and a real Stop sharing while active', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({ sharing: true, peers: 6, connectPayload: 'metrora://x' }))
    render(<Companion />)
    expect(await screen.findByRole('button', { name: 'Show pairing code' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))
    await waitFor(() => expect(bridge.stopShare).toHaveBeenCalledTimes(1))
  })

  it('renders the factual capability grid', async () => {
    render(<Companion />)
    expect(await screen.findByRole('heading', { name: 'On your Companion' })).toBeInTheDocument()
    expect(screen.getByText('Home / Usage')).toBeInTheDocument()
    expect(screen.getByText('Your usage overview')).toBeInTheDocument()
    expect(screen.getByText('Activity')).toBeInTheDocument()
    expect(screen.getByText('Recent sessions')).toBeInTheDocument()
    expect(screen.getByText('Models')).toBeInTheDocument()
    expect(screen.getByText('Model usage and costs')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Browse your projects')).toBeInTheDocument()
    expect(screen.getByText('Spend')).toBeInTheDocument()
    expect(screen.getByText('Track your spending')).toBeInTheDocument()
    expect(screen.getByText('Capacity')).toBeInTheDocument()
    expect(screen.getByText('Provider quotas and credits')).toBeInTheDocument()
    // The mockup does not authorize dropping Workspace or other real capabilities.
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    const capacityRow = screen.getByText('Capacity').closest('li')!
    expect(within(capacityRow).getByText('Available')).toBeInTheDocument()
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
    const workspaceTile = (await screen.findByText('Workspace')).closest('li')!
    expect(within(workspaceTile).getByText('Desktop only')).toBeInTheDocument()
    expect(within(workspaceTile).getByText('Not available on Android.')).toBeInTheDocument()
    expect(within(workspaceTile).queryByRole('button')).not.toBeInTheDocument()
    expect(workspaceTile.getAttribute('aria-disabled')).toBe('true')
  })

  it('makes no fake Project management or model comparison claims', async () => {
    render(<Companion />)
    await screen.findByRole('heading', { name: 'On your Companion' })
    expect(screen.queryByText(/Manage projects/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Compare models/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Compare.*model/i)).not.toBeInTheDocument()
  })

  it('advertises no unshipped product UI', async () => {
    render(<Companion />)
    await screen.findByRole('heading', { name: 'On your Companion' })
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

  it('keeps the privacy note factual', async () => {
    render(<Companion />)
    expect(await screen.findByRole('heading', { name: 'Local by design' })).toBeInTheDocument()
    expect(screen.getByText('Your desktop stays in control. Companion connects over your local network.')).toBeInTheDocument()
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

  it('promotes a pending pairing to the verify dialog with the real SAS', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
      pending: [{ id: 'pair-9', name: 'Pixel 8', code: '112233' }],
    }))
    render(<Companion />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show pairing code' }))
    expect(await screen.findByText('Verify your device')).toBeInTheDocument()
    expect(screen.getByText('Pixel 8')).toBeInTheDocument()
    expect(screen.getByTestId('companion-sas-code')).toHaveTextContent('112233')
    expect(screen.getByRole('button', { name: 'Codes match — approve' })).toBeInTheDocument()
    // The illustrative mockup wording never ships.
    expect(document.body.textContent).not.toMatch(/Example code/i)
  })

  it('approves through the bridge and shows success only after runtime confirmation', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
      pending: [{ id: 'pair-9', name: 'Pixel 8', code: '112233' }],
    }))
    bridge.approvePairing.mockImplementation(async () => ({
      status: shareStatus({ sharing: true, peers: 7, pending: [] }),
      outcome: 'paired' as const,
    }))
    render(<Companion />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show pairing code' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Codes match — approve' }))
    await waitFor(() => expect(bridge.approvePairing).toHaveBeenCalledWith('pair-9', true))
    expect(await screen.findByText('Device paired')).toBeInTheDocument()
    expect(screen.getByText('Your Android device is now paired with Metrora.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('Device paired')).not.toBeInTheDocument()
  })

  it('treats the paired outcome as the only success proof, not the peer count', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
      pending: [{ id: 'pair-9', name: 'Pixel 8', code: '112233' }],
    }))
    // Peers unchanged and the request still listed: only the confirmed
    // outcome may promote to success.
    bridge.approvePairing.mockImplementation(async () => ({
      status: shareStatus({
        sharing: true,
        peers: 6,
        pending: [{ id: 'pair-9', name: 'Pixel 8', code: '112233' }],
      }),
      outcome: 'paired' as const,
    }))
    render(<Companion />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show pairing code' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Codes match — approve' }))
    await waitFor(() => expect(bridge.approvePairing).toHaveBeenCalledWith('pair-9', true))
    expect(await screen.findByText('Device paired')).toBeInTheDocument()
  })

  it('shows expiry when the request vanished before the approval click', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
      pending: [{ id: 'pair-9', name: 'Pixel 8', code: '112233' }],
    }))
    bridge.approvePairing.mockImplementation(async () => ({
      status: shareStatus({ sharing: true, peers: 6, pending: [] }),
      outcome: 'expired' as const,
    }))
    render(<Companion />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show pairing code' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Codes match — approve' }))
    await waitFor(() => expect(bridge.approvePairing).toHaveBeenCalledWith('pair-9', true))
    expect(await screen.findByRole('heading', { name: 'Pairing request expired' })).toBeInTheDocument()
    expect(screen.queryByText('Device paired')).not.toBeInTheDocument()
  })

  it('shows a save failure instead of success when persistence rolls back', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
      pending: [{ id: 'pair-9', name: 'Pixel 8', code: '112233' }],
    }))
    bridge.approvePairing.mockImplementation(async () => ({
      status: shareStatus({ sharing: true, peers: 6, pending: [] }),
      outcome: 'persist-failed' as const,
    }))
    render(<Companion />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show pairing code' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Codes match — approve' }))
    await waitFor(() => expect(bridge.approvePairing).toHaveBeenCalledWith('pair-9', true))
    expect(await screen.findByText('Pairing failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeInTheDocument()
    expect(screen.queryByText('Device paired')).not.toBeInTheDocument()
  })

  it('declines through the Cancel action and returns to the QR stage', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
      pending: [{ id: 'pair-9', name: 'Pixel 8', code: '112233' }],
    }))
    bridge.approvePairing.mockImplementation(async () => ({
      status: shareStatus({ sharing: true, peers: 6, pending: [] }),
      outcome: 'declined' as const,
    }))
    render(<Companion />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show pairing code' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(bridge.approvePairing).toHaveBeenCalledWith('pair-9', false))
    expect(await screen.findByText('Scan to connect')).toBeInTheDocument()
  })

  it('renders the live QR and waiting state inside the dialog', async () => {
    __resetPolledMemo()
    bridge.getShareStatus.mockResolvedValue(shareStatus({
      sharing: true,
      peers: 6,
      connectPayload: 'metrora://pair-qr-payload',
    }))
    render(<Companion />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show pairing code' }))
    expect(await screen.findByText('Scan to connect')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[aria-label="Metrora connection QR code"]')).not.toBeNull())
    expect(screen.getByText('Waiting for your phone…')).toBeInTheDocument()
    expect(screen.getByText('Encrypted local pairing')).toBeInTheDocument()
    // No bare six-digit SAS code in the QR-only state.
    expect(document.body.textContent).not.toMatch(/\b\d{6}\b/)
  })
})
