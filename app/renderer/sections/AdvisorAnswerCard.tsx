import { periodLabel } from '../advisor/evidence'
import type { AdvisorAnswer, AdvisorPresentationBlockV1, AdvisorScope, AdvisorToolEvent } from '../advisor/types'
import type { MetroraHarnessActionEvent } from '../lib/metrora-bridge-types'
import { AdvisorChartBlock } from './advisor-chart'

export type HarnessToolActivity = AdvisorToolEvent

export function harnessToolLabel(name: string, scope: AdvisorScope): string {
  const labels: Record<string, string> = {
    get_spend_snapshot: 'Reading Usage',
    get_model_efficiency: 'Reading Model efficiency',
    get_quota_snapshot: 'Reading Provider capacity',
    get_overview_snapshot: 'Reading Overview',
    get_project_drivers: 'Reading Project drivers',
    get_session_highlights: 'Reading Session highlights',
    get_coverage_report: 'Checking Evidence coverage',
    get_bench_evidence: 'Reading Bench evidence',
  }
  return (labels[name] ?? 'Reading Metrora evidence') + ' · ' + periodLabel(scope)
}

function harnessActivityStatus(status: HarnessToolActivity['status']): string {
  if (status === 'queued') return 'queued'
  if (status === 'started') return 'in progress'
  if (status === 'completed') return 'ready'
  if (status === 'unavailable') return 'unavailable'
  if (status === 'cancelled') return 'cancelled'
  return 'failed'
}

export function ToolActivity({ items, scope }: { items: readonly HarnessToolActivity[]; scope: AdvisorScope }) {
  if (!items.length) return null
  return <div className="advisor-tool-activity" aria-label="Harness tool activity">{items.map(item => <div className="advisor-tool-activity-row" key={item.name}><span aria-hidden="true" className={'advisor-tool-activity-dot ' + item.status} /> <span>{harnessToolLabel(item.name, scope)}</span><small>{harnessActivityStatus(item.status)}</small></div>)}</div>
}

type HarnessActionDisplay = Pick<MetroraHarnessActionEvent, 'actionId' | 'proposalDigest' | 'model' | 'status'> & {
  runtime: MetroraHarnessActionEvent['runtime'] | null
  pack: MetroraHarnessActionEvent['pack'] | null
  checks: MetroraHarnessActionEvent['checks'] | null
  timeout: MetroraHarnessActionEvent['timeout'] | null
  cancellation: MetroraHarnessActionEvent['cancellation'] | null
  result: MetroraHarnessActionEvent['result'] | null
  failure: MetroraHarnessActionEvent['failure'] | null
}

function harnessActionStatus(status: HarnessActionDisplay['status']): string {
  if (status === 'proposed') return 'Awaiting your confirmation'
  if (status === 'ready') return 'Confirmed · queued'
  if (status === 'running') return 'Running canonical checks'
  if (status === 'completed') return 'Completed'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'unavailable') return 'Unavailable'
  return 'Failed'
}

function durationLabel(milliseconds: number): string {
  return milliseconds >= 1000 && milliseconds % 1000 === 0
    ? String(milliseconds / 1000) + 's'
    : String(milliseconds) + 'ms'
}

function runtimeLabel(runtime: HarnessActionDisplay['runtime']): string {
  return runtime?.id === 'ollama-local' ? 'Ollama local · canonical runtime' : 'Canonical local runtime'
}

function packLabel(pack: HarnessActionDisplay['pack']): string {
  return pack
    ? pack.selector + ' · canonical Core Compatibility pack v' + pack.version
    : 'Canonical Core Compatibility pack'
}

function HarnessActionBlock({ action, busy, onConfirm, onCancel }: {
  action: HarnessActionDisplay
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const canCancel = action.status === 'proposed' || action.status === 'ready' || action.status === 'running'
  const counts = action.result?.counts
  const plannedChecks = action.checks?.planned ?? action.pack?.checks
  return (
    <section className="advisor-harness-action" aria-label="Harness Core Compatibility confirmation" onClick={event => event.stopPropagation()}>
      <div className="advisor-harness-action-head"><div><h4>Core Compatibility · Runtime Health</h4><p>Review this canonical ACT proposal for <strong>{action.model}</strong></p></div><span className={'advisor-harness-action-status ' + action.status}>{harnessActionStatus(action.status)}</span></div>
      <dl className="advisor-harness-action-summary">
        <div><dt>Operation</dt><dd>Core Compatibility / Runtime Health</dd></div>
        <div><dt>Runtime</dt><dd>{runtimeLabel(action.runtime)}</dd></div>
        <div><dt>Model</dt><dd>{action.model}</dd></div>
        <div><dt>Methodology / pack</dt><dd>{packLabel(action.pack)}</dd></div>
        <div><dt>Checks planned</dt><dd>{plannedChecks === undefined ? 'Canonical pack count' : String(plannedChecks) + ' canonical checks' + (action.checks ? ' · ' + action.checks.completed + ' completed' : '')}</dd></div>
        <div><dt>Bounded effects</dt><dd>Loopback-only execution; writes action journal + canonical Bench history only; no repository/filesystem mutation, shell, credentials, arbitrary prompts, or endpoints.</dd></div>
        <div><dt>Timeout</dt><dd>{action.timeout ? 'Up to ' + durationLabel(action.timeout.perRequestMs) + ' per request; ' + durationLabel(action.timeout.operationMs) + ' for the full operation.' : 'Bounded per-request and full-operation timeouts.'}</dd></div>
        <div><dt>Cancellation</dt><dd>{action.cancellation?.requested ? 'Cancellation requested. ' : 'Can be cancelled. '}Late results do not override terminal cancellation or timeout semantics.</dd></div>
      </dl>
      <p className="advisor-harness-action-digest">Proposal digest · {action.proposalDigest.slice(0, 12)}…</p>
      {action.status === 'proposed' ? <button type="button" className="advisor-harness-action-confirm" disabled={busy} onClick={onConfirm}>{busy ? 'Confirming…' : 'Confirm and run'}</button> : null}
      {canCancel ? <button type="button" className="advisor-harness-action-cancel" disabled={busy} onClick={onCancel}>{busy ? 'Cancelling…' : 'Cancel operation'}</button> : null}
      {counts ? <p className="advisor-harness-action-result">Result · {counts.passed} passed · {counts.failed} failed · {counts.unavailable} unavailable · {counts.cancelled} cancelled</p> : null}
      {action.failure ? <p className="advisor-harness-action-failure">Status detail · {action.failure.category} · {action.failure.message}</p> : null}
    </section>
  )
}

function displayAnswer(answer: AdvisorAnswer): string {
  return answer.conclusion
}

function PresentationBlocks({ blocks }: { blocks: AdvisorPresentationBlockV1[] }) {
  return <div className="advisor-presentation">{blocks.map((block, index) => {
    if (block.kind === 'text') return <p className="advisor-presentation-text" key={index}>{block.text}</p>
    if (block.kind === 'metric-cards') return <section className="advisor-presentation-block" key={index}><div className="advisor-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><div className="advisor-metric-grid">{block.cards.map(card => <div className="advisor-metric-card" key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.unit}</small><p>{card.detail}</p></div>)}</div></section>
    if (block.kind === 'line-chart' || block.kind === 'bar-chart') return <AdvisorChartBlock block={block} key={index} />
    if (block.kind === 'comparison-table') return <section className="advisor-presentation-block" key={index}><div className="advisor-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><p className="advisor-presentation-summary">{block.summary}</p><div className="advisor-table-wrap"><table><caption className="sr-only">{block.title}</caption><thead><tr>{block.table.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{block.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div></section>
    if (block.kind === 'quota-card') return <section className="advisor-presentation-block" key={index}><div className="advisor-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><p className="advisor-presentation-summary">{block.summary}</p><div className="advisor-quota-grid">{block.providers.map(provider => <div className="advisor-quota-item" key={provider.provider}><strong>{provider.provider}</strong>{provider.planLabel ? <span>{provider.planLabel}</span> : null}{provider.windows.map(window => <span key={window.id}>{window.label} · {window.remainingPercent}% remaining{window.resetsAt ? ' · reset ' + window.resetsAt : ''}</span>)}{provider.creditsUSD !== null ? <span>Credits · ${provider.creditsUSD.toFixed(2)}</span> : null}</div>)}</div></section>
    if (block.kind === 'bench-summary') {
      const performance = block.performance
      const latestPerformance = performance?.latest
      const prefill = latestPerformance?.workloads.find(item => item.workload === 'prefill')
      const decode = latestPerformance?.workloads.find(item => item.workload === 'decode')
      return <section className="advisor-presentation-block" key={index}><div className="advisor-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div><p className="advisor-presentation-summary">{block.summary}</p>{block.run ? <div className="advisor-bench-summary"><strong>{block.run.model.selected}</strong><span>{block.run.aggregate.passed}/{block.run.aggregate.planned} planned tasks passed</span><span>{block.run.aggregate.scoreValue === null ? 'Score unavailable' : block.run.aggregate.scoreDenominator === null ? (block.run.aggregate.scoreValue * 100).toFixed(1) + '% score' : (block.run.aggregate.scoreValue * 100).toFixed(1) + '% of ' + block.run.aggregate.scoreDenominator + ' scored checks'}</span><span>Status · {block.run.status}</span></div> : <p className="advisor-muted-line">No completed Core conformance run is available.</p>}{latestPerformance ? <div className="advisor-bench-summary"><strong>Performance · {latestPerformance.model.selected}</strong><span>Prefill · {prefill?.throughputTokensPerSecond === null || prefill?.throughputTokensPerSecond === undefined ? 'unavailable' : prefill.throughputTokensPerSecond.toFixed(1) + ' tokens/s'}</span><span>Decode · {decode?.throughputTokensPerSecond === null || decode?.throughputTokensPerSecond === undefined ? 'unavailable' : decode.throughputTokensPerSecond.toFixed(1) + ' tokens/s'}</span><span>Status · {latestPerformance.status}</span></div> : null}</section>
    }
    if (block.kind === 'warning' || block.kind === 'evidence-disclosure') return <section className="advisor-presentation-block advisor-presentation-warning" key={index}><h4>{block.title}</h4><p>{block.text}</p></section>
    return null
  })}</div>
}

export function AnswerCard({ answer, selected, onSelect, onFollowUp, harnessAction, actionBusy, onConfirmHarnessAction, onCancelHarnessAction }: {
  answer: AdvisorAnswer
  selected: boolean
  onSelect: () => void
  onFollowUp: (next: string) => void
  harnessAction?: MetroraHarnessActionEvent | null
  actionBusy: boolean
  onConfirmHarnessAction: (actionId: string, proposalDigest: string) => void
  onCancelHarnessAction: (actionId: string) => void
}) {
  const why = answer.why ?? []
  const limits = answer.materialLimits ?? []
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
    <article className={selected ? 'advisor-message assistant-message selected' : 'advisor-message assistant-message'} onClick={onSelect}>
      <div className="advisor-message-label"><span className="advisor-mini-mark">M</span> Metrora Harness <small>{answer.generatedByModel ? (answer.evidence.length ? 'model-assisted explanation' : 'model-assisted chat') : 'offline evidence'}</small></div>
      <p className="advisor-conclusion">{displayAnswer(answer)}</p>
      <div className="advisor-answer-meta"><span className={'advisor-coverage ' + answer.coverage.level}>{answer.coverage.label}</span><span>{answer.scopeLabel}</span></div>
      {answer.presentation?.length ? <PresentationBlocks blocks={answer.presentation} /> : null}
      {answer.actionProposal?.kind === 'run-core-compatibility' && action ? <HarnessActionBlock action={action} busy={actionBusy} onConfirm={() => onConfirmHarnessAction(action.actionId, action.proposalDigest)} onCancel={() => onCancelHarnessAction(action.actionId)} /> : null}
      {why.length ? <section className="advisor-answer-section"><h4>Why</h4>{why.slice(0, 2).map((item, index) => <p key={index}>{item}</p>)}</section> : null}
      {limits.length ? <section className="advisor-answer-section advisor-answer-limit"><h4>Important limit</h4>{limits.slice(0, 2).map((item, index) => <p key={index}>{item}</p>)}</section> : null}
      {answer.nextInvestigations.length ? <div className="advisor-followups"><span>Next step</span>{answer.nextInvestigations.map(next => <button type="button" key={next} onClick={event => { event.stopPropagation(); onFollowUp(next) }}>{next}</button>)}</div> : null}
      <details onClick={event => event.stopPropagation()}>
        <summary>Evidence & details</summary>
        <div className="advisor-details">{answer.details.map((detail, index) => <div key={index}>{detail}</div>)}</div>
        <div className="advisor-limits"><strong>Unknown</strong>{answer.unknown.map((item, index) => <div key={index}>{item}</div>)}</div>
      </details>
    </article>
  )
}
