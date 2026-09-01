import { periodLabel } from '../advisor/evidence'
import type { AdvisorScope, AdvisorToolEvent } from '../advisor/types'

export type HarnessToolActivity = AdvisorToolEvent

const TOOL_LABELS: Record<string, string> = {
  get_spend_snapshot: 'Reading usage',
  get_model_efficiency: 'Reading model efficiency',
  get_quota_snapshot: 'Reading provider capacity',
  get_overview_snapshot: 'Reading overview',
  get_project_drivers: 'Reading Project drivers',
  get_session_highlights: 'Reading session highlights',
  get_coverage_report: 'Checking evidence coverage',
  get_bench_evidence: 'Reading Bench evidence',
}
export function harnessToolLabel(name: string, scope: AdvisorScope): string {
  return (TOOL_LABELS[name] ?? 'Reading Metrora evidence') + ' · ' + periodLabel(scope)
}

function activityStatus(status: HarnessToolActivity['status']): string {
  if (status === 'queued') return 'Queued'
  if (status === 'started') return 'In progress'
  if (status === 'completed') return 'Ready'
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
