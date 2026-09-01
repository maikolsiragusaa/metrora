import { useState, type FormEvent, type KeyboardEvent } from 'react'

export function HarnessComposer({
  mode,
  swarmExperimentalEnabled,
  swarmRunning,
  loadingQuestion,
  hostedSubmitBlockReason,
  notice,
  composer,
  onModeChange,
  onComposerChange,
  onAsk,
  onSwarmRun,
  onCancel,
}: {
  mode: 'chat' | 'swarm'
  swarmExperimentalEnabled: boolean
  swarmRunning: boolean
  loadingQuestion: string | null
  hostedSubmitBlockReason: string | null
  notice: string | null
  composer: string
  onModeChange: (mode: 'chat' | 'swarm') => void
  onComposerChange: (value: string) => void
  onAsk: (question: string) => void
  onSwarmRun: (task: string, workerCount?: number) => boolean | void
  onCancel: () => void
}) {
  const [workerCount, setWorkerCount] = useState(2)
  const busy = Boolean(loadingQuestion || swarmRunning)
  const blocked = hostedSubmitBlockReason

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!composer.trim() || busy || blocked) return
    if (mode === 'swarm') {
      const started = onSwarmRun(composer, workerCount)
      if (started !== false) onComposerChange('')
    } else {
      onAsk(composer)
    }
  }

  const composerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="harness-v3-composer-region">
      <form className="harness-v3-composer" onSubmit={submit}>
        <textarea aria-label="Ask Metrora Harness" placeholder={mode === 'swarm' ? 'Describe a bounded investigation for Swarm…' : 'Ask Metrora Harness anything…'} value={composer} onChange={event => onComposerChange(event.target.value)} onKeyDown={composerKeyDown} disabled={busy} rows={3} />
        <div className="harness-v3-composer-toolbar">
          <div className="harness-v3-composer-options">
            <label className="harness-v3-strategy-control"><span>Strategy</span><select aria-label="Harness execution strategy" value={mode} onChange={event => onModeChange(event.target.value as 'chat' | 'swarm')} disabled={busy}><option value="chat">Chat</option><option value="swarm" disabled={!swarmExperimentalEnabled}>Swarm{swarmExperimentalEnabled ? '' : ' · Soon'}</option></select></label>
            {mode === 'swarm' && swarmExperimentalEnabled ? <label className="harness-v3-worker-count"><span>Workers</span><select aria-label="Swarm worker count" value={workerCount} onChange={event => setWorkerCount(Number(event.target.value))} disabled={busy}><option value={2}>2</option><option value={3}>3</option></select></label> : null}
          </div>
          <span className="harness-v3-composer-hint">Enter to send · Shift+Enter for a new line</span>
          {blocked && composer.trim() && notice !== blocked ? <span className="harness-v3-submit-note" role="status">{blocked}</span> : null}
          {busy ? <button type="button" className="harness-v3-quiet-button" onClick={onCancel}>Cancel</button> : <button type="submit" className="harness-v3-primary-button" disabled={!composer.trim() || Boolean(blocked)}>{mode === 'swarm' ? 'Run Swarm' : 'Send'} <span aria-hidden="true">↗</span></button>}
        </div>
      </form>
    </div>
  )
}
