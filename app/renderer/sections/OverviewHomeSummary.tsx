import { useEffect, useRef } from 'react'
import gsap from 'gsap'

import { formatUsd } from '../lib/format'
import { motionEnabled } from '../lib/motion'
import type { MenubarPayload } from '../lib/types'
import type { OverviewDecision, OverviewDecisionFact, OverviewDecisionTarget } from './overviewDecision'

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

  return <div ref={ref} className="ov-hero-num" data-countup={value}>{formatUsd(value)}</div>
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
  const hasQualityWarning = decision.quality.tone === 'warn'
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
        <div className="ov-hero-sub">{current.calls.toLocaleString('en-US')} calls · {current.sessions.toLocaleString('en-US')} sessions</div>
        <p className="ov-home-primary-copy">Current cost and activity for the selected scope.</p>
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
          {hasQualityWarning ? <DecisionFact fact={decision.quality} /> : null}
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
