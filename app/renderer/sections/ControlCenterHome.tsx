import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { ProviderLogo } from '../components/ProviderLogo'
import { formatCompact, formatDayShort, formatUsd, shortenProjectPath } from '../lib/format'
import type { Section } from '../lib/desktopNavigation'
import { metrora } from '../lib/ipc'
import { identityModelHouse, modelHouseLogoKey } from '../lib/modelPresentation'
import { quotaProviderName } from '../lib/quota-providers'
import { formatProviderLabel, providerLogoKey } from '../lib/providerPresentation'
import { totalTokenCount } from '../lib/usageMetrics'
import { usePolled } from '../hooks/usePolled'
import type { MenubarPayload, Period, QuotaProvider } from '../lib/types'
import type { SessionRow } from '../lib/types'
import { displayNameFromWorkspaceStatus, greetingForHour } from '../lib/home-greeting'
import heroMountains from '../assets/home/hero-mountains.png'
import opencodeCard from '../assets/home/card-opencode.png'
import companionCard from '../assets/home/card-companion.png'
import workflowsCard from '../assets/home/card-ai-workflows.png'

type HomeCurrent = MenubarPayload['current']

// Bar gradients keyed by the brand logo key, using each brand's own colors.
const MODEL_BAR_PALETTES: Record<string, [string, string]> = {
  codex: ['#f5f6f8', '#c9cdd6'],          // OpenAI white
  claude: ['#f2bd9b', '#d97757'],         // Anthropic clay orange
  gemini: ['#8ab4f8', '#4285f4'],         // Google blue
  zai: ['#e8edf5', '#8b95a1'],            // Z.ai monochrome steel
  deepseek: ['#8ba1ff', '#4d6bfe'],       // DeepSeek blue
  qwen: ['#a396ff', '#615ced'],           // Qwen violet
  kimi: ['#d9f67e', '#7ee787'],           // Moonshot/Kimi lime
  'mistral-vibe': ['#ffb35c', '#fa500f'], // Mistral orange
  grok: ['#d6d6d6', '#555555'],           // xAI black/white
  meta: ['#57a4ff', '#0064e0'],           // Meta blue
  microsoft: ['#50b8f0', '#00a4ef'],      // Microsoft blue
  cohere: ['#8fc0a9', '#39594d'],         // Cohere forest green
  minimax: ['#ff86a5', '#ec4176'],        // MiniMax pink-red
  ai21: ['#ff7d7d', '#c42b44'],           // AI21 crimson
  cursor: ['#d8d5cc', '#8f8c80'],         // Cursor monochrome warm ink
  nvidia: ['#aede57', '#76b900'],         // NVIDIA green
  xiaomi: ['#ff9a5c', '#ff6900'],         // Xiaomi orange
  poolside: ['#a48fff', '#6e56cf'],       // Poolside indigo
  'amazon-bedrock': ['#3ec3aa', '#01a88d'], // AWS Bedrock teal
}

const FALLBACK_MODEL_BAR_PALETTES: Array<[string, string]> = [
  ['#b48cff', '#704dff'],
  ['#ffad7c', '#ff7a58'],
  ['#67b5ff', '#2c7ff0'],
  ['#59e0dd', '#20b9c7'],
  ['#a5b4cf', '#687895'],
]

type ModelIdentitySource = { name: string; brandId?: string; providerId?: string }

function modelLogoKey(model: ModelIdentitySource): string | null {
  const house = identityModelHouse(model.name, model.brandId ?? model.providerId)
  return house ? modelHouseLogoKey(house) : null
}

function modelBarPalette(model: ModelIdentitySource, index: number): [string, string] {
  const key = modelLogoKey(model)
  return MODEL_BAR_PALETTES[key ?? ''] ?? FALLBACK_MODEL_BAR_PALETTES[index % FALLBACK_MODEL_BAR_PALETTES.length]
}

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

type UsageMixClient = { id: string; label: string; logo: string; tokens: number; calls: number; share: number; palette: [string, string] }

type UsageMixBar = {
  name: string
  logo: string | null
  palette: [string, string]
  value: string
  height: number
  title: string
  /** Light gradients take dark ink for the in-bar value. */
  light: boolean
}

type UsageMixSlide =
  | { kind: 'models'; id: string; caption: string; bars: UsageMixBar[] }
  | { kind: 'clients'; id: string; caption: string; entries: UsageMixClient[] }

const USAGE_MIX_TOP_LIMIT = 10

function paletteLuminance([start]: [string, string]): number {
  const hex = start.replace('#', '')
  const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = channels.map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function compactUsd(value: number): string {
  if (value >= 1_000) return `${formatUsd(Math.round(value / 100) / 10)}K`.replace('.0K', 'K')
  return formatUsd(value)
}

/** Slides for the Home Usage mix carousel: the top model by total tokens, the
 * top model by cost, and the most-used clients ranked by total tokens. */
export function buildUsageMixSlides(current: HomeCurrent, sessions: SessionRow[] | null | undefined): UsageMixSlide[] {
  const slides: UsageMixSlide[] = []
  const presentationRows = current.modelPresentation?.rows ?? []

  if (presentationRows.length > 0) {
    const totals = presentationRows.map(row => ({ row, tokens: row.tokenDetail ? totalTokenCount(row) : 0 }))
    const tokenSum = totals.reduce((sum, entry) => sum + entry.tokens, 0)
    const ranked = [...totals].sort((a, b) => b.tokens - a.tokens).slice(0, USAGE_MIX_TOP_LIMIT)
    const maxTokens = ranked[0]?.tokens ?? 0
    if (tokenSum > 0 && maxTokens > 0) {
      slides.push({
        kind: 'models',
        id: 'tokens',
        caption: 'Top models by total tokens',
        bars: ranked.map(entry => {
          const share = entry.tokens / tokenSum
          const palette = modelBarPalette(entry.row, 0)
          return {
            name: entry.row.name,
            logo: modelLogoKey(entry.row),
            palette,
            value: formatCompact(entry.tokens),
            height: entry.tokens / maxTokens,
            title: `${entry.row.name}: ${formatCompact(entry.tokens)} total tokens (${percent(share)} of metered tokens), ${formatCompact(entry.row.calls)} calls`,
            light: paletteLuminance(palette) > 0.62,
          }
        }),
      })
    }
  }

  const rankedByCost = [...current.topModels].sort((a, b) => b.cost - a.cost).slice(0, USAGE_MIX_TOP_LIMIT)
  const maxCost = rankedByCost[0]?.cost ?? 0
  if (current.cost > 0 && maxCost > 0) {
    slides.push({
      kind: 'models',
      id: 'cost',
      caption: 'Top models by cost',
      bars: rankedByCost.map(model => {
        const share = model.cost / current.cost
        const palette = modelBarPalette(model, 0)
        return {
          name: model.name,
          logo: modelLogoKey(model),
          palette,
          value: compactUsd(model.cost),
          height: model.cost / maxCost,
          title: `${model.name}: ${formatUsd(model.cost)} (${percent(share)} of cost), ${formatCompact(model.calls)} calls`,
          light: paletteLuminance(palette) > 0.62,
        }
      }),
    })
  }

  if (sessions && sessions.length > 0) {
    const byClient = new Map<string, { tokens: number; calls: number }>()
    for (const row of sessions) {
      const entry = byClient.get(row.provider) ?? { tokens: 0, calls: 0 }
      entry.tokens += totalTokenCount(row)
      entry.calls += row.calls
      byClient.set(row.provider, entry)
    }
    const entries = [...byClient.entries()]
      .map(([id, totals]) => ({ id, ...totals }))
      .filter(entry => entry.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5)
    const max = entries[0]?.tokens ?? 0
    if (entries.length > 0) {
      slides.push({
        kind: 'clients',
        id: 'clients',
        caption: 'Most used clients',
        entries: entries.map((entry, index) => ({
          id: entry.id,
          label: formatProviderLabel(entry.id),
          logo: providerLogoKey(entry.id),
          tokens: entry.tokens,
          calls: entry.calls,
          share: max > 0 ? entry.tokens / max : 0,
          palette: FALLBACK_MODEL_BAR_PALETTES[index % FALLBACK_MODEL_BAR_PALETTES.length],
        })),
      })
    }
  }
  return slides
}

const USAGE_MIX_SLIDE_INTERVAL_MS = 5_000
const USAGE_MIX_BAR_AREA_PX = 110

/** Auto-sliding carousel with a modern eased transition; hovering pauses it,
 * dots jump directly, and reduced-motion users get an instant swap. */
export function UsageMixCarousel({ slides }: { slides: UsageMixSlide[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = slides.length

  useEffect(() => {
    setIndex(current => (current >= count ? 0 : current))
  }, [count])

  useEffect(() => {
    if (paused || count <= 1) return
    const timer = window.setInterval(() => setIndex(current => (current + 1) % count), USAGE_MIX_SLIDE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [count, paused])

  return (
    <div
      className="control-center-mix"
      role="group"
      aria-roledescription="carousel"
      aria-label="Usage highlights"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="control-center-mix__viewport">
        <div className="control-center-mix__track" style={{ transform: `translateX(-${index * 100}%)` }}>
          {slides.map((slide, slideIndex) => (
            <div className="control-center-mix__slide" key={slide.id} aria-hidden={slideIndex !== index}>
              <div className="control-center-mix__head">
                <span className="control-center-mix__caption">{slide.caption}</span>
              </div>
              {slide.kind === 'models' ? (
                <div className="control-center-mix__chart">
                  <i className="control-center-mix__gridline" style={{ bottom: '33%' }} aria-hidden="true" />
                  <i className="control-center-mix__gridline" style={{ bottom: '66%' }} aria-hidden="true" />
                  {slide.bars.map((bar, barIndex) => {
                    const inside = bar.height * USAGE_MIX_BAR_AREA_PX >= 42
                    return (
                      <div className="control-center-mix__col" key={`${bar.name}-${barIndex}`} title={bar.title}>
                        <div className="control-center-mix__barbox" style={{ '--bar-h': `${Math.max(4, bar.height * 100)}%`, '--bar-start': bar.palette[0], '--bar-end': bar.palette[1] } as CSSProperties}>
                          <span className="control-center-mix__bar" aria-hidden="true" />
                          {inside
                            ? <span className={`control-center-mix__bar-value${bar.light ? ' control-center-mix__bar-value--ink' : ''}`}>{bar.value}</span>
                            : <span className="control-center-mix__bar-value-above">{bar.value}</span>}
                        </div>
                        <span className="control-center-mix__bar-logo">
                          {bar.logo ? <ProviderLogo provider={bar.logo} size={14} /> : <span className="control-center-model__fallback" aria-hidden="true">{bar.name.slice(0, 1).toUpperCase()}</span>}
                        </span>
                        <span className="control-center-mix__bar-label"><span>{bar.name}</span></span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="control-center-mix__clients">
                  {slide.entries.map(entry => (
                    <div className="control-center-mix__client" key={entry.id} title={`${entry.label}: ${formatCompact(entry.tokens)} total tokens, ${formatCompact(entry.calls)} calls`}>
                      <ProviderLogo provider={entry.logo} size={15} />
                      <strong>{entry.label}</strong>
                      <span className="control-center-mix__client-track">
                        <span style={{ width: `${Math.max(4, entry.share * 100)}%`, '--control-center-track-start': entry.palette[0], '--control-center-track-end': entry.palette[1] } as CSSProperties} />
                      </span>
                      <small>{formatCompact(entry.tokens)}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {count > 1 ? (
        <div className="control-center-mix__dots">
          {slides.map((slide, dotIndex) => (
            <button
              key={slide.id}
              type="button"
              className={dotIndex === index ? 'control-center-mix__dot on' : 'control-center-mix__dot'}
              aria-label={`Show ${slide.caption}`}
              aria-pressed={dotIndex === index}
              onClick={() => setIndex(dotIndex)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ControlCenterHome({ current, scope, providerLabel, period, provider, ready = true, quota, onNavigate, onShare }: { current: HomeCurrent; scope: string; providerLabel: string; period: Period; provider: string; ready?: boolean; quota: QuotaProvider[] | null; onNavigate?: (section: Section) => void; onShare?: () => void }) {
  const sessionsReport = usePolled<SessionRow[]>(
    () => metrora.getSessions(period, provider),
    [period, provider],
    { enabled: ready, memoKey: `sessions|${period}|${provider}|all|-` },
  )
  const usageMixSlides = useMemo(() => buildUsageMixSlides(current, sessionsReport.data), [current, sessionsReport.data])
  const sessions = current.topSessions.slice(0, 4)
  const capacityGroups = (quota ?? [])
    .map(provider => ({ provider, windows: provider.windows.slice(0, 2) }))
    .filter(group => group.windows.length > 0)
    .slice(0, 4)
  const [greeting, setGreeting] = useState(() => greetingForHour(new Date().getHours()))
  const [displayName, setDisplayName] = useState<string | null>(null)

  useEffect(() => {
    const updateGreeting = () => setGreeting(greetingForHour(new Date().getHours()))
    updateGreeting()
    const timer = window.setInterval(updateGreeting, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const getWorkspaceStatus = (metrora as { getWorkspaceStatus?: () => Promise<unknown> }).getWorkspaceStatus
    if (typeof getWorkspaceStatus !== 'function') return () => { cancelled = true }

    void getWorkspaceStatus()
      .then(status => {
        if (!cancelled) setDisplayName(displayNameFromWorkspaceStatus(status))
      })
      .catch(() => {
        if (!cancelled) setDisplayName(null)
      })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="control-center-home" aria-label="Metrora AI Control Center">
      <section className="control-center-hero" style={{ '--control-center-hero-image': `url(${heroMountains})` } as CSSProperties}>
        <div className="control-center-hero__content">
          <div className="control-center-hero__topline">
            <span className="eyebrow">{scope}</span>
          </div>
          <h1><span>{greeting}</span>{displayName ? <><span>, </span><em>{displayName}</em></> : null}</h1>
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
          {usageMixSlides.length ? (
            <UsageMixCarousel slides={usageMixSlides} />
          ) : <EmptyNote>No model usage in this range yet.</EmptyNote>}
        </div>

        <div className="control-center-panel control-center-panel--capacity">
          <div className="control-center-panel__head"><div><span className="eyebrow">Capacity</span><h2>Provider signals</h2></div><button className="control-center-link" type="button" onClick={() => onNavigate?.('plans')}>View all →</button></div>
          {capacityGroups.length ? (
            <div className="control-center-capacity-list" aria-label="Provider-reported capacity">
              {capacityGroups.map(({ provider, windows }) => {
                return (
                  <div className="control-center-capacity-group" key={provider.provider}>
                    <div className="control-center-capacity-group__provider"><ProviderLogo provider={provider.provider} size={18} /><strong>{quotaProviderName(provider.provider)}</strong></div>
                    <div className="control-center-capacity-group__windows">
                      {windows.map(window => {
                        const used = Math.max(0, Math.min(1, window.usedFraction))
                        return (
                          <div className="control-center-capacity-group__window" key={`${provider.provider}-${window.id}`}>
                            <span className="control-center-capacity-group__window-label">{window.label}{provider.freshness === 'stale' ? <small>stale</small> : null}</span>
                            <span className="control-center-capacity-row__usage"><span className="control-center-capacity-row__track"><span style={{ width: `${used * 100}%` }} /></span><strong>{percent(used)}</strong></span>
                          </div>
                        )
                      })}
                    </div>
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
