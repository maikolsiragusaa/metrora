import { PERIOD_LABELS } from './lib/desktopSections'
import type { DateRange, MenubarPayload, Period } from './lib/types'

export const SHARE_CARD_V1_SCHEMA = 'metrora.share-card.v1' as const
export const SHARE_CARD_V1_FAMILY = 'ai-recap' as const
export const SHARE_CARD_WIDTH = 1200
export const SHARE_CARD_HEIGHT = 630

export type ShareCardDataState = 'current' | 'last-good' | 'partial'

export type ShareCardV1 = {
  schemaVersion: typeof SHARE_CARD_V1_SCHEMA
  family: typeof SHARE_CARD_V1_FAMILY
  periodLabel: string
  providerScope: string
  projectScope: {
    active: boolean
    name: string | null
  }
  metrics: {
    calls: number
    sessions: number
    costUSD: number | null
  }
  topModel: {
    name: string
    calls: number
  } | null
  pricingCoverage: number | null
  dataState: ShareCardDataState
  attribution: 'Metrora · metrora.eu'
}

export type BuildShareCardV1Input = {
  payload: MenubarPayload
  period: Period
  range?: DateRange | null
  providerLabel: string
  projectScopeActive?: boolean
  projectScopeName?: string | null
  includeProjectName?: boolean
  includeCost?: boolean
  stale?: boolean
}

function boundedText(value: string, max = 80): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max)
}

function finiteNonNegative(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null
}

function requiredCount(value: number, label: string): number {
  const safe = finiteNonNegative(value)
  if (safe === null) throw new Error(`Share card ${label} evidence is invalid.`)
  return safe
}

function xml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;')
}

function displayText(value: string, max = 42): string {
  const normalized = boundedText(value, max + 1)
  return normalized.length > max ? normalized.slice(0, max - 1) + '…' : normalized
}

export function shareCardPeriodLabel(period: Period, range?: DateRange | null): string {
  if (range) return range.from === range.to ? range.from : `${range.from} – ${range.to}`
  return PERIOD_LABELS[period]
}

export function buildShareCardV1(input: BuildShareCardV1Input): ShareCardV1 {
  const current = input.payload.current
  const includeCost = Boolean(input.includeCost)
  const reconciliation = input.payload.freshness?.reconciliation
  const dataState: ShareCardDataState = input.stale
    ? 'last-good'
    : reconciliation === 'degraded'
      ? 'partial'
      : 'current'
  const topModel = current.topModels[0]
  const projectActive = Boolean(input.projectScopeActive)
  const disclosedProject = projectActive && input.includeProjectName && input.projectScopeName
    ? boundedText(input.projectScopeName)
    : null
  const cost = includeCost ? finiteNonNegative(current.cost) : null
  if (includeCost && cost === null) throw new Error('Share card cost evidence is invalid.')
  const coverage = includeCost && typeof current.pricingCoverage === 'number'
    ? finiteNonNegative(current.pricingCoverage)
    : null

  return {
    schemaVersion: SHARE_CARD_V1_SCHEMA,
    family: SHARE_CARD_V1_FAMILY,
    periodLabel: boundedText(shareCardPeriodLabel(input.period, input.range), 64),
    providerScope: boundedText(input.providerLabel || 'All providers', 64),
    projectScope: {
      active: projectActive,
      name: disclosedProject,
    },
    metrics: {
      calls: requiredCount(current.calls, 'call-count'),
      sessions: requiredCount(current.sessions, 'session-count'),
      costUSD: cost,
    },
    topModel: topModel ? {
      name: boundedText(topModel.name, 96),
      calls: requiredCount(topModel.calls, 'top-model call-count'),
    } : null,
    pricingCoverage: coverage === null ? null : Math.min(1, coverage),
    dataState,
    attribution: 'Metrora · metrora.eu',
  }
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

function formatCost(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function metricBlock(x: number, label: string, value: string, detail = ''): string {
  return `<g transform="translate(${x} 0)">
    <rect x="0" y="242" width="300" height="142" rx="22" fill="#15191f" stroke="#27313a"/>
    <text x="24" y="280" fill="#91a0aa" font-size="18" font-weight="600">${xml(label)}</text>
    <text x="24" y="332" fill="#f7fbfd" font-size="42" font-weight="700">${xml(value)}</text>
    ${detail ? `<text x="24" y="360" fill="#7f909a" font-size="16">${xml(detail)}</text>` : ''}
  </g>`
}

function metroraMark(): string {
  return `<g fill="#f7fbfd" transform="translate(0 2) scale(.22)">
    <rect x="8" y="8" width="14" height="104" rx="2"/>
    <rect x="38" y="40" width="14" height="88" rx="2"/>
    <rect x="68" y="68" width="14" height="76" rx="2"/>
    <rect x="98" y="68" width="14" height="76" rx="2"/>
    <rect x="128" y="40" width="14" height="88" rx="2"/>
    <rect x="158" y="8" width="14" height="104" rx="2"/>
  </g>`
}

export function renderShareCardSvg(card: ShareCardV1): string {
  const projectScope = card.projectScope.active
    ? card.projectScope.name ? `Project: ${displayText(card.projectScope.name, 34)}` : 'Current Project scope'
    : 'All Projects'
  const topModel = card.topModel ? displayText(card.topModel.name, 34) : 'Not available'
  const stateNote = card.dataState === 'last-good'
    ? 'Last-good data · latest refresh unavailable'
    : card.dataState === 'partial'
      ? 'Incomplete source reconciliation'
      : ''
  const coverageNote = card.metrics.costUSD !== null && card.pricingCoverage !== null && card.pricingCoverage < 1
    ? `${Math.round(card.pricingCoverage * 100)}% of cost-bearing calls priced`
    : ''
  const thirdMetric = card.metrics.costUSD === null
    ? metricBlock(828, 'Top model', topModel, card.topModel ? `${formatInteger(card.topModel.calls)} calls` : '')
    : metricBlock(828, 'Spend', formatCost(card.metrics.costUSD), coverageNote)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" viewBox="0 0 ${SHARE_CARD_WIDTH} ${SHARE_CARD_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d0f13"/>
      <stop offset="1" stop-color="#111a20"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(1030 38) rotate(136) scale(460 360)">
      <stop offset="0" stop-color="#00d4ff" stop-opacity=".18"/>
      <stop offset="1" stop-color="#00d4ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" rx="28" fill="url(#bg)"/>
  <rect width="1200" height="630" rx="28" fill="url(#glow)"/>
  <rect x="1" y="1" width="1198" height="628" rx="27" fill="none" stroke="#26313a"/>
  <g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <g transform="translate(54 44)">
      ${metroraMark()}
      <text x="48" y="30" fill="#f7fbfd" font-size="25" font-weight="700">Metrora</text>
      <text x="48" y="55" fill="#7f909a" font-size="14" letter-spacing="1.4">LOCAL AI USAGE INTELLIGENCE</text>
    </g>
    <text x="54" y="156" fill="#66e6ff" font-size="18" font-weight="700" letter-spacing="2">AI RECAP</text>
    <text x="54" y="205" fill="#f7fbfd" font-size="44" font-weight="750">${xml(displayText(card.periodLabel, 38))}</text>
    ${metricBlock(54, 'Calls', formatInteger(card.metrics.calls))}
    ${metricBlock(441, 'Sessions', formatInteger(card.metrics.sessions))}
    ${thirdMetric}
    <text x="54" y="442" fill="#7f909a" font-size="16" font-weight="600">SCOPE</text>
    <text x="54" y="477" fill="#dbe5ea" font-size="22">${xml(displayText(card.providerScope, 34))} · ${xml(projectScope)}</text>
    ${card.metrics.costUSD !== null && card.topModel ? `<text x="54" y="515" fill="#91a0aa" font-size="18">Top model: ${xml(topModel)} · ${formatInteger(card.topModel.calls)} calls</text>` : ''}
    ${stateNote ? `<text x="54" y="552" fill="#f0b86e" font-size="16">${xml(displayText(stateNote, 90))}</text>` : ''}
    <line x1="54" x2="1146" y1="578" y2="578" stroke="#26313a"/>
    <text x="54" y="608" fill="#82929c" font-size="16">${xml(card.attribution)}</text>
    <text x="1146" y="608" text-anchor="end" fill="#586872" font-size="14">Measured locally · shared by you</text>
  </g>
</svg>`
}

export function shareCardSvgDataUrl(card: ShareCardV1): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderShareCardSvg(card))}`
}

export async function rasterizeShareCardPngDataUrl(card: ShareCardV1): Promise<string> {
  const image = new Image()
  const src = shareCardSvgDataUrl(card)
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Share card preview could not be rendered.'))
    image.src = src
  })
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_CARD_WIDTH
  canvas.height = SHARE_CARD_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('PNG rendering is unavailable on this device.')
  context.drawImage(image, 0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT)
  return canvas.toDataURL('image/png')
}
