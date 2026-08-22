import { useEffect, useRef } from 'react'
import gsap from 'gsap'

import { formatCompact, formatUsd } from '../lib/format'
import { motionEnabled } from '../lib/motion'
import type { MenubarPayload } from '../lib/types'
import type { OverviewDecision, OverviewDecisionFact, OverviewDecisionTarget } from './overviewDecision'
import { deriveOverviewPricing, deriveOverviewUsage, type OverviewReasoning, type OverviewTokenMetric } from './overviewUsage'

function CountUp({ value, animateKey }: { value: number; animateKey: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const keyRef = useRef<string | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const keyChanged = keyRef.current !== animateKey
    keyRef.current = animateKey
    if (!keyChanged || !motionEnabled()) {
      element.textContent = formatUsd(value)
      return
    }
    const counter = { n: 0 }
    const tween = gsap.to(counter, {
      n: value,
      duration: 0.7,
      ease: 'power2.out',
      onUpdate: () => { element.textContent = formatUsd(counter.n) },
    })
    return () => { tween.kill() }
  }, [value, animateKey])

  return <div ref={ref} className="ov-hero-num" data-countup={value} data-testid="overview-hero-cost">{formatUsd(value)}</div>
}

function DecisionFact({
  fact,
  onNavigate,
}: {
  fact: OverviewDecisionFact
  onNavigate?: (target: OverviewDecisionTarget) => void
}) {
  const content = (
    <>
      <span>{fact.label}</span>
      <strong>{fact.value}</strong>
      <small>{fact.detail}</small>
    </>
  )
  if (!fact.target) {
    return <div className={`ov-home-fact ov-home-${fact.tone}`}>{content}</div>
  }
  return (
    <button
      type="button"
      className={`ov-home-fact ov-home-fact-button ov-home-${fact.tone}`}
      aria-label={`${fact.label}: ${fact.value}. ${fact.detail}`}
      onClick={() => onNavigate?.(fact.target as OverviewDecisionTarget)}
    >
      {content}
      <i aria-hidden="true">→</i>
    </button>
  )
}

function metricValue(metric: OverviewTokenMetric): string {
  return metric.value === null ? 'Unavailable' : formatCompact(metric.value)
}

function metricState(metric: OverviewTokenMetric): string {
  if (metric.state === 'partial') return 'Partial'
  if (metric.state === 'unavailable') return 'Unavailable'
  return 'Reported'
}

function UsageMetric({ label, metric, testId }: { label: string; metric: OverviewTokenMetric; testId: string }) {
  return (
    <div className={`ov-home-token-metric ov-home-token-${metric.state}`} data-testid={testId} data-state={metric.state}>
      <dt>{label}</dt>
      <dd><strong>{metricValue(metric)}</strong><small>{metricState(metric)}</small></dd>
    </div>
  )
}

function reasoningPresentation(reasoning: OverviewReasoning, usageState: OverviewTokenMetric['state']): { value: string; detail: string; state: OverviewTokenMetric['state'] } {
  if (reasoning.semantics === 'unavailable') {
    return { value: 'Unavailable', detail: 'No reasoning evidence was reported for this scope.', state: 'unavailable' }
  }
  if (reasoning.semantics === 'aggregate-output') {
    return {
      value: 'Included in output',
      detail: usageState === 'partial' ? 'Already included in Output; token detail is partial.' : 'Already included in Output; it is not counted again.',
      state: usageState === 'partial' ? 'partial' : 'available',
    }
  }
  if (reasoning.semantics === 'separate') {
    if (usageState === 'partial') {
      return { value: 'Partial', detail: 'Separate reasoning is evidenced for part of this scope.', state: 'partial' }
    }
    return {
      value: reasoning.observedTokens === null ? 'Unavailable' : formatCompact(reasoning.observedTokens),
      detail: 'Reported separately and included in total usage.',
      state: reasoning.observedTokens === null ? 'unavailable' : 'available',
    }
  }
  const observed = reasoning.observedTokens && reasoning.observedTokens > 0 ? ` ${formatCompact(reasoning.observedTokens)} observed.` : ''
  return {
    value: 'Partial',
    detail: `Reasoning evidence is mixed; only separately additive usage contributes to totals.${observed}`,
    state: 'partial',
  }
}

function CostDetails({ current }: { current: MenubarPayload['current'] }) {
  const usage = deriveOverviewUsage(current)
  const pricing = deriveOverviewPricing(current)
  const reasoning = reasoningPresentation(usage.reasoning, usage.input.state)

  return (
    <details className="ov-home-details" data-testid="overview-cost-details">
      <summary>
        <span>Cost details</span>
        <span className="ov-home-details-hint">View usage and pricing</span>
      </summary>
      <div className="ov-home-details-body">
        <section className="ov-home-detail-section" aria-labelledby="overview-usage-details-heading">
          <h3 id="overview-usage-details-heading">Usage details</h3>
          <dl className="ov-home-token-grid">
            <UsageMetric label="Input" metric={usage.input} testId="overview-token-input" />
            <UsageMetric label="Output" metric={usage.output} testId="overview-token-output" />
            <UsageMetric label="Cache read" metric={usage.cacheRead} testId="overview-token-cache-read" />
            <UsageMetric label="Cache write" metric={usage.cacheWrite} testId="overview-token-cache-write" />
            <div className={`ov-home-token-metric ov-home-token-${reasoning.state}`} data-testid="overview-token-reasoning" data-state={reasoning.state}>
              <dt>Reasoning</dt>
              <dd><strong>{reasoning.value}</strong><small>{reasoning.detail}</small></dd>
            </div>
          </dl>
          <p className="ov-home-detail-note">{usage.evidenceNote}</p>
        </section>

        <section className="ov-home-detail-section" aria-labelledby="overview-cost-details-heading">
          <h3 id="overview-cost-details-heading">Cost details</h3>
          <div className="ov-home-cost-list">
            <div className="ov-home-cost-row"><span>Current cost</span><strong>{formatUsd(current.cost)}</strong></div>
            <div className={`ov-home-cost-row ov-home-cost-${pricing.state}`}>
              <span>Pricing coverage</span>
              <strong>{pricing.label}</strong>
              <small>{pricing.detail}</small>
            </div>
          </div>
          <p className="ov-home-detail-note">This view explains measured usage and current pricing coverage. Historical price records and exact applied pricing context are not available in the Overview payload yet.</p>
        </section>
      </div>
    </details>
  )
}

export function OverviewHomeSummary({
  current,
  decision,
  streak,
  saved,
  applied,
  localSaved,
  animateKey,
  onNavigate,
}: {
  current: MenubarPayload['current']
  decision: OverviewDecision
  streak: number
  saved: number
  applied: number
  localSaved: number
  animateKey: string
  onNavigate?: (target: OverviewDecisionTarget) => void
}) {
  // pricing coverage used to occupy both the Data quality fact and the Material
  // warning slot. Keep one compact diagnostic fact, never duplicate the same
  // issue as a headline warning.
  const materialWarning = decision.warning.tone === 'warn' && decision.warning.value !== decision.quality.value

  return (
    <>
      <div className="ov-home-primary">
        <div className="ov-hero-top">
          <span className="ov-label">{current.label}</span>
          <span className="ov-streak"><b>{streak}</b>-day streak</span>
        </div>
        <CountUp value={current.cost} animateKey={animateKey} />
        <div className="ov-home-usage-summary" aria-label="Usage summary">
          <span className="ov-label">Usage</span>
          <strong>{current.calls.toLocaleString('en-US')} calls</strong>
          <span aria-hidden="true">·</span>
          <strong>{current.sessions.toLocaleString('en-US')} sessions</strong>
        </div>
        <p className="ov-home-primary-copy">Current cost and activity for the selected scope.</p>
        <CostDetails current={current} />
        {(saved > 0 || localSaved > 0) && (
          <div className="ov-home-savings">
            {saved > 0 ? (
              <div className="ov-saved-line"><span>Saved by applied fixes</span><strong>{formatUsd(saved)}</strong><small>across {applied} {applied === 1 ? 'fix' : 'fixes'}</small></div>
            ) : null}
            {localSaved > 0 ? (
              <div className="ov-saved-line"><span>Saved via local models</span><strong>{formatUsd(localSaved)}</strong><small>local-model routing</small></div>
            ) : null}
          </div>
        )}
      </div>

      <div className="ov-home-decision" aria-label="What changed and what matters next">
        <div className="ov-home-facts">
          <DecisionFact fact={decision.comparison} />
          <DecisionFact fact={decision.driver} onNavigate={onNavigate} />
        </div>
        {materialWarning ? (
          <div className={`ov-home-warning ov-home-${decision.warning.tone}`}>
            <span>{decision.warning.label}</span>
            <strong>{decision.warning.value}</strong>
            <small>{decision.warning.detail}</small>
          </div>
        ) : null}
        <div className="ov-home-next-action">
          <div>
            <span>{decision.nextAction.label}</span>
            <strong>{decision.nextAction.value}</strong>
            <small>{decision.nextAction.detail}</small>
          </div>
          {decision.nextAction.target ? (
            <button type="button" onClick={() => onNavigate?.(decision.nextAction.target as OverviewDecisionTarget)}>
              Open report →
            </button>
          ) : null}
        </div>
      </div>
    </>
  )
}
