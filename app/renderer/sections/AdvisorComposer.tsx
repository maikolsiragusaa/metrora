import type { FormEvent, KeyboardEvent } from 'react'

type AdvisorComposerProps = {
  composer: string
  loadingQuestion: string | null
  hostedSubmitBlockReason: string | null
  notice: string | null
  onChange: (value: string) => void
  onAsk: (question: string) => void
  onCancel: () => void
  submitLabel?: string
}

export function AdvisorComposer({
  composer,
  loadingQuestion,
  hostedSubmitBlockReason,
  notice,
  onChange,
  onAsk,
  onCancel,
  submitLabel = 'Send',
}: AdvisorComposerProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onAsk(composer)
  }
  const composerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onAsk(composer)
    }
  }

  return (
    <form className="advisor-composer" onSubmit={submit}>
      <textarea aria-label="Ask Metrora Harness" placeholder="Ask Metrora Harness anything…" value={composer} onChange={event => onChange(event.target.value)} onKeyDown={composerKeyDown} disabled={Boolean(loadingQuestion)} rows={2} />
      <div className="advisor-composer-foot">
        <span>Enter to send · Shift+Enter for a new line</span>
        {hostedSubmitBlockReason && composer.trim() && notice !== hostedSubmitBlockReason ? <span className="advisor-submit-note" role="status">{hostedSubmitBlockReason}</span> : null}
        {loadingQuestion ? <button type="button" className="advisor-cancel" onClick={onCancel}>Cancel</button> : <button type="submit" className="advisor-send" disabled={!composer.trim()}>{submitLabel} <span>↗</span></button>}
      </div>
    </form>
  )
}
