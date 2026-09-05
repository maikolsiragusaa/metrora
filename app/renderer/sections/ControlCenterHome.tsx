import type { CSSProperties } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { formatCompact, formatDayShort, formatUsd } from '../lib/format'
import type { Section } from '../lib/desktopNavigation'
import type { MenubarPayload } from '../lib/types'
import heroMountains from '../assets/home/hero-mountains.png'
import opencodeCard from '../assets/home/card-opencode.png'
import companionCard from '../assets/home/card-companion.png'
import workflowsCard from '../assets/home/card-ai-workflows.png'

type HomeCurrent = MenubarPayload['current']

export function ControlCenterHome({ current, scope, providerLabel, onNavigate }: { current: HomeCurrent; scope: string; providerLabel: string; onNavigate?: (section: Section) => void }) {
  const models = current.topModels.slice(0, 5)
  const sessions = current.topSessions.slice(0, 4)
  const maxModelCost = Math.max(...models.map(model => model.cost), 0)

  return (
    <div className="control-center-home" aria-label="Metrora AI Control Center">
      <section className="control-center-hero" style={{ '--control-center-hero-image': `url(${heroMountains})` } as CSSProperties}>
        <div className="control-center-hero__content">
          <span className="eyebrow">{scope}</span>
          <h1>Metrora</h1>
          <p className="control-center-hero__title">AI Control Center</p>
          <p className="control-center-hero__copy">Observe usage, compare models, control capacity, and move into Code when you’re ready.</p>
          <div className="control-center-hero__actions">
            <button className="control-center-button control-center-button--primary" type="button" onClick={() => onNavigate?.('activity')}>View Activity <span aria-hidden="true">→</span></button>
            <button className="control-center-button control-center-button--quiet" type="button" onClick={() => onNavigate?.('code')}>Open Code <span aria-hidden="true">↗</span></button>
          </div>
          <div className="control-center-hero__meta"><span>Scope · {providerLabel}</span><span>Real local usage data</span></div>
        </div>
      </section>

      <section className="control-center-stats" aria-label="Scope summary">
        <HomeStat label="Spend" value={formatUsd(current.cost)} detail={current.label} />
        <HomeStat label="Sessions" value={formatCompact(current.sessions)} detail="tracked sessions" />
        <HomeStat label="Calls" value={formatCompact(current.calls)} detail="metered calls" />
        <HomeStat label="Models" value={formatCompact(current.topModels.length)} detail="with usage in scope" />
        <div className="control-center-stat control-center-stat--action">
          <span>Capacity</span>
          <strong>Provider-reported</strong>
          <button type="button" onClick={() => onNavigate?.('plans')}>Open Capacity <span aria-hidden="true">→</span></button>
        </div>
      </section>

      <section className="control-center-grid" aria-label="Usage overview">
        <div className="control-center-panel control-center-panel--activity">
          <div className="control-center-panel__head"><div><span className="eyebrow">Activity</span><h2>Recent activity</h2></div><button className="control-center-link" type="button" onClick={() => onNavigate?.('activity')}>See all →</button></div>
          {sessions.length ? (
            <div className="control-center-list">
              {sessions.map((session, index) => (
                <button className="control-center-list-row" type="button" key={`${session.project}-${session.date}-${index}`} onClick={() => onNavigate?.('sessions')}>
                  <span className="control-center-list-row__main"><strong>{session.project}</strong><small>{formatDayShort(session.date)} · {formatCompact(session.calls)} calls</small></span>
                  <span className="control-center-list-row__value">{formatUsd(session.cost)}</span>
                </button>
              ))}
            </div>
          ) : <EmptyNote>No sessions in this range yet.</EmptyNote>}
        </div>

        <div className="control-center-panel control-center-panel--models">
          <div className="control-center-panel__head"><div><span className="eyebrow">Models</span><h2>Usage mix</h2></div><button className="control-center-link" type="button" onClick={() => onNavigate?.('models')}>Open Models →</button></div>
          {models.length ? (
            <div className="control-center-model-list">
              {models.map(model => (
                <div className="control-center-model" key={model.name}>
                  <div className="control-center-model__label"><strong>{model.name}</strong><span>{formatUsd(model.cost)}</span></div>
                  <div className="control-center-model__track"><span style={{ width: `${maxModelCost > 0 ? Math.max(3, model.cost / maxModelCost * 100) : 0}%` }} /></div>
                  <small>{formatCompact(model.calls)} calls</small>
                </div>
              ))}
            </div>
          ) : <EmptyNote>No model usage in this range yet.</EmptyNote>}
        </div>

        <div className="control-center-panel control-center-panel--capacity">
          <div className="control-center-panel__head"><div><span className="eyebrow">Capacity</span><h2>Provider signals</h2></div><button className="control-center-link" type="button" onClick={() => onNavigate?.('plans')}>Open Capacity →</button></div>
          <div className="control-center-empty-card">
            <span className="control-center-empty-card__icon" aria-hidden="true">◎</span>
            <strong>Quota data stays provider-reported.</strong>
            <p>Open Capacity to inspect available provider plans and quota signals when they are available.</p>
            <button className="control-center-button control-center-button--small" type="button" onClick={() => onNavigate?.('plans')}>Inspect Capacity</button>
          </div>
        </div>
      </section>

      <section className="control-center-promos" aria-label="Metrora entry points">
        <HomePromoCard asset={opencodeCard} assetName="opencode-card" eyebrow="Code" title="Code surface" copy="Use the real Code entry point, powered by upstream OpenCode." action="Open Code" onClick={() => onNavigate?.('code')} />
        <HomePromoCard asset={companionCard} assetName="companion-card" eyebrow="Companion" title="Pair your Android device" copy="Reuse the existing local QR and verification flow." action="Open Companion" onClick={() => onNavigate?.('companion')} />
        <HomePromoCard asset={workflowsCard} assetName="ai-workflows-card" eyebrow="Explore Metrora" title="Work from grounded signals" copy="Move from usage context into Workspace, Models, and real workflow surfaces." action="Open Workspace" onClick={() => onNavigate?.('workspace')} />
      </section>
    </div>
  )
}

function HomeStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="control-center-stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function HomePromoCard({ asset, assetName, eyebrow, title, copy, action, onClick }: { asset: string; assetName: string; eyebrow: string; title: string; copy: string; action: string; onClick: () => void }) {
  return (
    <article className="control-center-promo" data-reference-asset={assetName} style={{ '--control-center-promo-image': `url(${asset})` } as CSSProperties}>
      <div className="control-center-promo__scrim" />
      <div className="control-center-promo__content">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
        <button className="control-center-button control-center-button--card" type="button" onClick={onClick}>{action} <span aria-hidden="true">→</span></button>
      </div>
    </article>
  )
}
