import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
import { BrandLockup, Feature, Icon, ONBOARDING_STEPS, OnboardingStepper, PrimaryButton, type IconName, type StepId } from './onboarding/OnboardingPrimitives'

const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=eu.metrora.app'

export type OnboardingProps = {
  overview: Polled<MenubarPayload>
  /** Lifetime inventory read; kept separate from the user's Home scope. */
  inventory?: Polled<MenubarPayload>
  ready: boolean
  onDone: () => void
  onOpenSettings?: () => void
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

type DiscoverDensity = 'empty' | 'sparse' | 'standard' | 'many'

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

function getDiscoverDensity(count: number): DiscoverDensity {
  if (count === 0) return 'empty'
  if (count <= 2) return 'sparse'
  if (count <= 6) return 'standard'
  return 'many'
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
  const density = getDiscoverDensity(entries.length)
  const refreshing = overview.loading && overview.data !== null
  const unavailable = overview.error !== null && overview.data === null
  const subtitle = unavailable
    ? 'Metrora could not read the local source index yet. You can continue and retry from the app.'
    : overview.data === null
      ? 'Metrora is scanning your device and connecting local sources to build your AI control center.'
      : 'Metrora found these AI tools across your local history.'

  return (
    <section className={`onboarding-card onboarding-card-discover onboarding-card-discover-${density}`} aria-labelledby="onboarding-title">
      <BrandLockup compact />
      <header className="onboarding-heading">
        <h1 id="onboarding-title">We found your AI tools</h1>
        <p>{subtitle}</p>
      </header>

      {overview.error && <div className="onboarding-inline-status onboarding-inline-status-error" role="status"><Icon name="info" size={18} /> <span>{overview.data ? 'The last local snapshot is available; some sources may need another scan.' : 'Local source discovery is unavailable right now.'}</span></div>}

      <div className={[
        'onboarding-source-grid',
        entries.length > 6 ? 'onboarding-source-grid-many' : '',
        entries.length === 1 ? 'onboarding-source-grid-single' : '',
      ].filter(Boolean).join(' ')} aria-live="polite">
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

function OpenCodeBrand({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={['onboarding-opencode-brand', className].filter(Boolean).join(' ')} aria-label="OpenCode">
      <ProviderLogo provider="opencode" size={size} />
      <span>opencode</span>
    </span>
  )
}

function CodeWorkspacePreview() {
  return (
    <div className="onboarding-code-workspace" role="img" aria-label="OpenCode workspace preview">
      <aside className="onboarding-code-sidebar">
        <div className="onboarding-code-sidebar-brand"><OpenCodeBrand size={16} /></div>
        <div className="onboarding-code-nav-item active"><Icon name="folder" size={15} /><span>Workspace</span></div>
        <div className="onboarding-code-nav-item"><Icon name="grid" size={15} /><span>Sessions</span></div>
        <div className="onboarding-code-nav-item"><Icon name="person" size={15} /><span>Agents</span></div>
        <div className="onboarding-code-nav-item"><Icon name="database" size={15} /><span>Files</span></div>
        <div className="onboarding-code-nav-item"><Icon name="server" size={15} /><span>Tools</span></div>
        <div className="onboarding-code-nav-item"><Icon name="laptop" size={15} /><span>Terminal</span></div>
      </aside>
      <div className="onboarding-code-workspace-main">
        <div className="onboarding-code-tabbar">
          <span className="onboarding-code-tab">workspace <i>×</i></span>
          <span className="onboarding-code-window-actions"><i /><i /><i /></span>
        </div>
        <div className="onboarding-code-editor">
          <div><span aria-hidden="true" /><code><em># a focused workspace</em></code></div>
          <div><span aria-hidden="true" /><code><b>function</b> <strong>run</strong>() {'{'}</code></div>
          <div><span aria-hidden="true" /><code>&nbsp;&nbsp;<b>return</b> <mark>ready</mark></code></div>
          <div><span aria-hidden="true" /><code>{'}'}</code></div>
        </div>
        <div className="onboarding-code-terminal"><span>local workspace</span><b>&gt;</b><i /></div>
      </div>
    </div>
  )
}

function CodeBenefit({ icon, title, body }: { icon: IconName | 'metrora'; title: string; body: string }) {
  return (
    <div className="onboarding-code-benefit">
      <span className="onboarding-code-benefit-icon">
        {icon === 'metrora' ? <MetroraMark size={30} /> : <Icon name={icon} size={30} />}
      </span>
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  )
}

function CodeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="onboarding-card onboarding-card-code" aria-labelledby="onboarding-title">
      <div className="onboarding-code-inner">
        <span className="onboarding-code-kicker">CODE</span>
        <header className="onboarding-heading onboarding-heading-code">
          <h1 id="onboarding-title">Code with freedom.</h1>
          <p className="onboarding-code-powered">Powered by <OpenCodeBrand size={25} /></p>
          <p className="onboarding-code-intro">Bring your models, your tools, your ideas.<br />All in one place.</p>
        </header>

        <CodeWorkspacePreview />

        <div className="onboarding-code-benefits">
          <CodeBenefit icon="server" title="Bring your models" body="Use supported providers and local runtimes." />
          <CodeBenefit icon="code" title="Real coding workspace" body="Files, shell, Git, tools, and sessions." />
          <CodeBenefit icon="metrora" title="Metrora context included" body="Use Metrora's factual tools alongside execution." />
        </div>

        <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
        <p className="onboarding-code-footer">You can always open Code later from the main app.</p>
      </div>
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

type ReadyFacts = { quota: QuotaProvider[] | null; loading: boolean }

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
      <span className={`onboarding-summary-copy ${value.length > 8 ? 'onboarding-summary-copy-long' : ''}`}><strong>{value}</strong><span>{label}</span><small>{detail}</small></span>
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
        <SummaryCard icon="grid" tone="tone-blue" value={countLabel(data?.current.sessions ?? null)} label="Sessions found" detail={data?.current.sessions ? 'Past work in the lifetime inventory' : 'No sessions in the lifetime inventory'} />
        <SummaryCard icon="grid" tone="tone-purple" value={countLabel(modelCount(data))} label="Models observed" detail={modelCount(data) === null ? 'Not available in this snapshot' : 'From the canonical model accounting'} />
        <SummaryCard icon="folder" tone="tone-green" value={countLabel(sourceProjectCount(data))} label="Projects detected" detail={sourceProjectCount(data) === null ? 'Project catalog unavailable' : 'Local source projects'} />
        <SummaryCard icon="database" tone="tone-yellow" value={capacityValue} label="Capacity signals" detail={quota ? 'Provider-reported evidence available' : quota === null ? 'Checking provider authority' : 'No provider-reported quota available'} />
      </div>

      <div className="onboarding-benefit-row">
        <Feature icon="shield" tone="tone-blue" title="Local-first" body="Your data stays on your device." />
        <Feature icon="person" tone="tone-purple" title="No account required" body="Privacy by design. Just you." />
        <Feature icon="code" tone="tone-green" title="Code workspace" body="Open Code anytime from the main app." />
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
export function Onboarding({ overview, inventory: inventoryProp, ready, onDone, onOpenSettings }: OnboardingProps) {
  const [step, setStep] = useState<StepId>('welcome')
  const [companionConnected, setCompanionConnected] = useState(false)
  const [facts, setFacts] = useState<ReadyFacts>({ quota: null, loading: false })
  const cardRef = useRef<HTMLElement | null>(null)
  const inventory = inventoryProp ?? overview

  const goToDiscover = useCallback(() => {
    setStep('discover')
  }, [])
  const goToCode = useCallback(() => setStep('code'), [])
  const goToCompanion = useCallback(() => setStep('companion'), [])
  const goToReady = useCallback(() => setStep('ready'), [])
  const goToStep = useCallback((nextStep: StepId) => setStep(nextStep), [])

  useEffect(() => {
    if (step !== 'ready') return
    let active = true
    setFacts({ quota: null, loading: true })
    void metrora.getQuota().then(quota => {
      if (!active) return
      setFacts({
        quota,
        loading: false,
      })
    }).catch(() => {
      if (!active) return
      setFacts({ quota: [], loading: false })
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
      else if (step === 'discover' && ready) goToCode()
      else if (step === 'code') goToCompanion()
      else if (step === 'companion') goToReady()
    }
  }

  if (typeof document === 'undefined') return null

  const card = step === 'welcome' ? (
    <WelcomeStep onContinue={goToDiscover} />
  ) : step === 'discover' ? (
    <DiscoverStep overview={inventory} ready={ready} onContinue={goToCode} onSkip={goToCode} />
  ) : step === 'code' ? (
    <CodeStep onContinue={goToCompanion} />
  ) : step === 'companion' ? (
    <CompanionStep onContinue={goToReady} onSkip={goToReady} onConnectionChange={setCompanionConnected} />
  ) : (
    <ReadyStep overview={inventory} facts={facts} companionConnected={companionConnected} onDone={onDone} onOpenSettings={onOpenSettings} />
  )
  const frameClass = [
    'onboarding-card-frame',
    `onboarding-card-frame-${step}`,
    step === 'discover' ? `onboarding-card-frame-discover-${getDiscoverDensity(discoveryEntries(inventory.data).length)}` : '',
  ].filter(Boolean).join(' ')

  return createPortal(
    <div className={motionClass('onboarding-surface', 'onboarding-surface-in')} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" onKeyDown={onKeyDown}>
      <div className="onboarding-content">
        <div className="onboarding-scene-brand" aria-label="Metrora">
          <MetroraMark size={31} />
          <span>Metrora</span>
        </div>
        <div className="onboarding-scene-tagline" aria-hidden="true">
          <span>Your AI landscape.</span>
          <span>Under control.</span>
          <i />
        </div>
        <OnboardingStepper current={step} onSelect={goToStep} />
        <div
          className={motionClass(frameClass, 'onboarding-card-in')}
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
