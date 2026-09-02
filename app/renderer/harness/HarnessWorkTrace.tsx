import { periodLabel } from '../advisor/evidence'
import type { AdvisorScope, AdvisorToolEvent } from '../advisor/types'

export type HarnessToolActivity = AdvisorToolEvent

const TOOL_LABELS: Record<string, string> = {
  get_spend_snapshot: 'Checking usage',
  get_model_efficiency: 'Comparing models',
  get_quota_snapshot: 'Checking provider capacity',
  get_overview_snapshot: 'Checking overview',
  get_project_drivers: 'Checking Project breakdown',
  get_session_highlights: 'Checking session breakdown',
  get_coverage_report: 'Checking Sources',
  get_bench_evidence: 'Checking Bench results',
}
export function harnessToolLabel(name: string, scope: AdvisorScope): string {
  return (TOOL_LABELS[name] ?? 'Checking Metrora Sources') + ' · ' + periodLabel(scope)
}

export function harnessToolCheckedLabel(name: string): string {
  if (name === 'get_spend_snapshot') return 'Usage checked'
  if (name === 'get_model_efficiency') return 'Model breakdown checked'
  if (name === 'get_quota_snapshot') return 'Provider capacity checked'
  if (name === 'get_overview_snapshot') return 'Overview checked'
  if (name === 'get_project_drivers') return 'Project breakdown checked'
  if (name === 'get_session_highlights') return 'Session breakdown checked'
  if (name === 'get_coverage_report') return 'Sources checked'
  if (name === 'get_bench_evidence') return 'Bench results checked'
  return 'Sources checked'
}

function activityStatus(status: HarnessToolActivity['status']): string {
  if (status === 'queued') return 'Queued'
  if (status === 'started') return 'In progress'
  if (status === 'completed') return 'Checked'
  if (status === 'unavailable') return 'Unavailable'
  if (status === 'cancelled') return 'Cancelled'
  return 'Failed'
}

export function HarnessWorkTrace({ items, scope }: { items: readonly HarnessToolActivity[]; scope: AdvisorScope }) {
  if (!items.length) return null
  return (
    <div className="harness-v3-work-trace" aria-label="Harness work activity">
      {items.map(item => (
        <div className="harness-v3-work-trace-row" key={item.name}>
          <span aria-hidden="true" className={'harness-v3-work-dot ' + item.status} />
          <span>{harnessToolLabel(item.name, scope)}</span>
          <small>{activityStatus(item.status)}</small>
        </div>
      ))}
    </div>
  )
}
