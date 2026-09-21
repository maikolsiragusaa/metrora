import { useCallback, useEffect, useState } from 'react'

import companionHero from '../assets/companion/companion-hero.png'
import { ShareConnectSurface } from '../components/ShareConnectSurface'
import { usePolled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import { motionClass } from '../lib/motion'
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

export function Companion() {
  const shareStatus = usePolled<ShareStatus>(() => metrora.getShareStatus(), [], { intervalMs: 2500 })
  const capabilities = useCompanionCapabilities()
  const data = shareStatus.data
  const peers = data?.peers ?? 0

  const capacityCapability = capabilityById(capabilities.data, 'home.capacity')

  return (
    <>
      <div className="bar companion-bar">
        <div className="t">Companion</div>
        <span className="scope">Your local Android companion</span>
        <div className="sp" />
      </div>
      <div className={motionClass('body companion-body', 'section-fade')}>
        <div className="companion-page">
          <section className="companion-hero" aria-labelledby="companion-hero-title">
            <div className="companion-hero-copy">
              <span className="companion-kicker">Metrora Companion</span>
              <h1 id="companion-hero-title">Take Metrora <em>with you</em>.</h1>
              <p className="companion-hero-lede">
                Access key parts of your local control center from your Android device.
                Same data. Same privacy. No cloud required.
              </p>
            </div>
            <div className="companion-hero-art" aria-hidden="true">
              <img className="companion-hero-device" src={companionHero} alt="" />
            </div>
          </section>

          <section className="companion-status-cards" aria-label="Companion status" aria-live="polite">
            <div className="companion-status-card">
              <span className="companion-status-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></svg></span>
              <div><span className="companion-status-label">Paired devices</span>
                <strong className="companion-status-value" data-testid="companion-paired-count">{peers}</strong>
                <small>Devices paired with this Metrora instance.</small>
              </div>
            </div>
            <div className="companion-status-card companion-status-card-green">
              <span className="companion-status-icon companion-status-icon-green" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 10a12 12 0 0 1 16 0M7.5 13.5a7 7 0 0 1 9 0M10.8 16.8a2.6 2.6 0 0 1 2.4 0" /><circle cx="12" cy="19.4" r="1.3" /></svg></span>
              <div><span className="companion-status-label companion-status-label-green">Local sharing</span>
                {!data && shareStatus.error ? (
                  <>
                    <strong className="companion-status-value">Unavailable</strong>
                    <small>Unable to read local sharing state.</small>
                  </>
                ) : (
                  <>
                    <strong className="companion-status-value">{data?.sharing ? 'On' : 'Off'}</strong>
                    <small>{data?.sharing ? 'Accepting new device connections.' : 'Pairing service stopped'}</small>
                  </>
                )}
              </div>
            </div>
            <div className="companion-status-card companion-status-card-blue">
              <span className="companion-status-icon companion-status-icon-blue" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l8 3v5.5c0 4.4-2.4 7.6-8 9.5-5.6-1.9-8-5.1-8-9.5V6z" /></svg></span>
              <div><span className="companion-status-label">Connection</span>
                {!data && shareStatus.error ? (
                  <>
                    <strong className="companion-status-value">Unavailable</strong>
                    <small>Unable to read local sharing state.</small>
                  </>
                ) : data?.networkWarning ? (
                  <>
                    <strong className="companion-status-value">Local network</strong>
                    <small className="companion-warning-text" role="status">{data.networkWarning}</small>
                  </>
                ) : (
                  <>
                    <strong className="companion-status-value">Local network</strong>
                    <small>No cloud relay. Direct and encrypted.</small>
                  </>
                )}
              </div>
            </div>
          </section>

          <div className="companion-main">
            <section className="companion-panel" aria-labelledby="companion-pair-title">
              <div className="companion-panel-head">
                <span className="companion-panel-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></svg></span>
                <div>
                  <h2 id="companion-pair-title">Pair a device</h2>
                  <p>Open Metrora Companion on your Android device and scan the QR code. Make sure your phone and this computer are on the same local network.</p>
                </div>
              </div>
              <ShareConnectSurface shareStatus={shareStatus} companion />
            </section>

            <section className="companion-panel" aria-labelledby="companion-available-title">
              <div className="companion-panel-head">
                <span className="companion-panel-icon companion-panel-icon-grid" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg></span>
                <div>
                  <h2 id="companion-available-title">Available on your Companion</h2>
                  <p>Your Android companion can access the following areas:</p>
                </div>
              </div>
              {capabilities.loading ? (
                <p className="companion-cap-note" role="status">Reading Companion capabilities…</p>
              ) : capabilities.error || !capabilities.data ? (
                <div className="companion-cap-note" role="alert">
                  <p>Companion capabilities are unavailable.</p>
                  <button type="button" className="companion-btn companion-btn-secondary" onClick={() => capabilities.retry()}>Retry</button>
                </div>
              ) : (
                <ul className="companion-cap-list">
                  <li className="companion-cap-row">
                    <span className="companion-cap-icon companion-cap-icon-home" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7" /><path d="M6 9.5V20h12V9.5" /></svg></span>
                    <b className="companion-cap-name">Home / Usage</b>
                    <span className="companion-cap-desc">Monitor your usage and activity overview.</span>
                  </li>
                  <li className="companion-cap-row">
                    <span className="companion-cap-icon companion-cap-icon-activity" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg></span>
                    <b className="companion-cap-name">Activity</b>
                    <span className="companion-cap-desc">View activity sessions and pull requests.</span>
                  </li>
                  <li className="companion-cap-row">
                    <span className="companion-cap-icon companion-cap-icon-models" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2.5l8 4.5v9l-8 4.5-8-4.5v-9z" /><path d="M12 11.5l8-4.5M12 11.5v9M12 11.5L4 7" /></svg></span>
                    <b className="companion-cap-name">Models</b>
                    <span className="companion-cap-desc">Inspect model usage and economics.</span>
                  </li>
                  <li className="companion-cap-row">
                    <span className="companion-cap-icon companion-cap-icon-projects" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 7.5h6l1.8 2h9.2v8.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg></span>
                    <b className="companion-cap-name">Projects</b>
                    <span className="companion-cap-desc">Browse projects and change scope.</span>
                  </li>
                  <li className="companion-cap-row">
                    <span className="companion-cap-icon companion-cap-icon-spend" aria-hidden="true"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="8" ry="2.8" /><path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6" /><path d="M4 11.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6" /></svg></span>
                    <b className="companion-cap-name">Spend</b>
                    <span className="companion-cap-desc">Monitor spend and costs.</span>
                  </li>
                  <li className="companion-cap-row">
                    <span className="companion-cap-icon companion-cap-icon-capacity" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 20v-7M10 20V6M15 20v-10M20 20V9" /></svg></span>
                    <b className="companion-cap-name">Capacity</b>
                    <span className="companion-cap-desc">View capacity and availability.</span>
                    {isAvailable(capacityCapability) ? (
                      <span className="companion-badge companion-badge-available">Available</span>
                    ) : (
                      <span className="companion-badge">Unavailable</span>
                    )}
                  </li>
                  <li className="companion-cap-row companion-cap-row-disabled" aria-disabled="true">
                    <span className="companion-cap-icon companion-cap-icon-workspace" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" /><circle cx="17" cy="9.5" r="2.6" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M14.5 15.2c2.3.2 4 1.5 4.5 3.8" /></svg></span>
                    <b className="companion-cap-name">Workspace</b>
                    <span className="companion-cap-desc">Not available on Android.</span>
                    <span className="companion-badge">Desktop only</span>
                  </li>
                </ul>
              )}
            </section>
          </div>

          <section className="companion-trust" aria-labelledby="companion-trust-title">
            <div className="companion-trust-head">
              <span className="companion-trust-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg></span>
              <div>
                <h2 id="companion-trust-title">Local by design</h2>
                <p>Your data stays under your control. Companion connects to your Metrora instance over an encrypted local connection.</p>
              </div>
            </div>
            <div className="companion-trust-grid">
              <div>
                <b><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="1.8" /><path d="M8 20h8M12 17v3" /></svg>Desktop stays authoritative</b>
                <p>All sensitive operations, credentials and provider access remain on your machine.</p>
              </div>
              <div>
                <b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v5.5c0 4.4-2.4 7.6-8 9.5-5.6-1.9-8-5.1-8-9.5V6z" /></svg>Secure local pairing</b>
                <p>Devices pair using end-to-end encryption and verification.</p>
              </div>
              <div>
                <b><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></svg>Bounded mobile data</b>
                <p>Your Android device receives only the data needed for the Companion experience.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

export { capabilityById }
