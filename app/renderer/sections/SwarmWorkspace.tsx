import { useMemo, useState, type FormEvent } from 'react'
import type { SwarmEventV1, SwarmRunResultV1 } from '../../../src/swarm/contract-v1'
import type { SwarmRunState } from '../swarm/useSwarmRun'

type SwarmWorkspaceProps = {
  enabled: boolean
  runtimeLabel: string
  modelLabel: string
  state: SwarmRunState
  onRun: (task: string, workerCount?: number) => void
  onCancel: () => void
}

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
    }
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
    const current = workers.get(worker.workerId) ?? {
      workerId: worker.workerId,
      role: worker.role,
      status: worker.status,
      tools: [],
      detail: '',
    }
    current.status = worker.status
    current.tools = worker.toolActivity.map(tool => ({ name: tool.name, status: tool.status }))
    current.detail = worker.errors[0] ?? current.detail
    workers.set(worker.workerId, current)
  }
  return [...workers.values()].sort((left, right) => left.workerId.localeCompare(right.workerId))
}

export function SwarmWorkspace({ enabled, runtimeLabel, modelLabel, state, onRun, onCancel }: SwarmWorkspaceProps) {
  const [task, setTask] = useState('')
  const [workerCount, setWorkerCount] = useState(2)
  const rows = useMemo(() => eventRows(state.events, state.result), [state.events, state.result])
  const completeCount = rows.filter(row => row.status === 'completed').length
  const running = state.running
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onRun(task, workerCount)
    if (task.trim()) setTask('')
  }

  if (!enabled) {
    return (
      <div className="swarm-disabled" aria-label="Swarm unavailable">
        <span className="swarm-badge muted">Swarm - Soon</span>
        <h2>Experimental Swarm is not enabled</h2>
        <p>This development foundation is disabled in production builds until explicitly enabled.</p>
      </div>
    )
  }

  return (
    <div className="swarm-surface" aria-label="Experimental Swarm">
      <div className="swarm-head">
        <div>
          <span className="swarm-badge">Swarm - Experimental</span>
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

      <form className="swarm-task-form" onSubmit={submit}>
        <label htmlFor="swarm-task">Task</label>
        <textarea
          id="swarm-task"
          aria-label="Swarm task"
          placeholder="What should the workers investigate?"
          value={task}
          onChange={event => setTask(event.target.value)}
          disabled={running}
        />
        <div className="swarm-task-foot">
          <label htmlFor="swarm-worker-count">
            Workers
            <select id="swarm-worker-count" aria-label="Swarm worker count" value={workerCount} onChange={event => setWorkerCount(Number(event.target.value))} disabled={running}>
              <option value={2}>2 - default</option>
              <option value={3}>3 - maximum</option>
            </select>
          </label>
          <span>Read-only Tools - max 4 calls/worker - max 1 round/worker</span>
          <button className="advisor-send" type="submit" disabled={running || !task.trim()}>Start Swarm</button>
        </div>
      </form>

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

      {state.result ? (
        <section className="swarm-result" aria-label="Swarm synthesis">
          <div className="swarm-result-head">
            <span className="swarm-badge">Final synthesis</span>
            <span>{state.result.status === 'partial' ? 'Partial evidence' : statusLabel(state.result.status)}</span>
          </div>
          {state.result.synthesis?.answer ? <p>{state.result.synthesis.answer}</p> : <p>No final synthesis was available; worker status and evidence are retained.</p>}
          {state.result.synthesis?.evidenceSummary ? <small>{state.result.synthesis.evidenceSummary}</small> : null}
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
