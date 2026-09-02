import { useMemo } from 'react'
import type { SwarmEventV1, SwarmRunResultV1 } from '../../../src/swarm/contract-v1'
import type { SwarmRunState } from '../swarm/useSwarmRun'

type WorkerRow = {
  workerId: string
  role: string
  status: string
  tools: Array<{ name: string; status: string }>
  detail: string
}
function statusLabel(status: string): string {
  if (status === 'queued') return 'Queued'
  if (status === 'started' || status === 'tool-started') return 'Running'
  if (status === 'tool-completed') return 'Tool complete'
  if (status === 'completed') return 'Complete'
  if (status === 'unavailable') return 'Unavailable'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'timeout') return 'Timed out'
  return 'Failed'
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    get_spend_snapshot: 'Usage',
    get_model_efficiency: 'Model breakdown',
    get_quota_snapshot: 'Provider capacity',
    get_overview_snapshot: 'Overview',
    get_project_drivers: 'Project drivers',
    get_session_highlights: 'Session highlights',
    get_coverage_report: 'Sources',
    get_bench_evidence: 'Bench results',
  }
  return labels[name] ?? 'Metrora Sources'
}

function evidenceSummaryLabel(value: string): string {
  return value
    .replace(/Usable canonical evidence/gu, 'Sources available')
    .replace(/Partial canonical evidence/gu, 'Partial Sources')
    .replace(/Canonical evidence unavailable/gu, 'Sources unavailable')
    .replace(/No canonical Metrora read was required/gu, 'No Metrora Source check was required')
    .replace(/No supported canonical Metrora evidence read was assigned/gu, 'No supported Metrora Source check was assigned')
    .replace(/The required canonical Metrora evidence was unavailable/gu, 'The required Metrora Sources were unavailable')
}

function eventRows(events: readonly SwarmEventV1[], result: SwarmRunResultV1 | null): WorkerRow[] {
  const workers = new Map<string, WorkerRow>()
  for (const event of events) {
    if (event.kind !== 'worker') continue
    const current = workers.get(event.workerId) ?? { workerId: event.workerId, role: event.role, status: 'queued', tools: [], detail: '' }
    current.status = event.status
    current.detail = event.detail ?? current.detail
    if (event.toolName) {
      const previous = current.tools.find(tool => tool.name === event.toolName)
      if (previous) previous.status = event.status
      else current.tools.push({ name: event.toolName, status: event.status })
    }
    workers.set(event.workerId, current)
  }
  for (const worker of result?.workers ?? []) {
    const current = workers.get(worker.workerId) ?? { workerId: worker.workerId, role: worker.role, status: worker.status, tools: [], detail: '' }
    current.status = worker.status
    current.tools = worker.toolActivity.map(tool => ({ name: tool.name, status: tool.status }))
    current.detail = worker.errors[0] ?? current.detail
    workers.set(worker.workerId, current)
  }
  return [...workers.values()].sort((left, right) => left.workerId.localeCompare(right.workerId))
}

export function HarnessSwarmRun({ enabled, runtimeLabel, modelLabel, state, onCancel }: { enabled: boolean; runtimeLabel: string; modelLabel: string; state: SwarmRunState; onCancel: () => void }) {
  const rows = useMemo(() => eventRows(state.events, state.result), [state.events, state.result])
  const completeCount = rows.filter(row => row.status === 'completed').length
  const workerResults = new Map((state.result?.workers ?? []).map(worker => [worker.workerId, worker]))

  if (!enabled) {
    return <section className="harness-v3-swarm-run is-unavailable" aria-label="Swarm unavailable"><span className="harness-v3-strategy-badge">Swarm · Soon</span><p>Swarm is not enabled in this build. Chat remains available in this conversation.</p></section>
  }

  return (
    <section className="harness-v3-swarm-run" aria-label="Swarm run" aria-live="polite">
      <div className="harness-v3-swarm-head">
        <div><span className="harness-v3-strategy-badge">Swarm</span><strong>{state.running ? 'Coordinated work in progress' : state.result ? 'Swarm run ' + statusLabel(state.status).toLowerCase() : 'Swarm is ready'}</strong><p>Bounded subagents will report back into this conversation.</p></div>
        <div className="harness-v3-swarm-runtime"><span>{runtimeLabel}</span><span>{modelLabel}</span></div>
      </div>
      {state.error ? <p className="harness-v3-swarm-error" role="alert">{state.error}</p> : null}
      {rows.length ? <>
        <div className="harness-v3-swarm-progress"><span>{rows.length} subagents · {completeCount} complete{state.running ? ' · active' : ''}</span>{state.running ? <button type="button" className="harness-v3-quiet-button" onClick={onCancel}>Cancel</button> : null}</div>
        <div className="harness-v3-workers">
          {rows.map((row, index) => {
            const result = workerResults.get(row.workerId)
            return <article className="harness-v3-worker" key={row.workerId}>
              <div className="harness-v3-worker-head"><div><strong>Subagent {index + 1}</strong></div><span className={'harness-v3-worker-status ' + row.status}>{statusLabel(row.status)}</span></div>
              {row.tools.length ? <div className="harness-v3-worker-tools">{row.tools.map(tool => <span key={tool.name}><i className={tool.status} />{toolLabel(tool.name)} · {statusLabel(tool.status)}</span>)}</div> : null}
              {row.detail ? <p>{row.detail}</p> : null}
              {result ? <details className="harness-v3-worker-closeout"><summary>View subagent closeout</summary><div><p>{result.answer || 'No subagent answer was returned.'}</p>{result.evidenceSummary ? <p>{evidenceSummaryLabel(result.evidenceSummary)}</p> : null}{result.artifactSummary ? <p>Artifact · {result.artifactSummary}</p> : null}{result.errors.map(error => <p key={error}>Issue · {error}</p>)}</div></details> : null}
            </article>
          })}
        </div>
      </> : <p className="harness-v3-swarm-idle">Choose Swarm in the composer when you want bounded coordinated work. Subagent progress will appear here.</p>}
      {state.result ? <div className="harness-v3-swarm-result"><div className="harness-v3-swarm-result-head"><strong>Final answer</strong><span>{state.result.synthesis?.status === 'completed' ? 'Synthesized' : state.result.synthesis?.status === 'unavailable' ? 'Fallback closeout' : statusLabel(state.result.status)}</span></div><p>{state.result.synthesis?.answer || 'No final synthesis was available; subagent closeouts remain inspectable.'}</p>{state.result.synthesis?.evidenceSummary ? <small>{evidenceSummaryLabel(state.result.synthesis.evidenceSummary)}</small> : null}<details><summary>Run details</summary><p>Subagent completion is separate from Sources.</p><code>{state.result.evidence.evidenceDigest}</code></details></div> : null}
    </section>
  )
}
