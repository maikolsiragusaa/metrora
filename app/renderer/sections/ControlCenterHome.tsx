import type { CSSProperties } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { ProviderLogo } from '../components/ProviderLogo'
import { formatCompact, formatDayShort, formatUsd, shortenProjectPath } from '../lib/format'
import type { Section } from '../lib/desktopNavigation'
import { quotaProviderName } from '../lib/quota-providers'
import type { MenubarPayload, QuotaProvider } from '../lib/types'
import heroMountains from '../assets/home/hero-mountains.png'
import opencodeCard from '../assets/home/card-opencode.png'
import companionCard from '../assets/home/card-companion.png'
import workflowsCard from '../assets/home/card-ai-workflows.png'

type HomeCurrent = MenubarPayload['current']

const MODEL_LOGO_KEYS: Record<string, string> = {
  openai: 'codex',
  anthropic: 'claude',
  google: 'gemini',
  moonshot: 'kimi',
  qwen: 'qwen',
}

function modelLogoKey(model: HomeCurrent['topModels'][number]): string | null {
  const identity = model.brandId ?? model.providerId
  if (!identity) return null
  const normalized = identity.trim().toLowerCase()
  return MODEL_LOGO_KEYS[normalized] ?? normalized
}

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

export function ControlCenterHome({ current, scope, providerLabel, quota, onNavigate, onShare }: { current: HomeCurrent; scope: string; providerLabel: string; quota: QuotaProvider[] | null; onNavigate?: (section: Section) => void; onShare?: () => void }) {
  const models = current.topModels.slice(0, 5)
  const sessions = current.topSessions.slice(0, 4)
  const maxModelCost = Math.max(...models.map(model => model.cost), 0)
  const capacityRows = (quota ?? []).flatMap(provider => provider.windows.slice(0, 2).map(window => ({ provider, window }))).slice(0, 4)

  return (
    <div className="control-center-home" aria-label="Metrora AI Control Center">
      <section className="control-center-hero" style={{ '--control-center-hero-image': `url(${heroMountains})` } as CSSProperties}>
        <div className="control-center-hero__content">
          <div className="control-center-hero__topline">
            <span className="eyebrow">{scope}</span>
          </div>
          <h1>Metrora</h1>
          <p className="control-center-hero__title">Your AI Control Center.</p>
          <p className="control-center-hero__copy">Observe usage, compare models, and control capacity.</p>
        </div>
      </section>

      <section className="control-center-stats" aria-label="Scope summary">
        <HomeStat icon="$" label="Spend" value={formatUsd(current.cost)} detail={current.label} />
        <HomeStat icon="◌" label="Sessions" value={formatCompact(current.sessions)} detail="tracked sessions" />
        <HomeStat icon="⌁" label="Calls" value={formatCompact(current.calls)} detail="metered calls" />
        <HomeStat icon="◇" label="Models" value={formatCompact(current.topModels.length)} detail="with usage in scope" />
        <div className="control-center-stat control-center-stat--action">
          <span className="control-center-stat__icon" aria-hidden="true">ϟ</span>
          <div className="control-center-stat__content">
            <span>Capacity</span>
            <strong>Provider-reported</strong>
            <button type="button" onClick={() => onNavigate?.('plans')}>Open Capacity <span aria-hidden="true">→</span></button>
          </div>
        </div>
      </section>

      <section className="control-center-grid" aria-label="Usage overview">
        <div className="control-center-panel control-center-panel--activity">
          <div className="control-center-panel__head">
            <div><span className="eyebrow">Activity</span><h2>Recent activity</h2></div>
            <div className="control-center-panel__actions">
              {onShare && <button className="control-center-share-action" type="button" title={`Share ${providerLabel} recap`} onClick={onShare}>Share recap</button>}
              <button className="control-center-link" type="button" onClick={() => onNavigate?.('activity')}>See all →</button>
            </div>
          </div>
          {sessions.length ? (
            <div className="control-center-list">
              {sessions.map((session, index) => (
                <button className="control-center-list-row" type="button" key={`${session.project}-${session.date}-${index}`} onClick={() => onNavigate?.('sessions')}>
                  <span className="control-center-list-row__marker" aria-hidden="true">✦</span>
                  <span className="control-center-list-row__main"><strong>{shortenProjectPath(session.project, 2)}</strong><small>{formatDayShort(session.date)} · {formatCompact(session.calls)} calls</small></span>
                  <span className="control-center-list-row__value">{formatUsd(session.cost)}</span>
                </button>
              ))}
            </div>
          ) : <EmptyNote>No sessions in this range yet.</EmptyNote>}
        </div>

        <div className="control-center-panel control-center-panel--models">
          <div className="control-center-panel__head"><div><span className="eyebrow">Models</span><h2>Usage mix</h2></div><button className="control-center-link" type="button" onClick={() => onNavigate?.('models')}>Open Models →</button></div>
          {models.length ? (
            <div className="control-center-model-chart">
              {models.map(model => {
                const share = current.cost > 0 ? model.cost / current.cost : 0
                const logo = modelLogoKey(model)
                return (
                  <div className="control-center-model" key={model.name} title={`${model.name}: ${formatUsd(model.cost)}, ${formatCompact(model.calls)} calls`}>
                    <span className="control-center-model__value">{share > 0 ? percent(share) : '—'}</span>
                    <div className="control-center-model__bar"><span style={{ height: `${maxModelCost > 0 ? Math.max(8, model.cost / maxModelCost * 100) : 0}%` }} /></div>
                    <span className="control-center-model__identity">{logo ? <ProviderLogo provider={logo} size={18} /> : <span className="control-center-model__fallback" aria-hidden="true">{model.name.slice(0, 1).toUpperCase()}</span>}<strong>{model.name}</strong></span>
                    <small>{formatCompact(model.calls)} calls</small>
                  </div>
                )
              })}
            </div>
          ) : <EmptyNote>No model usage in this range yet.</EmptyNote>}
        </div>

        <div className="control-center-panel control-center-panel--capacity">
          <div className="control-center-panel__head"><div><span className="eyebrow">Capacity</span><h2>Provider signals</h2></div><button className="control-center-link" type="button" onClick={() => onNavigate?.('plans')}>View all →</button></div>
          {capacityRows.length ? (
            <div className="control-center-capacity-list" aria-label="Provider-reported capacity">
              {capacityRows.map(({ provider, window }) => {
                const used = Math.max(0, Math.min(1, window.usedFraction))
                return (
                  <div className="control-center-capacity-row" key={`${provider.provider}-${window.id}`}>
                    <span className="control-center-capacity-row__identity"><ProviderLogo provider={provider.provider} size={18} /><span><strong>{quotaProviderName(provider.provider)}</strong><small>{window.label}{provider.freshness === 'stale' ? ' · stale' : ''}</small></span></span>
                    <span className="control-center-capacity-row__usage"><span className="control-center-capacity-row__track"><span style={{ width: `${used * 100}%` }} /></span><strong>{percent(used)}</strong></span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="control-center-empty-card">
              <span className="control-center-empty-card__icon" aria-hidden="true">◎</span>
              <strong>{quota === null ? 'Loading provider signals…' : 'No provider-reported quota is available.'}</strong>
              <p>Open Capacity to inspect provider plans and quota signals when they are available.</p>
              <button className="control-center-button control-center-button--small" type="button" onClick={() => onNavigate?.('plans')}>Inspect Capacity</button>
            </div>
          )}
        </div>
      </section>

      <section className="control-center-promos" aria-label="Metrora entry points">
        <HomePromoCard asset={opencodeCard} assetName="opencode-card" eyebrow="Code" title="OpenCode" copy="Your AI development surface, powered by upstream OpenCode." action="Open Code" onClick={() => onNavigate?.('code')} />
        <HomePromoCard asset={companionCard} assetName="companion-card" eyebrow="Companion" title="Metrora Companion" copy="Pair the existing Android companion with Metrora." action="Open Companion" onClick={() => onNavigate?.('companion')} />
        <HomePromoCard asset={workflowsCard} assetName="ai-workflows-card" eyebrow="Explore Metrora" title="Smarter AI workflows start here." copy="Move from real usage signals into Workspace and Models." action="Explore Metrora" onClick={() => onNavigate?.('workspace')} />
      </section>
    </div>
  )
}

function HomeStat({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
  return (
    <div className="control-center-stat">
      <span className="control-center-stat__icon" aria-hidden="true">{icon}</span>
      <div className="control-center-stat__content">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  )
}

function HomePromoCard({ asset, assetName, eyebrow, title, copy, action, onClick }: { asset: string; assetName: string; eyebrow: string; title: string; copy: string; action: string; onClick: () => void }) {
  return (
    <article className="control-center-promo" data-reference-asset={assetName} style={{ '--control-center-promo-image': `url(${asset})` } as CSSProperties}>
      <button className="control-center-promo__hit-area" type="button" aria-label={`${eyebrow}: ${title}. ${copy} ${action}.`} onClick={onClick}>
        <span className="metrora-sr-only">{title}. {copy} {action}.</span>
      </button>
    </article>
  )
}
