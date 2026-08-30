import { useRef, useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { ConnectAffordance } from '../components/ConnectAffordance'
import { Panel } from '../components/Panel'
import { SectionSkeleton } from '../components/Skeleton'
import type { Section } from '../components/Sidebar'
import { StaleBanner } from '../components/StaleBanner'
import { usePolled } from '../hooks/usePolled'
import { formatConverted } from '../lib/format'
import { metrora } from '../lib/ipc'
import { motionClass } from '../lib/motion'
import { quotaProviderName, quotaProviderOwner, quotaSourceLabel } from '../lib/quota-providers'
import type { JsonPlanSummary, Period, PlanId, PlanProvider, QuotaProvider, QuotaWindow, StatusJson } from '../lib/types'
import type { SettingsPane } from './Settings'

const PROVIDER_ORDER: PlanProvider[] = ['all', 'claude', 'codex', 'cursor', 'grok']

const PLAN_NAMES: Record<PlanId, string> = {
  'claude-pro': 'Claude Pro',
  'claude-max': 'Claude Max',
  'claude-max-5x': 'Claude Max 5x',
  'cursor-pro': 'Cursor Pro',
  supergrok: 'SuperGrok',
  'supergrok-heavy': 'SuperGrok Heavy',
  custom: 'Custom plan',
  none: 'API usage',
}

function fmtPct(n: number): string {
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`
}

/** Honest copy for a 429 backoff window (the upstream quota endpoint rate
 *  limited us), replacing the generic "waiting" note. */
export function rateLimitedNote(provider: QuotaProvider['provider']): string {
  return `${quotaProviderOwner(provider)} rate limited the quota endpoint, retrying in a few minutes`
}

function isRateLimited(quota: QuotaProvider): boolean {
  return quota.rateLimit.state === 'backoff'
}

function cycleEndDate(plan: JsonPlanSummary): Date | null {
  const date = new Date(plan.periodEnd)
  if (Number.isNaN(date.getTime())) return null
  date.setDate(date.getDate() - 1)
  return date
}

function formatShortDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function planSummaries(status: StatusJson): JsonPlanSummary[] {
  const plans = status.plans
  if (plans) {
    const ordered = PROVIDER_ORDER.flatMap(provider => {
      const plan = plans[provider]
      return plan ? [plan] : []
    })
    if (ordered.length > 0) return ordered
  }
  return status.plan ? [status.plan] : []
}

function manualPlanSummaries(status: StatusJson): JsonPlanSummary[] {
  return planSummaries(status).filter(plan => plan.provider !== 'claude' && plan.provider !== 'codex')
}

export function Plans({ period, refreshToken = 0, onNavigate, onAskAdvisor, onRefresh, refreshing = false, ready = true }: { period: Period; refreshToken?: number; onNavigate?: (section: Section, pane?: SettingsPane) => void; onAskAdvisor?: () => void; onRefresh?: () => void; refreshing?: boolean; ready?: boolean }) {
  // Force a fresh fetch (bypassing QuotaService's 5-min cache, and its keychain
  // guard) when the user hits ⌘R or clicks Refresh in the Connect affordance;
  // the steady 30s poll keeps serving cached quota.
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
  const manualPlans = budgetReport.data ? manualPlanSummaries(budgetReport.data) : []

  return (
    <>
      <div className="bar">
        <div className="t">Plans</div>
        <div className="sp" />
        {onAskAdvisor && <button type="button" className="btn btn-s ask-advisor-button" onClick={onAskAdvisor}>Ask Harness <span aria-hidden="true">↗</span></button>}
        {onRefresh && <button type="button" className="btn btn-s refresh-button" onClick={onRefresh} disabled={refreshing} aria-label={refreshing ? 'Refreshing' : 'Refresh'}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>}
        <button type="button" className="btn btn-s" onClick={() => onNavigate?.('settings', 'plans')}>
          Add plan…
        </button>
      </div>
      <div className={motionClass('body', 'section-fade')}>
        {budgetReport.data && budgetReport.error && <StaleBanner error={budgetReport.error} />}
        <section className="capacity-section" aria-labelledby="capacity-heading">
          <div className="capacity-section-head">
            <h2 id="capacity-heading" className="plans-section-heading">Capacity</h2>
            <span className="capacity-authority">Provider-reported</span>
          </div>
          <p className="capacity-intro">Quota and credits from each provider. Metrora usage and local budgets stay separate.</p>
          {renderQuota(quota.data, quota.error, reconnect)}
        </section>
        {renderBudgetPlans(budgetReport.data, budgetReport.error, manualPlans)}
      </div>
    </>
  )
}

function renderQuota(data: QuotaProvider[] | null, error: ReturnType<typeof usePolled<QuotaProvider[]>>['error'], onReconnect: () => void) {
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

  return data.map(provider => <QuotaPanel key={provider.provider} quota={provider} onReconnect={onReconnect} />)
}

function renderBudgetPlans(data: StatusJson | null, error: ReturnType<typeof usePolled<StatusJson>>['error'], plans: JsonPlanSummary[]) {
  if (!data && error) {
    return (
      <section className="budget-plans">
        <h2 className="plans-section-heading">Budget plans</h2>
        <CliErrorPanel error={error} subject="plan pacing" />
      </section>
    )
  }
  if (plans.length === 0) return null

  return (
    <section className="budget-plans">
      <h2 className="plans-section-heading">Budget plans</h2>
      {plans.map(plan => <PlanPanel key={`${plan.provider}-${plan.id}`} plan={plan} />)}
    </section>
  )
}

function QuotaPanel({ quota, onReconnect }: { quota: QuotaProvider; onReconnect: () => void }) {
  const providerName = quotaProviderName(quota.provider)
  const planLabel = quota.freshness === 'unavailable' ? null : quota.planLabel
  return (
    <Panel
      className="quota-card"
      title={<span className="quota-title">{providerName}{planLabel ? <small>{planLabel}</small> : null}</span>}
      right={<ConnectionIndicator connection={quota.connection} />}
    >
      <QuotaContent quota={quota} onReconnect={onReconnect} />
    </Panel>
  )
}

function ConnectionIndicator({ connection }: { connection: QuotaProvider['connection'] }) {
  const label = connection === 'transientFailure' ? 'waiting'
    : connection === 'terminalFailure' ? 'error'
    : connection === 'accessDenied' ? 'locked'
    : connection
  return <span className={`quota-connection quota-connection-${connection}`}><i />{label}</span>
}

function QuotaContent({ quota, onReconnect }: { quota: QuotaProvider; onReconnect: () => void }) {
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
      {status}
      {note ? <p className="quota-connection-note">{note}</p> : null}
      {hasWindows
        ? <div className="quota-windows">{quota.windows.map(window => <QuotaMeter key={window.id} window={window} />)}</div>
        : <p className="quota-connection-note">The provider did not report quota windows.</p>}
      {quota.credits !== null ? <div className="quota-footer"><span>Credits remaining · ${quota.credits.balance.toFixed(2)}</span></div> : null}
      <QuotaDetails quota={quota} />
    </>
  )
}

function QuotaStatus({ quota }: { quota: QuotaProvider }) {
  const state = quotaStatus(quota)
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

function quotaStatus(quota: QuotaProvider): { label: string; tone: 'fresh' | 'stale' | 'warn' | 'bad' | 'muted' } {
  if (quota.rateLimit.state === 'backoff') return { label: 'Rate limited', tone: 'warn' }
  if (quota.connection === 'disconnected') return { label: 'Disconnected', tone: 'muted' }
  if (quota.connection === 'accessDenied') return { label: 'Access needed', tone: 'warn' }
  if (quota.connection === 'loading') return { label: 'Loading', tone: 'muted' }
  if (quota.connection === 'terminalFailure') return { label: 'Unavailable', tone: 'bad' }
  if (quota.freshness === 'stale' || (quota.connection === 'stale' && quota.freshness !== 'unavailable')) {
    return { label: 'Stale', tone: 'stale' }
  }
  if (quota.freshness === 'fresh' && quota.connection === 'connected') return { label: 'Fresh', tone: 'fresh' }
  return { label: 'Unavailable', tone: 'muted' }
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
        <span>Status</span><span>{quotaStatus(quota).label}</span>
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

function PlanPanel({ plan }: { plan: JsonPlanSummary }) {
  const hasBudget = plan.budget > 0
  const displayPercent = Math.min(100, Math.max(0, plan.percentUsed))
  const over = plan.status === 'over' || plan.percentUsed > 100
  const trackClass = hasBudget ? (over ? 'over' : undefined) : 'mut'
  const overage = Math.max(0, plan.spent - plan.budget)
  const right = hasBudget
    ? `${formatConverted(plan.spent)} · ${fmtPct(plan.percentUsed)}${overage > 0 ? ` · ${formatConverted(overage)} over` : ''}`
    : `${formatConverted(plan.spent)} this cycle`
  const detail = hasBudget ? `${formatConverted(plan.budget)} / month · ${plan.provider}` : `${plan.provider} · pay as you go, no plan`

  return (
    <Panel>
      <div className="plrow">
        <b>{PLAN_NAMES[plan.id]}</b>
        <span>{detail}</span>
        <span className="r">{right}</span>
      </div>
      <div className="track" data-testid={`plan-track-${plan.provider}`}>
        <i className={trackClass} style={{ width: `${displayPercent}%` }} />
      </div>
      {hasBudget ? <PaceLine plan={plan} /> : null}
    </Panel>
  )
}

function PaceLine({ plan }: { plan: JsonPlanSummary }) {
  const end = cycleEndDate(plan)
  const endLabel = end ? formatShortDate(end) : 'unknown'
  if (plan.status === 'over' || plan.projectedMonthEnd > plan.budget) {
    return (
      <div className="pace hot">
        On pace to exceed; projected {formatConverted(plan.projectedMonthEnd)} by {endLabel}
      </div>
    )
  }
  if (plan.status === 'near') {
    return (
      <div className="pace hot">
        {fmtPct(plan.percentUsed)} of budget used; projected {formatConverted(plan.projectedMonthEnd)} by {endLabel}
      </div>
    )
  }
  return <div className="pace ok">On track</div>
}
