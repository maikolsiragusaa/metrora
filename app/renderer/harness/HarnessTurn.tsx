import type { AdvisorAnswer, AdvisorPresentationBlockV1 } from '../advisor/types'
import type { MetroraHarnessActionEvent } from '../lib/metrora-bridge-types'
import { MetroraMark } from '../components/MetroraMark'
import { HarnessChartBlock } from './HarnessChartBlock'
import { HarnessEvidenceDetails } from './HarnessEvidenceDetails'

type HarnessActionDisplay = Pick<MetroraHarnessActionEvent, 'actionId' | 'proposalDigest' | 'model' | 'status'> & {
  runtime: MetroraHarnessActionEvent['runtime'] | null
  pack: MetroraHarnessActionEvent['pack'] | null
  checks: MetroraHarnessActionEvent['checks'] | null
  timeout: MetroraHarnessActionEvent['timeout'] | null
  cancellation: MetroraHarnessActionEvent['cancellation'] | null
  result: MetroraHarnessActionEvent['result'] | null
  failure: MetroraHarnessActionEvent['failure'] | null
}

function actionStatus(status: HarnessActionDisplay['status']): string {
  if (status === 'proposed') return 'Awaiting confirmation'
  if (status === 'ready') return 'Confirmed · queued'
  if (status === 'running') return 'Running canonical checks'
  if (status === 'completed') return 'Completed'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'unavailable') return 'Unavailable'
  return 'Failed'
}

function durationLabel(milliseconds: number): string {
  return milliseconds >= 1000 && milliseconds % 1000 === 0 ? String(milliseconds / 1000) + 's' : String(milliseconds) + 'ms'
}

function runtimeLabel(runtime: HarnessActionDisplay['runtime']): string {
  return runtime?.id === 'ollama-local' ? 'Ollama local · canonical runtime' : 'Canonical local runtime'
}

function packLabel(pack: HarnessActionDisplay['pack']): string {
  return pack ? pack.selector + ' · canonical Core Compatibility pack v' + pack.version : 'Canonical Core Compatibility pack'
}

function HarnessActionBlock({ action, busy, onConfirm, onCancel }: { action: HarnessActionDisplay; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const canCancel = action.status === 'proposed' || action.status === 'ready' || action.status === 'running'
  const counts = action.result?.counts
  const plannedChecks = action.checks?.planned ?? action.pack?.checks
  return (
    <section className="harness-v3-action" aria-label="Harness Core Compatibility confirmation" onClick={event => event.stopPropagation()}>
      <div className="harness-v3-action-head"><div><h4>Core Compatibility · Runtime Health</h4><p>Review this canonical ACT proposal for <strong>{action.model}</strong></p></div><span className={'harness-v3-action-status ' + action.status}>{actionStatus(action.status)}</span></div>
      <dl className="harness-v3-action-summary">
        <div><dt>Operation</dt><dd>Core Compatibility / Runtime Health</dd></div>
        <div><dt>Runtime</dt><dd>{runtimeLabel(action.runtime)}</dd></div>
        <div><dt>Model</dt><dd>{action.model}</dd></div>
        <div><dt>Methodology / pack</dt><dd>{packLabel(action.pack)}</dd></div>
        <div><dt>Checks planned</dt><dd>{plannedChecks === undefined ? 'Canonical pack count' : String(plannedChecks) + ' canonical checks' + (action.checks ? ' · ' + action.checks.completed + ' completed' : '')}</dd></div>
        <div><dt>Bounded effects</dt><dd>Loopback-only execution; writes action journal + canonical Bench history only; no repository/filesystem mutation, shell, credentials, arbitrary prompts, or endpoints.</dd></div>
        <div><dt>Timeout</dt><dd>{action.timeout ? 'Up to ' + durationLabel(action.timeout.perRequestMs) + ' per request; ' + durationLabel(action.timeout.operationMs) + ' for the full operation.' : 'Bounded per-request and full-operation timeouts.'}</dd></div>
        <div><dt>Cancellation</dt><dd>{action.cancellation?.requested ? 'Cancellation requested. ' : 'Can be cancelled. '}Late results do not override terminal cancellation or timeout semantics.</dd></div>
      </dl>
      <p className="harness-v3-action-digest">Proposal digest · {action.proposalDigest.slice(0, 12)}…</p>
      <div className="harness-v3-action-actions">
        {action.status === 'proposed' ? <button type="button" className="harness-v3-primary-button" disabled={busy} onClick={onConfirm}>{busy ? 'Confirming…' : 'Confirm and run'}</button> : null}
        {canCancel ? <button type="button" className="harness-v3-quiet-button" disabled={busy} onClick={onCancel}>{busy ? 'Cancelling…' : 'Cancel operation'}</button> : null}
      </div>
      {counts ? <p className="harness-v3-action-result">Result · {counts.passed} passed · {counts.failed} failed · {counts.unavailable} unavailable · {counts.cancelled} cancelled</p> : null}
      {action.failure ? <p className="harness-v3-action-failure">Status detail · {action.failure.category} · {action.failure.message}</p> : null}
    </section>
  )
}

function PresentationBlocks({ blocks }: { blocks: AdvisorPresentationBlockV1[] }) {
  return <div className="harness-v3-presentation">{blocks.map((block, index) => {
    if (block.kind === 'text') return <p className="harness-v3-presentation-text" key={index}>{block.text}</p>
    if (block.kind === 'metric-cards') return <section className="harness-v3-presentation-block" key={index}><div className="harness-v3-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><div className="harness-v3-metric-grid">{block.cards.map(card => <div className="harness-v3-metric" key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.unit}</small><p>{card.detail}</p></div>)}</div></section>
    if (block.kind === 'line-chart' || block.kind === 'bar-chart') return <HarnessChartBlock block={block} key={index} />
    if (block.kind === 'comparison-table') return <section className="harness-v3-presentation-block" key={index}><div className="harness-v3-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><p className="harness-v3-presentation-summary">{block.summary}</p><div className="harness-v3-table-wrap"><table><caption className="sr-only">{block.title}</caption><thead><tr>{block.table.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{block.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div></section>
    if (block.kind === 'quota-card') return <section className="harness-v3-presentation-block" key={index}><div className="harness-v3-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><p className="harness-v3-presentation-summary">{block.summary}</p><div className="harness-v3-quota-grid">{block.providers.map(provider => <div className="harness-v3-quota" key={provider.provider}><strong>{provider.provider}</strong>{provider.planLabel ? <span>{provider.planLabel}</span> : null}{provider.windows.map(window => <span key={window.id}>{window.label} · {window.remainingPercent}% remaining{window.resetsAt ? ' · reset ' + window.resetsAt : ''}</span>)}{provider.creditsUSD !== null ? <span>Credits · ${provider.creditsUSD.toFixed(2)}</span> : null}</div>)}</div></section>
    if (block.kind === 'bench-summary') {
      const performance = block.performance
      const latestPerformance = performance?.latest
      const prefill = latestPerformance?.workloads.find(item => item.workload === 'prefill')
      const decode = latestPerformance?.workloads.find(item => item.workload === 'decode')
      return <section className="harness-v3-presentation-block" key={index}><div className="harness-v3-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><p className="harness-v3-presentation-summary">{block.summary}</p>{block.run ? <div className="harness-v3-bench-summary"><strong>{block.run.model.selected}</strong><span>{block.run.aggregate.passed}/{block.run.aggregate.planned} planned tasks passed</span><span>{block.run.aggregate.scoreValue === null ? 'Score unavailable' : block.run.aggregate.scoreDenominator === null ? (block.run.aggregate.scoreValue * 100).toFixed(1) + '% score' : (block.run.aggregate.scoreValue * 100).toFixed(1) + '% of ' + block.run.aggregate.scoreDenominator + ' scored checks'}</span><span>Status · {block.run.status}</span></div> : <p className="harness-v3-muted">No completed Core conformance run is available.</p>}{latestPerformance ? <div className="harness-v3-bench-summary"><strong>Performance · {latestPerformance.model.selected}</strong><span>Prefill · {prefill?.throughputTokensPerSecond === null || prefill?.throughputTokensPerSecond === undefined ? 'unavailable' : prefill.throughputTokensPerSecond.toFixed(1) + ' tokens/s'}</span><span>Decode · {decode?.throughputTokensPerSecond === null || decode?.throughputTokensPerSecond === undefined ? 'unavailable' : decode.throughputTokensPerSecond.toFixed(1) + ' tokens/s'}</span><span>Status · {latestPerformance.status}</span></div> : null}</section>
    }
    if (block.kind === 'warning' || block.kind === 'evidence-disclosure') return <section className="harness-v3-presentation-block harness-v3-presentation-warning" key={index}><h4>{block.title}</h4><p>{block.text}</p></section>
    return null
  })}</div>
}

export function HarnessTurn({ answer, selected, onSelect, onFollowUp, onNextInvestigation, harnessAction, actionBusy, onConfirmHarnessAction, onCancelHarnessAction }: {
  answer: AdvisorAnswer
  selected: boolean
  onSelect: () => void
  onFollowUp: (next: string) => void
  onNextInvestigation?: (question: string) => void
  harnessAction?: MetroraHarnessActionEvent | null
  actionBusy: boolean
  onConfirmHarnessAction: (actionId: string, proposalDigest: string) => void
  onCancelHarnessAction: (actionId: string) => void
}) {
  const proposal = answer.actionProposal?.harnessAction
  const action: HarnessActionDisplay | null = proposal || harnessAction
    ? {
        actionId: harnessAction?.actionId ?? proposal!.actionId,
        proposalDigest: harnessAction?.proposalDigest ?? proposal!.proposalDigest,
        model: harnessAction?.model ?? proposal!.model,
        status: harnessAction?.status ?? proposal!.status,
        runtime: harnessAction?.runtime ?? null,
        pack: harnessAction?.pack ?? null,
        checks: harnessAction?.checks ?? null,
        timeout: harnessAction?.timeout ?? null,
        cancellation: harnessAction?.cancellation ?? null,
        result: harnessAction?.result ?? null,
        failure: harnessAction?.failure ?? null,
      }
    : null
  return (
    <article className={selected ? 'harness-v3-turn harness-v3-assistant-turn selected assistant-message' : 'harness-v3-turn harness-v3-assistant-turn assistant-message'} onClick={onSelect}>
      <div className="harness-v3-turn-label"><MetroraMark size={20} /><span>Metrora Harness</span><small>{answer.generatedByModel ? (answer.evidence.length ? 'model-assisted explanation' : 'model-assisted chat') : 'offline evidence'}</small></div>
      <p className="harness-v3-conclusion">{answer.conclusion}</p>
      <div className="harness-v3-answer-meta"><span className={'harness-v3-coverage-pill ' + answer.coverage.level}>{answer.coverage.label}</span><span>{answer.scopeLabel}</span></div>
      {answer.presentation?.length ? <PresentationBlocks blocks={answer.presentation} /> : null}
      {answer.actionProposal?.kind === 'run-core-compatibility' && action ? <HarnessActionBlock action={action} busy={actionBusy} onConfirm={() => onConfirmHarnessAction(action.actionId, action.proposalDigest)} onCancel={() => onCancelHarnessAction(action.actionId)} /> : null}
      {answer.why?.length ? <section className="harness-v3-answer-section"><h4>Why</h4>{answer.why.slice(0, 2).map((item, index) => <p key={index}>{item}</p>)}</section> : null}
      {answer.materialLimits?.length ? <section className="harness-v3-answer-section harness-v3-answer-limit"><h4>Important limit</h4>{answer.materialLimits.slice(0, 2).map((item, index) => <p key={index}>{item}</p>)}</section> : null}
      {answer.nextInvestigations.length ? <div className="harness-v3-followups"><span>Next step</span>{answer.nextInvestigations.map(next => <button type="button" key={next} onClick={event => { event.stopPropagation(); onFollowUp(next) }}>{next}</button>)}</div> : null}
      <HarnessEvidenceDetails answer={answer} onNextInvestigation={onNextInvestigation} />
    </article>
  )
}
