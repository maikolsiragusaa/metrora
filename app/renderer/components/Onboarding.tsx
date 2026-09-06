import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import companionPhone from '../assets/onboarding/companion-phone.png'
import { usePolled, type Polled } from '../hooks/usePolled'
import { normalizeCliError, metrora } from '../lib/ipc'
import { motionClass } from '../lib/motion'
import { showToast } from '../lib/toast'
import type { MenubarPayload, QuotaProvider, ShareStatus } from '../lib/types'
import { MetroraMark } from './MetroraMark'
import { ProviderLogo } from './ProviderLogo'
import { ShareConnectSurface } from './ShareConnectSurface'

const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=eu.metrora.app'

type StepId = 'welcome' | 'discover' | 'companion' | 'ready'

const ONBOARDING_STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'discover', label: 'Discover' },
  { id: 'companion', label: 'Companion' },
  { id: 'ready', label: 'Ready' },
]

type IconName =
  | 'arrow-right'
  | 'check'
  | 'code'
  | 'folder'
  | 'grid'
  | 'info'
  | 'link'
  | 'lock'
  | 'laptop'
  | 'person'
  | 'phone'
  | 'plus'
  | 'server'
  | 'shield'
  | 'database'

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'arrow-right':
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'check':
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>
    case 'code':
      return <svg {...common}><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" /></svg>
    case 'folder':
      return <svg {...common}><path d="M3.5 7.5h6l1.8 2H20a1 1 0 0 1 1 1v6.8a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 17.3V8a.5.5 0 0 1 .5-.5Z" /><path d="M3 10h18" /></svg>
    case 'grid':
      return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>
    case 'info':
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 10.5v5M12 7.5h.01" /></svg>
    case 'link':
      return <svg {...common}><path d="M10 13.8 8.7 15a3.1 3.1 0 1 1-4.4-4.4l2.8-2.8a3.1 3.1 0 0 1 4.4 0M14 10.2l1.3-1.2a3.1 3.1 0 0 1 4.4 4.4l-2.8 2.8a3.1 3.1 0 0 1-4.4 0M8.5 12h7" /></svg>
    case 'lock':
      return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
    case 'laptop':
      return <svg {...common}><rect x="4" y="4.5" width="16" height="11" rx="1.5" /><path d="M2.5 19.5h19" /></svg>
    case 'person':
      return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" /></svg>
    case 'phone':
      return <svg {...common}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M10.5 6h3M11 18h2" /></svg>
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
    case 'server':
      return <svg {...common}><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /><path d="M8 7h.01M8 17h.01" /></svg>
    case 'shield':
      return <svg {...common}><path d="M12 3.5 19 6v5.5c0 4.2-2.8 7.5-7 9-4.2-1.5-7-4.8-7-9V6l7-2.5Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg>
    case 'database':
      return <svg {...common}><ellipse cx="12" cy="6.5" rx="7" ry="3" /><path d="M5 6.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6M5 12.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></svg>
  }
}

export type OnboardingProps = {
  overview: Polled<MenubarPayload>
  ready: boolean
  onDone: () => void
  onOpenSettings?: () => void
}

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'onboarding-brand onboarding-brand-compact' : 'onboarding-brand'}>
      <span className="onboarding-brand-mark"><MetroraMark size={compact ? 55 : 72} /></span>
      <span className="onboarding-brand-name">Metrora</span>
    </div>
  )
}

function OnboardingStepper({ current }: { current: StepId }) {
  const currentIndex = ONBOARDING_STEPS.findIndex(step => step.id === current)
  return (
    <ol className="onboarding-stepper" aria-label="Onboarding progress">
      <li className="onboarding-step onboarding-step-done">
        <span className="onboarding-step-marker"><Icon name="check" size={15} /></span>
        <span className="onboarding-step-label">Splash</span>
      </li>
      {ONBOARDING_STEPS.map((step, index) => {
        const completed = index < currentIndex
        const active = step.id === current
        return (
          <li
            className={['onboarding-step', completed ? 'onboarding-step-done' : '', active ? 'onboarding-step-active' : ''].filter(Boolean).join(' ')}
            key={step.id}
            aria-current={active ? 'step' : undefined}
          >
            <span className="onboarding-step-marker">{completed ? <Icon name="check" size={15} /> : <span />}</span>
            <span className="onboarding-step-label">{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Feature({ icon, title, body, tone }: { icon: IconName; title: string; body: string; tone: string }) {
  return (
    <div className="onboarding-feature">
      <span className={`onboarding-feature-icon ${tone}`}><Icon name={icon} size={27} /></span>
      <span className="onboarding-feature-copy">
        <strong>{title}</strong>
        <span>{body}</span>
      </span>
    </div>
  )
}

function PrimaryButton({ children, onClick, disabled = false, icon = 'arrow-right', className = '' }: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  icon?: IconName
  className?: string
}) {
  return (
    <button
      type="button"
      className={['onboarding-primary', className].filter(Boolean).join(' ')}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={23} />
      <span>{children}</span>
    </button>
  )
}

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="onboarding-card onboarding-card-welcome" aria-labelledby="onboarding-title">
      <BrandLockup />
      <header className="onboarding-heading onboarding-heading-welcome">
        <h1 id="onboarding-title">Welcome to Metrora</h1>
        <p>Your AI Control Center</p>
      </header>

      <div className="onboarding-feature-row onboarding-feature-row-welcome">
        <Feature icon="laptop" tone="tone-violet" title="Local-first" body="Runs on your device" />
        <Feature icon="lock" tone="tone-purple" title="No account required" body="Get started right away" />
        <Feature icon="shield" tone="tone-blue" title="Your data stays here" body="Private. Secure. Yours." />
      </div>

      <PrimaryButton onClick={onContinue} icon="arrow-right">Continue locally</PrimaryButton>

      <div className="onboarding-account-actions" aria-label="Account actions">
        <button type="button" className="onboarding-account-action" disabled title="Sign in is coming soon">
          <Icon name="person" size={22} />
          <span>Sign in</span>
          <span className="onboarding-coming-soon">Coming soon</span>
        </button>
        <button type="button" className="onboarding-account-action" disabled title="Create account is coming soon">
          <Icon name="plus" size={22} />
          <span>Create account</span>
          <span className="onboarding-coming-soon">Coming soon</span>
        </button>
      </div>

      <p className="onboarding-footnote"><Icon name="lock" size={15} /> <span>No account required</span><i>•</i><span>Your data stays on this device</span></p>
    </section>
  )
}

type DiscoveryEntry = { id: string; label: string }

function displayProviderLabel(id: string): string {
  return id.split(/[-\s]+/u).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function discoveryEntries(data: MenubarPayload | null): DiscoveryEntry[] {
  if (!data) return []
  if (data.current.providerDetails) {
    return data.current.providerDetails.map(item => ({ id: item.id, label: item.label }))
  }
  return Object.keys(data.current.providers).map(id => ({ id, label: displayProviderLabel(id) }))
}

function SourceCard({ entry, status }: { entry: DiscoveryEntry; status: 'detected' | 'refreshing' | 'available' }) {
  const icon = status === 'refreshing' ? <span className="onboarding-spinner" /> : <Icon name="check" size={15} />
  const text = status === 'refreshing' ? 'Refreshing…' : status === 'available' ? 'Snapshot available' : 'Detected'
  return (
    <article className="onboarding-source-card">
      <span className="onboarding-source-logo"><ProviderLogo provider={entry.id} size={34} /></span>
      <span className="onboarding-source-copy">
        <strong>{entry.label}</strong>
        <span className={`onboarding-source-state ${status}`}><i>{icon}</i>{text}</span>
        <small>Local source</small>
      </span>
      <span className={`onboarding-source-status ${status}`} aria-label={text}>{icon}</span>
    </article>
  )
}

function DiscoverStep({ overview, ready, onContinue, onSkip }: {
  overview: Polled<MenubarPayload>
  ready: boolean
  onContinue: () => void
  onSkip: () => void
}) {
  const entries = useMemo(() => discoveryEntries(overview.data), [overview.data])
  const refreshing = overview.loading && overview.data !== null
  const unavailable = overview.error !== null && overview.data === null
  const subtitle = unavailable
    ? 'Metrora could not read the local source index yet. You can continue and retry from the app.'
    : overview.data === null
      ? 'Metrora is scanning your device and connecting local sources to build your AI control center.'
      : 'Metrora found the local sources reported by its canonical usage snapshot.'

  return (
    <section className="onboarding-card onboarding-card-discover" aria-labelledby="onboarding-title">
      <BrandLockup compact />
      <header className="onboarding-heading">
        <h1 id="onboarding-title">We found your AI tools</h1>
        <p>{subtitle}</p>
      </header>

      {overview.error && <div className="onboarding-inline-status onboarding-inline-status-error" role="status"><Icon name="info" size={18} /> <span>{overview.data ? 'The last local snapshot is available; some sources may need another scan.' : 'Local source discovery is unavailable right now.'}</span></div>}

      <div className={`onboarding-source-grid ${entries.length > 6 ? 'onboarding-source-grid-many' : ''}`} aria-live="polite">
        {entries.length > 0 ? entries.map(entry => (
          <SourceCard key={entry.id} entry={entry} status={refreshing ? 'refreshing' : overview.error ? 'available' : 'detected'} />
        )) : (
          <div className="onboarding-source-empty">
            <Icon name={unavailable ? 'info' : 'server'} size={27} />
            <strong>{unavailable ? 'No source details available' : overview.data ? 'No local sources detected' : 'Scanning local sources…'}</strong>
            <span>{unavailable ? 'Metrora will keep this state truthful until the local authority responds.' : overview.data ? 'The current snapshot reports no configured AI providers.' : 'Provider details will appear when the scan completes.'}</span>
          </div>
        )}
      </div>

      <p className="onboarding-privacy-note"><Icon name="lock" size={17} /> <span>Discovery stays local on this device. Your data never leaves your machine.</span></p>

      <PrimaryButton onClick={onContinue} disabled={!ready}>Continue</PrimaryButton>
      <button type="button" className="onboarding-text-button" onClick={onSkip}>Skip for now</button>
    </section>
  )
}

function GooglePlayButton() {
  const openStore = () => {
    void metrora.openExternal(GOOGLE_PLAY_URL).catch(error => showToast(normalizeCliError(error).message, 'error'))
  }
  return (
    <button type="button" className="onboarding-google-play" onClick={openStore}>
      <span className="onboarding-google-play-mark" aria-hidden>▶</span>
      <span><small>GET IT ON</small><strong>Google Play</strong></span>
    </button>
  )
}

function CompanionStep({ onContinue, onSkip, onConnectionChange }: {
  onContinue: () => void
  onSkip: () => void
  onConnectionChange: (connected: boolean) => void
}) {
  const shareStatus = usePolled<ShareStatus>(() => metrora.getShareStatus(), [], { intervalMs: 2500 })
  const [busy, setBusy] = useState(false)
  const [startedStatus, setStartedStatus] = useState<ShareStatus | null>(null)
  const data = startedStatus ?? shareStatus.data
  const displayedShareStatus: Polled<ShareStatus> = { ...shareStatus, data }

  useEffect(() => {
    if (shareStatus.data) setStartedStatus(null)
  }, [shareStatus.data])

  useEffect(() => {
    onConnectionChange((data?.peers ?? 0) > 0)
  }, [data?.peers, onConnectionChange])

  const pairNow = async () => {
    if (!data || busy) return
    if (data.sharing) {
      onContinue()
      return
    }
    setBusy(true)
    try {
      const next = await metrora.startShare(data.always)
      setStartedStatus(next)
      onConnectionChange(next.peers > 0)
      shareStatus.refresh()
    } catch (error) {
      showToast(normalizeCliError(error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const pairingStarted = Boolean(data?.sharing)

  return (
    <section className="onboarding-card onboarding-card-companion" aria-labelledby="onboarding-title">
      <div className="onboarding-companion-layout">
        <div className="onboarding-phone-column">
          <img className="onboarding-phone" src={companionPhone} alt="" aria-hidden="true" />
        </div>
        <div className="onboarding-companion-content">
          <BrandLockup compact />
          <header className="onboarding-heading onboarding-heading-companion">
            <h1 id="onboarding-title">Take Metrora with you</h1>
            <p>Pair an Android device to monitor your workflows, get updates, and stay in control — wherever you are.</p>
          </header>

          <div className="onboarding-pairing-panel">
            <ShareConnectSurface shareStatus={displayedShareStatus} onboarding />
            <GooglePlayButton />
          </div>

          <div className="onboarding-feature-row onboarding-feature-row-companion">
            <Feature icon="shield" tone="tone-blue" title="Secure local pairing" body="Your data stays on your devices." />
            <Feature icon="link" tone="tone-purple" title="Scan QR or enter code" body="Quick and easy setup." />
            <Feature icon="phone" tone="tone-violet" title="Companion stays optional" body="Connect whenever you are ready." />
          </div>

          <PrimaryButton onClick={() => void pairNow()} disabled={!data || busy} icon={pairingStarted ? 'arrow-right' : 'link'}>
            {busy ? 'Starting…' : pairingStarted ? 'Continue' : 'Pair now'}
          </PrimaryButton>
          <button type="button" className="onboarding-text-button" onClick={onSkip}>Skip for now</button>
        </div>
      </div>
    </section>
  )
}

type ReadyFacts = { quota: QuotaProvider[] | null; cliReady: boolean | null; loading: boolean }

function countLabel(value: number | null): string {
  return value === null ? 'Unavailable' : value.toLocaleString('en-US')
}

function sourceProjectCount(data: MenubarPayload | null): number | null {
  return data?.projectScope ? data.projectScope.sourceProjects.length : null
}

function modelCount(data: MenubarPayload | null): number | null {
  const current = data?.current
  if (!current) return null
  if (current.modelAccounting) return current.modelAccounting.rows.length
  if (current.modelPresentation && Number.isSafeInteger(current.modelPresentation.accountingRowCount)) return current.modelPresentation.accountingRowCount
  return null
}

function hasQuotaEvidence(quota: QuotaProvider[] | null): boolean | null {
  if (quota === null) return null
  return quota.some(provider => provider.availability === 'available' && (
    provider.windows.length > 0 || provider.credits !== null || provider.planLabel !== null
  ))
}

function SummaryCard({ icon, tone, value, label, detail }: { icon: IconName; tone: string; value: string; label: string; detail: string }) {
  return (
    <article className="onboarding-summary-card">
      <span className={`onboarding-summary-icon ${tone}`}><Icon name={icon} size={28} /></span>
      <span className="onboarding-summary-copy"><strong>{value}</strong><span>{label}</span><small>{detail}</small></span>
    </article>
  )
}

function ReadyStep({ overview, facts, companionConnected, onDone, onOpenSettings }: {
  overview: Polled<MenubarPayload>
  facts: ReadyFacts
  companionConnected: boolean
  onDone: () => void
  onOpenSettings?: () => void
}) {
  const data = overview.data
  const unavailable = data === null
  const quota = hasQuotaEvidence(facts.quota)
  const capacityValue = quota === null ? 'Checking…' : quota ? 'Available' : 'Unavailable'
  const cliValue = facts.cliReady === null ? 'Checking…' : facts.cliReady ? 'Code ready' : 'Unavailable'

  return (
    <section className="onboarding-card onboarding-card-ready" aria-labelledby="onboarding-title">
      <BrandLockup compact />
      <header className="onboarding-heading onboarding-heading-ready">
        <h1 id="onboarding-title">You’re ready</h1>
        <p>{unavailable
          ? 'Metrora is ready to open, but the local usage snapshot is unavailable. You can retry from the app.'
          : 'Metrora scanned your device and prepared your local AI control center. Everything available is shown below.'}</p>
      </header>

      <div className="onboarding-summary-grid">
        <SummaryCard icon="phone" tone="tone-blue" value={countLabel(data?.current.sessions ?? null)} label="Sessions found" detail={data?.current.sessions ? 'Past work and conversations' : 'No sessions in the selected scope'} />
        <SummaryCard icon="grid" tone="tone-purple" value={countLabel(modelCount(data))} label="Models observed" detail={modelCount(data) === null ? 'Not available in this snapshot' : 'From the canonical model accounting'} />
        <SummaryCard icon="folder" tone="tone-green" value={countLabel(sourceProjectCount(data))} label="Projects detected" detail={sourceProjectCount(data) === null ? 'Project catalog unavailable' : 'Local source projects'} />
        <SummaryCard icon="database" tone="tone-yellow" value={capacityValue} label="Capacity signals" detail={quota ? 'Provider-reported evidence available' : quota === null ? 'Checking provider authority' : 'No provider-reported quota available'} />
      </div>

      <div className="onboarding-benefit-row">
        <Feature icon="shield" tone="tone-blue" title="Local-first" body="Your data stays on your device." />
        <Feature icon="person" tone="tone-purple" title="No account required" body="Privacy by design. Just you." />
        <Feature icon="code" tone="tone-green" title={cliValue} body={facts.cliReady ? 'Start building right away.' : 'CLI status is unavailable.'} />
        <Feature icon="link" tone="tone-violet" title={companionConnected ? 'Companion connected' : 'Companion later'} body={companionConnected ? 'A device is connected locally.' : 'Connect a device anytime.'} />
      </div>

      <PrimaryButton onClick={onDone}>Open Metrora</PrimaryButton>
      {onOpenSettings && <button type="button" className="onboarding-text-button" onClick={onOpenSettings}>Review settings</button>}
      <p className="onboarding-closing-line"><span />See the whole picture.<span /></p>
    </section>
  )
}

/**
 * First-run entry surface. It intentionally owns only the local onboarding
 * presentation; completion is persisted by App through onboardingState.ts.
 */
export function Onboarding({ overview, ready, onDone, onOpenSettings }: OnboardingProps) {
  const [step, setStep] = useState<StepId>('welcome')
  const [companionConnected, setCompanionConnected] = useState(false)
  const [facts, setFacts] = useState<ReadyFacts>({ quota: null, cliReady: null, loading: false })
  const cardRef = useRef<HTMLElement | null>(null)

  const goToDiscover = useCallback(() => {
    setStep('discover')
    overview.refreshFresh()
  }, [overview.refreshFresh])
  const goToCompanion = useCallback(() => setStep('companion'), [])
  const goToReady = useCallback(() => setStep('ready'), [])

  useEffect(() => {
    if (step !== 'ready') return
    let active = true
    setFacts({ quota: null, cliReady: null, loading: true })
    void Promise.allSettled([metrora.getQuota(), metrora.cliStatus()]).then(([quotaResult, cliResult]) => {
      if (!active) return
      setFacts({
        quota: quotaResult.status === 'fulfilled' ? quotaResult.value : [],
        cliReady: cliResult.status === 'fulfilled' ? cliResult.value.found : false,
        loading: false,
      })
    })
    return () => { active = false }
  }, [step])

  useEffect(() => {
    cardRef.current?.focus()
  }, [step])

  const stepIndex = ONBOARDING_STEPS.findIndex(item => item.id === step)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    if (event.key === 'ArrowLeft' && stepIndex > 0) {
      event.preventDefault()
      setStep(ONBOARDING_STEPS[stepIndex - 1]!.id)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      if (step === 'welcome') goToDiscover()
      else if (step === 'discover' && ready) goToCompanion()
      else if (step === 'companion') goToReady()
    }
  }

  if (typeof document === 'undefined') return null

  const card = step === 'welcome' ? (
    <WelcomeStep onContinue={goToDiscover} />
  ) : step === 'discover' ? (
    <DiscoverStep overview={overview} ready={ready} onContinue={goToCompanion} onSkip={goToReady} />
  ) : step === 'companion' ? (
    <CompanionStep onContinue={goToReady} onSkip={goToReady} onConnectionChange={setCompanionConnected} />
  ) : (
    <ReadyStep overview={overview} facts={facts} companionConnected={companionConnected} onDone={onDone} onOpenSettings={onOpenSettings} />
  )

  return createPortal(
    <div className={motionClass('onboarding-surface', 'onboarding-surface-in')} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" onKeyDown={onKeyDown}>
      <div className="onboarding-content">
        <OnboardingStepper current={step} />
        <div
          className={motionClass(`onboarding-card-frame onboarding-card-frame-${step}`, 'onboarding-card-in')}
          key={step}
          ref={node => { cardRef.current = node }}
          tabIndex={-1}
        >
          {card}
        </div>
      </div>
    </div>,
    document.body,
  )
}
