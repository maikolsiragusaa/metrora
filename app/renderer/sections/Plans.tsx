import { useMemo, useRef, useState } from 'react'

import { ConnectAffordance } from '../components/ConnectAffordance'
import { Panel } from '../components/Panel'
import { ProviderLogo } from '../components/ProviderLogo'
import { SectionSkeleton } from '../components/Skeleton'
import type { Section } from '../components/Sidebar'
import { StaleBanner } from '../components/StaleBanner'
import { usePolled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import { motionClass } from '../lib/motion'
import { quotaProviderName, quotaProviderOwner, quotaSourceLabel } from '../lib/quota-providers'
import type { Period, QuotaProvider, QuotaWindow, StatusJson } from '../lib/types'
import { BudgetPlansSection } from './BudgetPlans'
import type { SettingsPane } from './Settings'

/** Honest copy for a 429 backoff window (the upstream quota endpoint rate
 *  limited us), replacing the generic "waiting" note. */
export function rateLimitedNote(provider: QuotaProvider['provider']): string {
  return `${quotaProviderOwner(provider)} rate limited the quota endpoint, retrying in a few minutes`
}

function isRateLimited(quota: QuotaProvider): boolean {
  return quota.rateLimit.state === 'backoff'
}

/** A provider counts as quota-bearing when the source reported windows,
 *  a credit balance, or a plan label — the same facts the inspector shows. */
function hasQuotaFacts(quota: QuotaProvider): boolean {
  return quota.windows.length > 0
    || quota.credits !== null
    || (typeof quota.planLabel === 'string' && quota.planLabel.trim().length > 0)
}

/**
 * ONE canonical Capacity presence mapping for a provider snapshot.
 *
 * Summary counts, the provider-list badge and the inspector badge all derive
 * from this function, so the three surfaces can never disagree about the same
 * provider again. It reads only the canonical contract fields (connection,
 * freshness, availability evidence) — never a parallel interpretation:
 *
 * - fresh factual quota evidence → connected;
 * - valid stale last-good evidence (retained facts) → stale;
 * - collection actually in progress → loading;
 * - explicit factual zero → still connected/stale by its freshness (zero is
 *   evidence, never unavailable);
 * - anything without evidence (including a failed collection with no
 *   retained facts) → unavailable. "Waiting" is reserved for genuinely
 *   pending collection; a failed read with nothing retained is unavailable.
 */
type CapacityPresence = 'connected' | 'stale' | 'loading' | 'unavailable'

function capacityPresence(quota: QuotaProvider): {
  presence: CapacityPresence
  label: string
  tone: 'fresh' | 'stale' | 'warn' | 'bad' | 'muted'
} {
  if (quota.connection === 'loading') return { presence: 'loading', label: 'Loading', tone: 'muted' }
  if (quota.connection === 'connected' && quota.freshness === 'fresh') {
    return { presence: 'connected', label: 'Connected', tone: 'fresh' }
  }
  if (quota.connection === 'disconnected') return { presence: 'unavailable', label: 'Disconnected', tone: 'muted' }
  if (quota.connection === 'accessDenied') return { presence: 'unavailable', label: 'Locked', tone: 'warn' }
  if (quota.connection === 'terminalFailure') return { presence: 'unavailable', label: 'Unavailable', tone: 'bad' }
  if (quota.freshness === 'stale') return { presence: 'stale', label: 'Stale', tone: 'stale' }
  return { presence: 'unavailable', label: 'Unavailable', tone: 'muted' }
}

/** Rank a provider for default selection without reordering the list. */
function selectionRank(quota: QuotaProvider): number {
  if (quota.freshness === 'fresh' && hasQuotaFacts(quota)) return 0
  if (quota.freshness === 'stale' && hasQuotaFacts(quota)) return 1
  if (quota.connection === 'connected') return 2
  return 3
}

/** First provider with fresh renderable evidence, then stale last-good, then
 *  a genuinely connected provider, then the first provider — existing order
 *  wins every tie. Never triggers a scan; it only picks from live data. */
function pickDefaultProvider(providers: QuotaProvider[]): QuotaProvider | null {
  let best: QuotaProvider | null = null
  let bestRank = Number.POSITIVE_INFINITY
  for (const entry of providers) {
    const rank = selectionRank(entry)
    if (rank < bestRank) {
      best = entry
      bestRank = rank
    }
  }
  return best
}

function rowSublabel(quota: QuotaProvider): string {
  if (quota.freshness !== 'unavailable' && quota.planLabel) return quota.planLabel
  return quotaProviderOwner(quota.provider)
}

function formatLastUpdated(observedAt: string | null): string | null {
  if (!observedAt) return null
  const observed = Date.parse(observedAt)
  if (!Number.isFinite(observed)) return null
  const minutes = Math.floor((Date.now() - observed) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(observed))
}

export function Plans({ period, refreshToken = 0, onNavigate, ready = true }: { period: Period; refreshToken?: number; onNavigate?: (section: Section, pane?: SettingsPane) => void; ready?: boolean }) {
  // Force a fresh fetch (bypassing QuotaService's 5-min cache, and its keychain
  // guard) when the user hits ⌘R or clicks Refresh in the Connect affordance;
  // the steady poll keeps serving cached quota.
  const [reconnectNonce, setReconnectNonce] = useState(0)
  const lastForced = useRef(`${refreshToken}:${reconnectNonce}`)
  const quota = usePolled<QuotaProvider[]>(() => {
    const key = `${refreshToken}:${reconnectNonce}`
    const force = key !== lastForced.current
    lastForced.current = key
    return metrora.getQuota(force)
  }, [refreshToken, reconnectNonce])
  const reconnect = () => setReconnectNonce(value => value + 1)
  const budgetReport = usePolled<StatusJson>(() => metrora.getPlans(period), [period, refreshToken], { enabled: ready })
  const lastUpdated = useMemo(() => {
    if (!quota.data) return null
    const latest = quota.data
      .map(entry => entry.observedAt)
      .filter((value): value is string => value !== null)
      .map(value => Date.parse(value))
      .filter(value => Number.isFinite(value))
    if (latest.length === 0) return null
    return formatLastUpdated(new Date(Math.max(...latest)).toISOString())
  }, [quota.data])

  return (
    <>
      <div className={motionClass('body', 'section-fade')}>
        {budgetReport.data && budgetReport.error && <StaleBanner error={budgetReport.error} />}
        <section className="capacity-page" aria-labelledby="capacity-heading">
          <CapacityHeader lastUpdated={lastUpdated} />
          <CapacityModeTabs />
          {renderQuotaSurface(quota.data, quota.error, reconnect, onNavigate)}
        </section>
        <BudgetPlansSection data={budgetReport.data} error={budgetReport.error} />
      </div>
    </>
  )
}

function CapacityHeader({ lastUpdated }: { lastUpdated: string | null }) {
  return (
    <div className="capacity-head">
      <div className="capacity-title-row">
        <h1 id="capacity-heading" className="capacity-title">Capacity</h1>
      </div>
      <p className="capacity-subtitle">Provider-reported quotas and credits for this workspace. Metrora usage and local budgets stay separate.</p>
      <div className="capacity-scope-row" role="group" aria-label="Capacity scope">
        <button type="button" className="capacity-scope-chip" disabled title="Workspace scopes are not connected yet">
          <span className="capacity-scope-icon" aria-hidden="true">▦</span>This workspace
        </button>
        <button type="button" className="capacity-scope-chip is-active" aria-current="true" title="Showing your personal provider capacity">
          <span className="capacity-scope-icon" aria-hidden="true">○</span>My personal
        </button>
        {lastUpdated ? <span className="capacity-last-updated">Last updated {lastUpdated}</span> : null}
      </div>
    </div>
  )
}

function CapacityModeTabs() {
  const [showWorkspacesBeta, setShowWorkspacesBeta] = useState(false)
  return (
    <>
      <div className="capacity-tabs" role="tablist" aria-label="Capacity modes">
        <button type="button" role="tab" aria-selected={!showWorkspacesBeta} className={`capacity-tab${showWorkspacesBeta ? '' : ' is-active'}`} onClick={() => setShowWorkspacesBeta(false)}>Providers</button>
        <button type="button" role="tab" aria-selected={showWorkspacesBeta} className={`capacity-tab${showWorkspacesBeta ? ' is-active' : ''}`} onClick={() => setShowWorkspacesBeta(true)}>Workspaces <span className="capacity-beta">Beta</span></button>
      </div>
      {showWorkspacesBeta ? (
        <div className="capacity-workspaces-beta">
          <b>Workspaces are in beta.</b>
          <span>
            Workspace Capacity will scope provider capacity to the selected collaboration scope — provider quotas
            within the workspace, shared or pooled capacity where the provider actually supports it, member-aware
            context, policy and budget context, and the Projects under that workspace. None of this is live yet:
            quotas below stay personal and nothing here is shared.
          </span>
        </div>
      ) : null}
    </>
  )
}

function renderQuotaSurface(
  data: QuotaProvider[] | null,
  error: ReturnType<typeof usePolled<QuotaProvider[]>>['error'],
  onReconnect: () => void,
  onNavigate: ((section: Section, pane?: SettingsPane) => void) | undefined,
) {
  if (!data) {
    if (error) {
      return (
        <Panel title="Provider capacity">
          <p className="quota-connection-note quota-terminal">Provider capacity is unavailable.</p>
        </Panel>
      )
    }
    return <SectionSkeleton label="Loading quota…" rows={3} />
  }

  if (data.length === 0) {
    return (
      <Panel title="Provider capacity">
        <p className="quota-connection-note">No provider capacity is available.</p>
      </Panel>
    )
  }

  return (
    <>
      <CapacitySummary providers={data} />
      <CapacityBrowser providers={data} onReconnect={onReconnect} onNavigate={onNavigate} />
    </>
  )
}

function CapacitySummary({ providers }: { providers: QuotaProvider[] }) {
  const presence = providers.map(capacityPresence)
  const connected = presence.filter(entry => entry.presence === 'connected').length
  const stale = presence.filter(entry => entry.presence === 'stale').length
  const loading = presence.filter(entry => entry.presence === 'loading').length
  const unavailable = providers.length - connected - stale - loading
  const breakdown = [`${connected} connected`]
  if (stale > 0) breakdown.push(`${stale} stale`)
  if (loading > 0) breakdown.push(`${loading} loading`)
  if (unavailable > 0) breakdown.push(`${unavailable} unavailable`)
  const withFacts = providers.filter(hasQuotaFacts).length
  const credited = providers.filter(entry => entry.credits !== null)
  const pooledCents = credited.reduce((sum, entry) => sum + Math.round((entry.credits?.balance ?? 0) * 100), 0)
  const [showInfo, setShowInfo] = useState(true)
  return (
    <div className="capacity-summary" role="list" aria-label="Capacity summary">
      <div className="capacity-card" role="listitem">
        <span className="capacity-card-icon" aria-hidden="true">▤</span>
        <div><b>{providers.length}</b><span>Providers</span>
          <small>{breakdown.join(' · ')}</small></div>
      </div>
      <div className="capacity-card" role="listitem">
        <span className="capacity-card-icon" aria-hidden="true">◔</span>
        <div><b>{withFacts}</b><span>Using capacity</span>
          <small>With provider-reported quotas</small></div>
      </div>
      <div className="capacity-card" role="listitem">
        <span className="capacity-card-icon" aria-hidden="true">▭</span>
        <div><b>{credited.length > 0 ? `$${(pooledCents / 100).toFixed(2)}` : '—'}</b><span>Provider credits</span>
          <small>{credited.length > 0 ? `Available from ${credited.length} provider${credited.length === 1 ? '' : 's'}` : 'No provider credits reported'}</small></div>
      </div>
      {showInfo ? (
        <p className="capacity-info-strip" role="note">
          <span aria-hidden="true">✦</span>
          <span><b>Same data, new scope</b> — provider quotas can be scoped to Personal or a Workspace.</span>
          <button type="button" className="capacity-info-dismiss" aria-label="Dismiss" onClick={() => setShowInfo(false)}>×</button>
        </p>
      ) : null}
    </div>
  )
}

type StatusFilter = 'all' | 'connected' | 'stale' | 'loading' | 'unavailable'

function CapacityBrowser({ providers, onReconnect, onNavigate }: { providers: QuotaProvider[]; onReconnect: () => void; onNavigate: ((section: Section, pane?: SettingsPane) => void) | undefined }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const visible = providers.filter(entry => {
    const presence = capacityPresence(entry).presence
    if (filter !== 'all' && presence !== filter) return false
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    const haystack = `${quotaProviderName(entry.provider)} ${rowSublabel(entry)} ${entry.provider}`.toLowerCase()
    return haystack.includes(needle)
  })
  // Selection is client-side only: switching providers never triggers a scan.
  // A manual selection sticks while its provider remains visible; otherwise
  // the ranking prefers fresh evidence without reordering the list.
  const active = visible.find(entry => entry.provider === selected)
    ?? pickDefaultProvider(visible)
    ?? visible[0]
    ?? null
  return (
    <div className="capacity-main">
      <div className="capacity-list-panel">
        <div className="capacity-list-tools">
          <label className="capacity-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={query} placeholder="Search providers…" aria-label="Search providers" onChange={event => setQuery(event.target.value)} />
          </label>
          <label className="capacity-filter">
            <span className="capacity-filter-sr">Filter by status</span>
            <select value={filter} aria-label="Filter by status" onChange={event => setFilter(event.target.value as StatusFilter)}>
              <option value="all">All statuses</option>
              <option value="connected">Connected</option>
              <option value="stale">Stale</option>
              <option value="loading">Loading</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>
        </div>
        {visible.length === 0 ? (
          <p className="quota-connection-note">No providers match this filter.</p>
        ) : (
          <ul className="capacity-list" aria-label="Providers">
            {visible.map(entry => {
              const { presence, label } = capacityPresence(entry)
              const isActive = active?.provider === entry.provider
              return (
                <li key={entry.provider}>
                  <button
                    type="button"
                    className={`capacity-row${isActive ? ' is-active' : ''}`}
                    aria-current={isActive}
                    onClick={() => setSelected(entry.provider)}
                  >
                    <ProviderLogo provider={entry.provider} size={28} />
                    <span className="capacity-row-text">
                      <b>{quotaProviderName(entry.provider)}</b>
                      <small>{rowSublabel(entry)}</small>
                    </span>
                    <span className={`capacity-dot capacity-dot-${presence}`} aria-hidden="true" />
                    <span className="capacity-row-status">{label}</span>
                    <span className="capacity-row-chevron" aria-hidden="true">›</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {active ? (
        <CapacityInspector key={active.provider} quota={active} onReconnect={onReconnect} onNavigate={onNavigate} />
      ) : null}
    </div>
  )
}

type InspectorTab = 'capacity' | 'usage' | 'team'

function CapacityInspector({ quota, onReconnect, onNavigate }: { quota: QuotaProvider; onReconnect: () => void; onNavigate: ((section: Section, pane?: SettingsPane) => void) | undefined }) {
  const [tab, setTab] = useState<InspectorTab>('capacity')
  const state = capacityPresence(quota)
  return (
    <div className="capacity-inspector" aria-label={`${quotaProviderName(quota.provider)} capacity details`}>
      <div className="capacity-inspector-head">
        <ProviderLogo provider={quota.provider} size={36} />
        <div className="capacity-inspector-titles">
          <b>{quotaProviderName(quota.provider)}</b>
          <small>{rowSublabel(quota)}</small>
        </div>
        <span className={`capacity-badge capacity-badge-${state.tone}`} title={`Capacity status: ${state.label}`}><i />{state.label}</span>
        <div className="capacity-inspector-actions">
          <button type="button" className="btn btn-s" onClick={() => onNavigate?.('settings', 'plans')}>
            <span aria-hidden="true">⚙</span> Open in Settings
          </button>
        </div>
      </div>
      <div className="capacity-inspector-tabs" role="tablist" aria-label="Provider detail">
        <button type="button" role="tab" aria-selected={tab === 'capacity'} className={`capacity-tab${tab === 'capacity' ? ' is-active' : ''}`} onClick={() => setTab('capacity')}>Capacity</button>
        <button type="button" role="tab" aria-selected={tab === 'usage'} className={`capacity-tab${tab === 'usage' ? ' is-active' : ''}`} onClick={() => setTab('usage')}>Usage</button>
        <button type="button" role="tab" aria-selected={tab === 'team'} className={`capacity-tab${tab === 'team' ? ' is-active' : ''}`} onClick={() => setTab('team')}>Team access <span className="capacity-beta">Beta</span></button>
      </div>
      {tab === 'capacity' ? <InspectorCapacity quota={quota} onReconnect={onReconnect} /> : null}
      {tab === 'usage' ? (
        <div className="capacity-tab-pane">
          <p className="quota-connection-note">Usage for {quotaProviderName(quota.provider)} lives with the rest of your Metrora data, not on this quota surface.</p>
          <div className="capacity-tab-actions">
            <button type="button" className="btn btn-s" onClick={() => onNavigate?.('models')}>Open Models</button>
            <button type="button" className="btn btn-s" onClick={() => onNavigate?.('sessions')}>Open Sessions</button>
          </div>
        </div>
      ) : null}
      {tab === 'team' ? (
        <div className="capacity-tab-pane">
          <p className="quota-connection-note">Team access is in beta. Workspace teams are not connected yet, so there is nothing to show here.</p>
        </div>
      ) : null}
    </div>
  )
}

function InspectorCapacity({ quota, onReconnect }: { quota: QuotaProvider; onReconnect: () => void }) {
  const status = <QuotaStatus quota={quota} />
  if (quota.connection === 'disconnected' || quota.connection === 'accessDenied') {
    return (
      <>
        {status}
        <ConnectAffordance provider={quota.provider} connection={quota.connection} onRefresh={onReconnect} />
        <QuotaDetails quota={quota} />
      </>
    )
  }
  if (quota.connection === 'loading') {
    return (
      <>
        {status}
        <p className="quota-connection-note">Loading quota…</p>
      </>
    )
  }
  if (quota.connection === 'terminalFailure') {
    return (
      <>
        {status}
        <p className="quota-connection-note quota-terminal">Provider capacity is currently unavailable.</p>
        <QuotaDetails quota={quota} />
      </>
    )
  }
  const stale = quota.freshness === 'stale' || quota.connection === 'stale' || quota.connection === 'transientFailure'
  const note = isRateLimited(quota)
    ? rateLimitedNote(quota.provider)
    : stale
      ? staleQuotaNote(quota)
      : null
  if (quota.freshness === 'unavailable') {
    return (
      <>
        {status}
        {note
          ? <p className="quota-connection-note">{note}</p>
          : <p className="quota-connection-note">The provider did not report quota evidence.</p>}
        <QuotaDetails quota={quota} />
      </>
    )
  }

  const hasWindows = quota.windows.length > 0

  return (
    <>
      <p className="capacity-inspector-lede">Provider-reported quotas and credits for this workspace. Configuration and API keys are managed in Settings.</p>
      {status}
      {note ? <p className="quota-connection-note">{note}</p> : null}
      {hasWindows
        ? <div className="quota-windows capacity-windows">{quota.windows.map(window => <QuotaMeter key={window.id} window={window} />)}</div>
        : <p className="quota-connection-note">The provider did not report quota windows.</p>}
      {quota.credits !== null ? <div className="quota-footer"><span>Credits remaining · ${quota.credits.balance.toFixed(2)}</span></div> : null}
      <QuotaDetails quota={quota} />
    </>
  )
}

function QuotaStatus({ quota }: { quota: QuotaProvider }) {
  const state = capacityPresence(quota)
  const observed = quota.freshness === 'unavailable' ? null : formatObservedAt(quota.observedAt)
  const observation = observed
    ? `${quota.freshness === 'stale' ? 'Last observed' : 'Observed'} ${observed}`
    : null
  return (
    <div className={`quota-status quota-status-${state.tone}`} aria-label={`Capacity status: ${state.label}`}>
      <span className="quota-status-label"><i />{state.label}</span>
      {observation ? <span className="quota-status-observed">{observation}</span> : null}
    </div>
  )
}

function freshnessLabel(quota: QuotaProvider): string {
  if (quota.freshness === 'fresh') return 'Fresh'
  if (quota.freshness === 'stale') return 'Stale'
  return 'Unavailable'
}

function QuotaDetails({ quota }: { quota: QuotaProvider }) {
  const observed = quota.freshness === 'unavailable' ? null : formatObservedAt(quota.observedAt)
  const retryAt = quota.rateLimit.state === 'backoff' ? formatObservedAt(quota.rateLimit.retryAt) : null
  return (
    <details className="quota-details">
      <summary>Provider details</summary>
      <div className="quota-detail-grid">
        <span>Source</span><span>{quotaSourceLabel(quota.source)}</span>
        <span>Status</span><span>{capacityPresence(quota).label}</span>
        <span>Freshness</span><span>{freshnessLabel(quota)}</span>
        <span>Observed</span><span>{observed ?? 'Not available'}</span>
        {retryAt ? <><span>Retry after</span><span>{retryAt}</span></> : null}
      </div>
    </details>
  )
}

function staleQuotaNote(quota: QuotaProvider): string {
  if (!quota.observedAt) return 'Provider quota is temporarily unavailable.'
  const observed = new Date(quota.observedAt)
  if (Number.isNaN(observed.getTime())) return 'Provider quota is temporarily unavailable.'
  return `Showing last provider-reported quota from ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(observed)}.`
}

function formatObservedAt(value: string | null): string | null {
  if (!value) return null
  const observed = new Date(value)
  if (Number.isNaN(observed.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(observed)
}

function QuotaMeter({ window }: { window: QuotaWindow }) {
  const percent = Math.round(Math.min(1, Math.max(0, window.usedFraction)) * 100)
  const remaining = 100 - percent
  const severity = window.usedFraction >= 0.9 ? 'bad' : window.usedFraction >= 0.7 ? 'warn' : 'accent'
  const reset = formatResetTime(window.resetsAt)
  return (
    <div className="quota-window">
      <div className="quota-window-labels">
        <span>{window.label}</span>
        <span>{percent}% used · {remaining}% remaining{reset ? ` · ${reset}` : ''}</span>
      </div>
      <div className="track" data-testid={`quota-track-${window.id}`}>
        <i className={severity} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  )
}

function formatResetTime(resetsAt: string | null): string | null {
  if (!resetsAt) return null
  const reset = Date.parse(resetsAt)
  if (!Number.isFinite(reset)) return null
  const remainingMinutes = Math.floor((reset - Date.now()) / 60_000)
  if (remainingMinutes <= 0) return 'reset passed'
  const days = Math.floor(remainingMinutes / (24 * 60))
  const hours = Math.floor((remainingMinutes % (24 * 60)) / 60)
  const minutes = remainingMinutes % 60
  if (days > 0) return `resets in ${days}d${hours > 0 ? ` ${hours}h` : ''}`
  if (hours > 0) return `resets in ${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
  return `resets in ${minutes}m`
}
