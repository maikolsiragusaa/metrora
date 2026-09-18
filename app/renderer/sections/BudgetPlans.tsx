import { CliErrorPanel } from '../components/CliErrorPanel'
import { Panel } from '../components/Panel'
import type { usePolled } from '../hooks/usePolled'
import { formatConverted } from '../lib/format'
import type { JsonPlanSummary, PlanId, PlanProvider, StatusJson } from '../lib/types'

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

/** Local manual budget plans. Deliberately separate from provider-reported
 *  capacity above: budgets are user-configured pacing, not quota facts. */
export function BudgetPlansSection({ data, error }: { data: StatusJson | null; error: ReturnType<typeof usePolled<StatusJson>>['error'] }) {
  if (!data && error) {
    return (
      <section className="budget-plans">
        <h2 className="plans-section-heading">Budget plans</h2>
        <CliErrorPanel error={error} subject="plan pacing" />
      </section>
    )
  }
  const plans = data ? manualPlanSummaries(data) : []
  if (plans.length === 0) return null

  return (
    <section className="budget-plans">
      <h2 className="plans-section-heading">Budget plans</h2>
      {plans.map(plan => <PlanPanel key={`${plan.provider}-${plan.id}`} plan={plan} />)}
    </section>
  )
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
