import { periodLabel } from '../advisor/evidence'
import type { AdvisorScope, AdvisorToolEvent } from '../advisor/types'
import type { MetroraAgentLoopEvent } from '../agent-loop/contracts'

export type HarnessToolActivity = AdvisorToolEvent

export type HarnessCompletedWorkTraceItem = {
  id: string
  label: string
  status: 'completed' | 'failed'
}

export type HarnessCompletedWorkTrace = {
  schemaVersion: 1
  items: readonly HarnessCompletedWorkTraceItem[]
  /** Safe lifecycle counts; no model content, reasoning, or tool arguments. */
  modelSteps?: number
  modelCompletions?: number
  toolEvents?: number
}

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

export function createHarnessCompletedWorkTrace(items: readonly HarnessToolActivity[], events: readonly MetroraAgentLoopEvent[] = []): HarnessCompletedWorkTrace {
  const trace: HarnessCompletedWorkTraceItem[] = [
    { id: 'thinking', label: 'Thinking', status: 'completed' },
  ]
  const modelStarts = events.filter(event => event.type === 'model-started').length
  const modelCompletions = events.filter(event => event.type === 'model-completed').length
  const modelToolNames = new Set(events.filter(event => event.type.startsWith('tool-') && event.tool).map(event => event.tool!))
  const seenTools = new Set<string>()
  const appendTools = (candidates: readonly HarnessToolActivity[]) => {
    for (const item of candidates) {
      if (seenTools.has(item.name)) continue
      seenTools.add(item.name)
      const completed = item.status === 'completed'
      trace.push({
        id: 'check-' + String(seenTools.size),
        label: completed ? harnessToolCheckedLabel(item.name) : item.status === 'unavailable' ? 'Unavailable' : 'Failed',
        status: completed ? 'completed' : 'failed',
      })
    }
  }
  // Controller-owned pre-reads are not loop Tool events, so they remain in the
  // first factual phase. A later model-owned read gets its own safe Thinking
  // marker; provider output and reasoning are never copied into the trace.
  appendTools(items.filter(item => !modelToolNames.has(item.name)))
  const modelTools = items.filter(item => modelToolNames.has(item.name))
  if (modelStarts > 0 || modelTools.length) trace.push({ id: 'thinking-2', label: 'Thinking', status: 'completed' })
  appendTools(modelTools)
  if (modelCompletions > 0) trace.push({ id: 'models-checked', label: 'Models checked', status: 'completed' })
  trace.push({ id: 'preparing-answer', label: 'Preparing answer', status: 'completed' })
  trace.push({ id: 'done', label: 'Done', status: 'completed' })
  const checks = trace.slice(0, -2).slice(0, 8)
  return {
    schemaVersion: 1,
    items: [...checks, trace[trace.length - 2]!, trace[trace.length - 1]!],
    ...(events.length ? { modelSteps: modelStarts, modelCompletions, toolEvents: events.filter(event => event.type.startsWith('tool-')).length } : {}),
  }
}

function activityStatus(status: HarnessToolActivity['status']): string {
  if (status === 'queued') return 'Queued'
  if (status === 'started') return 'In progress'
  if (status === 'completed') return 'Checked'
  if (status === 'unavailable') return 'Unavailable'
  if (status === 'cancelled') return 'Cancelled'
  return 'Failed'
}

export function HarnessWorkTrace({ items, scope, events = [] }: { items: readonly HarnessToolActivity[]; scope: AdvisorScope; events?: readonly MetroraAgentLoopEvent[] }) {
  const hasModelLifecycle = events.some(event => event.type === 'model-started' || event.type === 'model-completed')
  if (!items.length && !hasModelLifecycle) return null
  const modelStarted = events.some(event => event.type === 'model-started')
  const modelCompleted = events.some(event => event.type === 'model-completed')
  const modelToolNames = new Set(events.filter(event => event.type.startsWith('tool-') && event.tool).map(event => event.tool!))
  const controllerItems = items.filter(item => !modelToolNames.has(item.name))
  const modelItems = items.filter(item => modelToolNames.has(item.name))
  const activityRow = (item: HarnessToolActivity) => <div className="harness-v3-work-trace-row" key={item.name}>
    <span aria-hidden="true" className={'harness-v3-work-dot ' + item.status} />
    <span>{harnessToolLabel(item.name, scope)}</span>
    <small>{activityStatus(item.status)}</small>
  </div>
  return (
    <div className="harness-v3-work-trace" aria-label="Harness work activity">
      {controllerItems.map(activityRow)}
      {modelStarted ? <div className="harness-v3-work-trace-row" key="model-thinking">
        <span aria-hidden="true" className="harness-v3-work-dot started" />
        <span>Thinking…</span>
        <small>{modelCompleted ? 'Done' : 'In progress'}</small>
      </div> : null}
      {modelItems.map(activityRow)}
      {modelCompleted ? <div className="harness-v3-work-trace-row" key="model-checked">
        <span aria-hidden="true" className="harness-v3-work-dot completed" />
        <span>Models checked</span>
        <small>Done</small>
      </div> : null}
    </div>
  )
}

export function HarnessCompletedWorkTraceView({ trace }: { trace: HarnessCompletedWorkTrace }) {
  const checks = trace.items.filter(item => item.id.startsWith('check-')).length
  const failed = trace.items.some(item => item.status === 'failed')
  const summary = checks > 0
    ? String(checks) + ' source' + (checks === 1 ? '' : 's') + ' checked · ' + (failed ? 'Completed with limits' : 'Done')
    : failed ? 'Sources unavailable · Completed with limits' : 'Answer prepared · Done'
  return (
    <details className="harness-v3-completed-work-trace" aria-label="Completed Harness work trace">
      <summary>{summary}</summary>
      <div className="harness-v3-work-trace">
        {trace.items.map(item => <div className="harness-v3-work-trace-row" key={item.id}>
          <span aria-hidden="true" className={'harness-v3-work-dot ' + item.status} />
          <span>{item.label}</span>
          <small>{item.status === 'completed' ? 'Done' : 'Failed'}</small>
        </div>)}
      </div>
    </details>
  )
}
