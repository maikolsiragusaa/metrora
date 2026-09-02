import type { AdvisorAnswer } from '../advisor/types'
import type { ReactNode } from 'react'

export function HarnessEvidenceDetails({ answer, onNextInvestigation, advanced }: { answer: AdvisorAnswer; onNextInvestigation?: (question: string) => void; advanced?: ReactNode }) {
  return (
    <details className="harness-v3-evidence-details">
      <summary><span>Sources &amp; details</span><small>Scope, sources, assumptions</small></summary>
      <div className="harness-v3-evidence-content">
        <div className={'harness-v3-coverage ' + answer.coverage.level}>
          <strong>{answer.coverage.label}</strong>
          <p>{answer.coverage.detail}</p>
        </div>
        <dl className="harness-v3-evidence-facts">
          <div><dt>Exact scope</dt><dd>{answer.scopeLabel}</dd></div>
          <div><dt>Period</dt><dd>{answer.periodLabel}</dd></div>
        </dl>
        <div className="harness-v3-evidence-group">
          <h4>Sources</h4>
          {answer.evidence.length ? <ul>{answer.evidence.map(ref => <li key={ref.id}><span aria-hidden="true" />{ref.label}</li>)}</ul> : <p>No source references were returned for this answer.</p>}
        </div>
        {answer.details.length ? <div className="harness-v3-evidence-group"><h4>Details</h4>{answer.details.map((item, index) => <p key={index}>{item}</p>)}</div> : null}
        {answer.why?.length ? <div className="harness-v3-evidence-group"><h4>Why</h4>{answer.why.slice(0, 6).map((item, index) => <p key={index}>{item}</p>)}</div> : null}
        {answer.materialLimits?.length ? <div className="harness-v3-evidence-group harness-v3-answer-limit"><h4>Important limit</h4>{answer.materialLimits.slice(0, 6).map((item, index) => <p key={index}>{item}</p>)}</div> : null}
        {answer.assumptions.length ? <div className="harness-v3-evidence-group"><h4>Assumptions</h4>{answer.assumptions.map((item, index) => <p key={index}>{item}</p>)}</div> : null}
        <div className="harness-v3-evidence-group">
          <h4>Unknowns</h4>
          {answer.unknown.length ? answer.unknown.map((item, index) => <p key={index}>{item}</p>) : <p>Nothing else was marked unknown for this answer.</p>}
        </div>
        {answer.nextInvestigations.length ? <div className="harness-v3-evidence-group"><h4>Related investigation</h4>{answer.nextInvestigations.map(item => onNextInvestigation ? <button type="button" className="harness-v3-detail-action" key={item} onClick={event => { event.stopPropagation(); onNextInvestigation(item) }}>{item}</button> : <p key={item}>{item}</p>)}</div> : null}
        {advanced ? <div className="harness-v3-evidence-group harness-v3-advanced-details"><h4>Advanced</h4>{advanced}</div> : null}
      </div>
    </details>
  )
}
