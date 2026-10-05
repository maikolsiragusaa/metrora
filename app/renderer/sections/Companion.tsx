import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { CompanionPairingDialog } from './CompanionPairingDialog'
import { usePolled } from '../hooks/usePolled'
import { metrora, normalizeCliError } from '../lib/ipc'
import { motionClass } from '../lib/motion'
import { showToast } from '../lib/toast'
import type { CompanionCapabilitiesV1, CompanionCapabilityV1, ShareStatus } from '../lib/types'

type CapabilitiesState = {
  data: CompanionCapabilitiesV1 | null
  error: string | null
  loading: boolean
}

function useCompanionCapabilities(): CapabilitiesState & { retry: () => void } {
  const [state, setState] = useState<CapabilitiesState>({ data: null, error: null, loading: true })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let active = true
    setState(previous => ({ ...previous, loading: true, error: null }))
    const bridge = metrora as unknown as {
      getCompanionCapabilities?: () => Promise<CompanionCapabilitiesV1>
    }
    if (typeof bridge.getCompanionCapabilities !== 'function') {
      if (active) setState({ data: null, error: 'Companion capabilities are unavailable.', loading: false })
      return () => { active = false }
    }
    void bridge
      .getCompanionCapabilities()
      .then(data => {
        if (active) setState({ data, error: null, loading: false })
      })
      .catch(() => {
        if (active) setState({ data: null, error: 'Companion capabilities are unavailable.', loading: false })
      })
    return () => { active = false }
  }, [nonce])

  const retry = useCallback(() => setNonce(value => value + 1), [])
  return { ...state, retry }
}

function capabilityById(data: CompanionCapabilitiesV1 | null, id: CompanionCapabilityV1['id']): CompanionCapabilityV1 | null {
  return data?.capabilities.find(entry => entry.id === id) ?? null
}

function isAvailable(entry: CompanionCapabilityV1 | null): boolean {
  return entry?.availability === 'available'
}

function pairedDate(pairedAt: number): string {
  const date = new Date(pairedAt)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function DeviceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v5.5c0 4.4-2.4 7.6-8 9.5-5.6-1.9-8-5.1-8-9.5V6z" /></svg>
  )
}

/** Decorative phone for the pairing panel: a clean local vector illustration,
 *  not a raster crop of the generated mockup. */
function PairPhoneArt() {
  return (
    <svg className="companion-pair-art-svg" viewBox="0 0 240 320" aria-hidden="true">
      <defs>
        <linearGradient id="companion-art-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(167,139,250,.32)" />
          <stop offset="1" stopColor="rgba(93,66,213,.16)" />
        </linearGradient>
        <linearGradient id="companion-art-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#171233" />
          <stop offset="1" stopColor="#0C0A1E" />
        </linearGradient>
        <linearGradient id="companion-art-bar" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#7C5CFF" />
          <stop offset="1" stopColor="#B9A6FF" />
        </linearGradient>
        <radialGradient id="companion-art-glow" cx=".5" cy=".45" r=".65">
          <stop offset="0" stopColor="rgba(124,92,255,.5)" />
          <stop offset="1" stopColor="rgba(124,92,255,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="120" cy="150" rx="112" ry="128" fill="url(#companion-art-glow)" />
      <rect x="58" y="26" width="124" height="268" rx="30" fill="url(#companion-art-body)" stroke="rgba(185,166,255,.5)" strokeWidth="1.5" />
      <rect x="68" y="36" width="104" height="248" rx="22" fill="url(#companion-art-screen)" />
      <rect x="104" y="46" width="32" height="7" rx="3.5" fill="rgba(185,166,255,.4)" />
      <g fill="url(#companion-art-bar)">
        <rect x="86" y="128" width="9" height="52" rx="3" />
        <rect x="101" y="114" width="9" height="80" rx="3" />
        <rect x="116" y="100" width="9" height="108" rx="3" />
        <rect x="131" y="114" width="9" height="80" rx="3" />
        <rect x="146" y="128" width="9" height="52" rx="3" />
      </g>
      <path d="M68 236c22-16 42-16 62 0s40 16 62 0" stroke="rgba(124,92,255,.55)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M68 254c22-16 42-16 62 0s40 16 62 0" stroke="rgba(124,92,255,.3)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

const FEATURE_TILES = [
  { key: 'home', name: 'Home / Usage', desc: 'Your usage overview', icon: 'home' },
  { key: 'activity', name: 'Activity', desc: 'Recent sessions', icon: 'activity' },
  { key: 'models', name: 'Models', desc: 'Model usage and costs', icon: 'models' },
  { key: 'projects', name: 'Projects', desc: 'Browse your projects', icon: 'projects' },
  { key: 'spend', name: 'Spend', desc: 'Track your spending', icon: 'spend' },
  { key: 'capacity', name: 'Capacity', desc: 'Provider quotas and credits', icon: 'capacity' },
] as const

function FeatureIcon({ icon }: { icon: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="M4 11l8-7 8 7" /><path d="M6 9.5V20h12V9.5" /></>,
    activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    models: <><path d="M12 2.5l8 4.5v9l-8 4.5-8-4.5v-9z" /><path d="M12 11.5l8-4.5M12 11.5v9M12 11.5L4 7" /></>,
    projects: <path d="M3.5 7.5h6l1.8 2h9.2v8.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
    spend: <><ellipse cx="12" cy="5.5" rx="8" ry="2.8" /><path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6" /><path d="M4 11.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6" /></>,
    capacity: <path d="M5 20v-7M10 20V6M15 20v-10M20 20V9" />,
    workspace: <><circle cx="9" cy="8" r="3.2" /><circle cx="17" cy="9.5" r="2.6" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M14.5 15.2c2.3.2 4 1.5 4.5 3.8" /></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[icon]}</svg>
}

export function Companion() {
  const shareStatus = usePolled<ShareStatus>(() => metrora.getShareStatus(), [], { intervalMs: 2500 })
  const capabilities = useCompanionCapabilities()
  const [pairingOpen, setPairingOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const data = shareStatus.data
  const peers = data?.peers ?? 0
  const sharing = data?.sharing === true

  const startPairing = useCallback(async (): Promise<boolean> => {
    const current = shareStatus.data
    if (!current || current.sharing) {
      setPairingOpen(true)
      return true
    }
    setStarting(true)
    try {
      await metrora.startShare(current.always)
      shareStatus.refresh()
      setPairingOpen(true)
      return true
    } catch (error) {
      showToast(normalizeCliError(error).message, 'error')
      return false
    } finally {
      setStarting(false)
    }
  }, [shareStatus])

  const stopSharing = useCallback(async () => {
    setStarting(true)
    try {
      await metrora.stopShare()
      shareStatus.refresh()
    } catch (error) {
      showToast(normalizeCliError(error).message, 'error')
    } finally {
      setStarting(false)
    }
  }, [shareStatus])

  const capacityCapability = capabilityById(capabilities.data, 'home.capacity')

  return (
    <>
      <div className={motionClass('body companion-body', 'section-fade')}>
        <div className="companion-page">
          <header className="companion-head">
            <div className="companion-head-copy">
              <h1>Companion</h1>
              <p>Your Metrora control center, on Android.</p>
            </div>
            <span className="companion-secure-pill"><ShieldIcon />Local &amp; encrypted</span>
          </header>

          <section className="companion-stats" aria-label="Companion status" aria-live="polite">
            <div className="companion-stat">
              <span className="companion-stat-icon" aria-hidden="true"><DeviceIcon /></span>
              <p className="companion-stat-line">
                <strong data-testid="companion-paired-count">{peers}</strong>
                <span> paired devices</span>
              </p>
            </div>
            <div className="companion-stat">
              <span className="companion-stat-icon companion-stat-icon-wifi" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 10a12 12 0 0 1 16 0M7.5 13.5a7 7 0 0 1 9 0M10.8 16.8a2.6 2.6 0 0 1 2.4 0" /><circle cx="12" cy="19.4" r="1.3" /></svg></span>
              {!data && shareStatus.error ? (
                <p className="companion-stat-line"><span>Sharing </span><strong>Unavailable</strong></p>
              ) : (
                <p className="companion-stat-line"><span>Sharing </span><strong>{sharing ? 'On' : 'Off'}</strong></p>
              )}
            </div>
            <div className="companion-stat">
              <span className="companion-stat-icon companion-stat-icon-shield" aria-hidden="true"><ShieldIcon /></span>
              <div className="companion-stat-copy">
                <p className="companion-stat-line"><strong>Local network</strong></p>
                {!data && shareStatus.error ? (
                  <small>Unable to read local sharing state.</small>
                ) : data?.networkWarning ? (
                  <small className="companion-warning-text" role="status">{data.networkWarning}</small>
                ) : (
                  <small>No cloud relay. Direct and encrypted.</small>
                )}
              </div>
            </div>
          </section>

          <div className="companion-columns">
            <section className="companion-panel companion-panel-pair" aria-labelledby="companion-pair-title">
              <div className="companion-pair-copy">
                <h2 id="companion-pair-title">Connect your Android</h2>
                <p className="companion-panel-lede">Pair securely over your local network.</p>
                <ol className="companion-steps">
                  <li>
                    <span className="companion-step-num" aria-hidden="true">1</span>
                    <div><b>Start pairing on this computer</b><p>Click the button below to generate a connection QR code.</p></div>
                  </li>
                  <li>
                    <span className="companion-step-num" aria-hidden="true">2</span>
                    <div><b>Scan the QR code on your phone</b><p>Open Metrora Companion on your Android device and scan the code. Make sure both devices are on the same local network.</p></div>
                  </li>
                </ol>
                <div className="companion-pair-actions">
                  <button type="button" className="companion-btn companion-btn-primary" disabled={starting} data-testid="companion-start-pairing" onClick={() => void startPairing()}>
                    {sharing ? 'Show pairing code' : 'Start pairing'}
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
                  </button>
                  {sharing && (
                    <button type="button" className="companion-btn companion-btn-danger" disabled={starting} onClick={() => void stopSharing()}>Stop sharing</button>
                  )}
                </div>
                <p className="companion-pair-caption">{sharing ? 'Your QR code is live until you stop sharing.' : 'Your QR code appears when pairing starts.'}</p>
                {data?.networkWarning && <p className="companion-warning" role="status">{data.networkWarning}</p>}
              </div>
              <div className="companion-pair-art" aria-hidden="true"><PairPhoneArt /></div>
            </section>

            <section className="companion-panel companion-panel-devices" aria-labelledby="companion-devices-title">
              <div className="companion-devices-head">
                <h2 id="companion-devices-title">Paired devices</h2>
                <span className="companion-count-chip">{peers}</span>
              </div>
              <p className="companion-panel-lede">Devices paired with this Metrora instance.</p>
              <ul className="companion-device-list">
                {data?.peerList?.length ? data.peerList.map(device => (
                  <li className="companion-device-row" key={`${device.name}-${device.pairedAt}`}>
                    <span className="companion-device-icon" aria-hidden="true"><DeviceIcon /></span>
                    <div className="companion-device-copy">
                      <b>{device.name}</b>
                      <span>Paired {pairedDate(device.pairedAt)}</span>
                    </div>
                    <span className="companion-device-state"><i aria-hidden="true" />Paired</span>
                  </li>
                )) : (
                  <li className="companion-device-empty">
                    {data && !data.peerList && peers > 0 ? (
                      <><b>{peers} paired {peers === 1 ? 'device' : 'devices'}</b><span>Device names are unavailable in this status payload.</span></>
                    ) : (
                      <><b>No paired devices yet</b><span>Start pairing to add your Android device.</span></>
                    )}
                  </li>
                )}
              </ul>
            </section>
          </div>

          <section className="companion-features" aria-labelledby="companion-features-title">
            <h2 id="companion-features-title">On your Companion</h2>
            {capabilities.loading ? (
              <p className="companion-cap-note" role="status">Reading Companion capabilities…</p>
            ) : capabilities.error || !capabilities.data ? (
              <div className="companion-cap-note" role="alert">
                <p>Companion capabilities are unavailable.</p>
                <button type="button" className="companion-btn companion-btn-secondary" onClick={() => capabilities.retry()}>Retry</button>
              </div>
            ) : (
              <ul className="companion-feature-grid">
                {FEATURE_TILES.map(tile => {
                  const badge = tile.key === 'capacity'
                    ? (isAvailable(capacityCapability)
                      ? <span className="companion-badge companion-badge-available">Available</span>
                      : <span className="companion-badge">Unavailable</span>)
                    : null
                  return (
                    <li className="companion-feature" key={tile.key}>
                      <span className={`companion-feature-icon companion-feature-icon-${tile.key}`} aria-hidden="true"><FeatureIcon icon={tile.icon} /></span>
                      <div className="companion-feature-copy">
                        <b>{tile.name}</b>
                        <span>{tile.desc}</span>
                      </div>
                      {badge}
                    </li>
                  )
                })}
                <li className="companion-feature companion-feature-disabled" aria-disabled="true">
                  <span className="companion-feature-icon companion-feature-icon-workspace" aria-hidden="true"><FeatureIcon icon="workspace" /></span>
                  <div className="companion-feature-copy">
                    <b>Workspace</b>
                    <span>Not available on Android.</span>
                  </div>
                  <span className="companion-badge">Desktop only</span>
                </li>
              </ul>
            )}
          </section>

          <section className="companion-privacy" aria-labelledby="companion-privacy-title">
            <span className="companion-privacy-icon" aria-hidden="true"><ShieldIcon /></span>
            <div>
              <h2 id="companion-privacy-title">Local by design</h2>
              <p>Your desktop stays in control. Companion connects over your local network.</p>
            </div>
          </section>
        </div>
      </div>
      {pairingOpen && (
        <CompanionPairingDialog
          shareStatus={shareStatus}
          onClose={() => setPairingOpen(false)}
          onStart={startPairing}
        />
      )}
    </>
  )
}

export { capabilityById }
