import { useMemo } from 'react'
import type { SwarmEventV1, SwarmRunResultV1 } from '../../../src/swarm/contract-v1'
import type { SwarmRunState } from '../swarm/useSwarmRun'
import { sanitizeAdvisorDisplayText, sanitizeAdvisorModelOutput } from '../advisor/privacy'

type SwarmWorkspaceProps = {
  enabled: boolean
  runtimeLabel: string
  modelLabel: string
  state: SwarmRunState
  onRun: (task: string, workerCount?: number) => void
  workerCount: number
  onWorkerCountChange: (count: number) => void
  onCancel: () => void
  showFinalResult?: boolean
}

type WorkerRow = {
  workerId: string
  role: string
  status: string
  tools: Array<{ name: string; status: string }>
  detail: string
  answer: string
  evidenceSummary: string
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

function visibleDiagnostic(value: string): string {
  if (/abort|cancel/i.test(value)) return 'Worker cancelled.'
  if (/timeout|deadline/i.test(value)) return 'Worker timed out.'
  if (/unavailable|not available|runtime/i.test(value)) return 'Worker runtime unavailable.'
  if (/tool|contract|allowlist|bound|scope/i.test(value)) return 'Worker request was rejected by the bounded Tool contract.'
  return 'Worker failed; diagnostic details were withheld.'
}

function eventRows(events: readonly SwarmEventV1[], result: SwarmRunResultV1 | null): WorkerRow[] {
  const workers = new Map<string, WorkerRow>()
  for (const event of events) {
    if (event.kind !== 'worker') continue
    const current = workers.get(event.workerId) ?? {
      workerId: event.workerId,
      role: event.role,
      status: 'queued',
      tools: [],
      detail: '',
      answer: '',
      evidenceSummary: '',
    }
    current.status = event.status
    current.detail = event.detail ? sanitizeAdvisorDisplayText(event.detail, 240) : current.detail
    if (event.toolName) {
      const previous = current.tools.find(tool => tool.name === event.toolName)
      if (previous) previous.status = event.status
      else current.tools.push({ name: event.toolName, status: event.status })
    }
    workers.set(event.workerId, current)
  }
  for (const worker of result?.workers ?? []) {
    const current = workers.get(worker.workerId) ?? {
      workerId: worker.workerId,
      role: worker.role,
      status: worker.status,
      tools: [],
      detail: '',
      answer: '',
      evidenceSummary: '',
    }
      current.status = worker.status
      current.tools = worker.toolActivity.map(tool => ({ name: tool.name, status: tool.status }))
      current.detail = worker.errors[0] ? visibleDiagnostic(worker.errors[0]) : current.detail
      current.answer = sanitizeAdvisorModelOutput(worker.answer, 8 * 1024)
      current.evidenceSummary = sanitizeAdvisorDisplayText(worker.evidenceSummary, 1 * 1024)
      workers.set(worker.workerId, current)
  }
  return [...workers.values()].sort((left, right) => left.workerId.localeCompare(right.workerId))
}

export function SwarmWorkspace({ enabled, runtimeLabel, modelLabel, state, workerCount, onWorkerCountChange, onCancel, showFinalResult = true }: SwarmWorkspaceProps) {
  const rows = useMemo(() => eventRows(state.events, state.result), [state.events, state.result])
  const completeCount = rows.filter(row => row.status === 'completed').length
  const running = state.running

  if (!enabled) {
    return (
      <div className="swarm-disabled" aria-label="Swarm unavailable">
        <span className="swarm-badge muted">Swarm unavailable</span>
        <h2>Swarm is not enabled</h2>
        <p>This manual execution strategy is disabled by the current deployment configuration.</p>
      </div>
    )
  }

  return (
    <div className="swarm-surface" aria-label="Manual Swarm">
      <div className="swarm-head">
        <div>
          <span className="swarm-badge">Swarm · Manual and bounded</span>
          <h2>Run a bounded multi-worker investigation</h2>
          <p>Bounded transparent workers use the selected Harness runtime and canonical read-only Metrora Tools. No worker can execute actions.</p>
        </div>
        <div className="swarm-runtime-identity">
          <span>Runtime</span>
          <strong>{runtimeLabel}</strong>
          <span>Model</span>
          <strong>{modelLabel}</strong>
        </div>
      </div>

      <div className="swarm-task-form">
        <div className="swarm-task-foot">
          <label htmlFor="swarm-worker-count">
            Workers
            <select id="swarm-worker-count" aria-label="Swarm worker count" value={workerCount} onChange={event => onWorkerCountChange(Number(event.target.value))} disabled={running}>
              <option value={2}>2 - default</option>
              <option value={3}>3 - maximum</option>
            </select>
          </label>
          <span>Read-only Tools - max 4 Tool calls/worker - max 1 Tool round/worker</span>
          <span>Use the shared Harness composer below to start this run.</span>
        </div>
      </div>

      {state.error ? <div className="advisor-error" role="alert">{state.error}</div> : null}

      {rows.length ? (
        <div className="swarm-progress" aria-live="polite">
          <div className="swarm-progress-head">
            <strong>{running ? 'Swarm running' : 'Swarm ' + statusLabel(state.status)}</strong>
            <span>{rows.length} workers - {completeCount} complete{running ? ' - Cancel available' : ''}</span>
            {running ? <button className="advisor-cancel" type="button" onClick={onCancel}>Cancel</button> : null}
          </div>
          <div className="swarm-worker-list">
            {rows.map(row => (
              <article className="swarm-worker-card" key={row.workerId}>
                <div className="swarm-worker-card-head">
                  <div>
                    <strong>{row.role.charAt(0).toUpperCase() + row.role.slice(1).replaceAll('-', ' ')}</strong>
                    <small>{row.workerId}</small>
                  </div>
                  <span className={'swarm-worker-status ' + row.status}>{statusLabel(row.status)}</span>
                </div>
                {row.tools.length ? (
                  <div className="swarm-tool-list">
                    {row.tools.map(tool => <span key={tool.name + tool.status} className="swarm-tool-item"><i className={tool.status} />{tool.name} - {statusLabel(tool.status)}</span>)}
                  </div>
                ) : null}
                {row.detail ? <p>{row.detail}</p> : null}
                {row.answer ? <details>
                  <summary>Worker result</summary>
                  <p>{row.answer}</p>
                  {row.evidenceSummary ? <small>{row.evidenceSummary}</small> : null}
                </details> : null}
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div className="swarm-empty">
          <span aria-hidden="true">+</span>
          <p>Start with a factual question. Worker activity and Tool names will appear here; hidden reasoning is never shown.</p>
        </div>
      )}

      {showFinalResult && state.result ? (
        <section className="swarm-result" aria-label="Swarm synthesis">
          <div className="swarm-result-head">
            <span className="swarm-badge">Final synthesis</span>
            <span>{state.result.status === 'partial' ? 'Partial evidence' : statusLabel(state.result.status)}</span>
          </div>
          {state.result.synthesis?.answer && sanitizeAdvisorModelOutput(state.result.synthesis.answer) ? <p>{sanitizeAdvisorModelOutput(state.result.synthesis.answer)}</p> : <p>No final synthesis was available; worker status and evidence are retained.</p>}
          {state.result.synthesis?.evidenceSummary ? <small>{sanitizeAdvisorDisplayText(state.result.synthesis.evidenceSummary, 1 * 1024)}</small> : null}
          {state.result.status === 'partial' ? <div className="swarm-partial-note">Some workers did not complete. The answer above is limited to the worker evidence that was available.</div> : null}
          <details>
            <summary>Evidence record</summary>
            <code>{state.result.evidence.evidenceDigest}</code>
            <span>Bounded digests, identities, statuses and Tool names only.</span>
          </details>
        </section>
      ) : null}
    </div>
  )
}
