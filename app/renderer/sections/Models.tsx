import { useEffect, useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { EmptyNote } from '../components/EmptyState'
import { ProviderLogo } from '../components/ProviderLogo'
import { seriesColorForModel } from '../components/ListRow'
import { Panel } from '../components/Panel'
import { SectionSkeleton } from '../components/Skeleton'
import { IncompleteReconciliationBanner, StaleBanner } from '../components/StaleBanner'
import type { Section } from '../components/Sidebar'
import { usePolled, type Polled } from '../hooks/usePolled'
import { formatCompact, formatUsd } from '../lib/format'
import { metrora } from '../lib/ipc'
import { formatProviderLabel, providerLogoKey } from '../lib/providerPresentation'
import { cacheReuseMultiple, costPerMillionTotal, formatReuseMultiple, totalTokenCount } from '../lib/usageMetrics'
import type { AuditRow, DateRange, DurableModelAccountingRow, DurableModelPresentationRow, MenubarPayload, ModelAccounting, ModelPresentation, ModelReportRow, Period, ReasoningTokenSemantics } from '../lib/types'
import type { SettingsPane } from './Settings'
import { modelPricingPresentation } from './modelPricingPresentation'
import { ModelIdentity } from './ModelsDurableTable'
import { ModelsControlCenter } from './ModelsControlCenter'
import { ModelsCompareWorkspace, ModelsEvidencePanel, ModelsTaskInsightsRail } from './ModelsSidePanels'

type ModelsLens = 'model' | 'task' | 'audit' | 'compare'
type DurableModelAccounting = ModelAccounting

const LENSES = [
  { value: 'model', label: 'By model' },
  { value: 'task', label: 'By task' },
  { value: 'audit', label: 'Evidence' },
]

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

// Muted secondary tag naming a row's provider, so the same model name coming
// from different providers reads as distinct rows.
const authorityNoteStyle = { color: 'var(--mut)', fontSize: 'var(--fs-label)', lineHeight: 1.45 } as const

function durableAccounting(data: MenubarPayload): DurableModelAccounting {
  const emitted = data.current.modelAccounting
  if (emitted) return emitted

  // Compatibility fallback for an older CLI payload: retain the durable headline
  // but do not invent a token split the old payload never carried.
  const rows: DurableModelAccountingRow[] = data.current.topModels.map(model => ({
    name: model.name,
    cost: model.cost,
    savingsUSD: model.savingsUSD,
    calls: model.calls,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokenDetail: false,
  }))
  const representedCost = rows.reduce((sum, row) => sum + row.cost, 0)
  const representedCalls = rows.reduce((sum, row) => sum + row.calls, 0)
  const gapCost = Math.max(0, data.current.cost - representedCost)
  const gapCalls = Math.max(0, data.current.calls - representedCalls)
  return {
    rows,
    gap: { cost: gapCost, savingsUSD: 0, calls: gapCalls },
    coverage: {
      cost: data.current.cost > 0 ? Math.max(0, Math.min(1, representedCost / data.current.cost)) : 1,
      calls: data.current.calls > 0 ? Math.max(0, Math.min(1, representedCalls / data.current.calls)) : 1,
    },
    tokenCoverage: { cost: 0, calls: 0 },
  }
}

function legacyPresentationRow(row: DurableModelAccountingRow, index: number): DurableModelPresentationRow {
  const reasoningSemantics: ReasoningTokenSemantics = row.reasoningSemantics ?? 'unavailable'
  const hasRoute = Boolean(row.provider || (row.sourceProviders?.length ?? 0) > 0)
  const deliveryStatus = !hasRoute
    ? 'unavailable' as const
    : row.provider && (row.sourceProviders?.length ?? 0) > 0
      ? 'exact' as const
      : 'partial' as const
  return {
    ...row,
    presentationIdentity: `legacy:${row.name}:${index}`,
    providers: row.provider ? [row.provider] : [],
    sourceProviders: row.sourceProviders ?? [],
    rawModels: row.rawModels ?? [row.name],
    canonicalIdentities: row.canonicalIdentity ? [row.canonicalIdentity] : [],
    economicVariants: [row.semanticVariant ?? 'default'],
    reasoningSemantics,
    timingCoverage: row.timingCoverage ?? (row.activeDurationMs && row.activeGeneratedTokens ? 'observed' : 'unavailable'),
    deliveryRows: [row],
    deliveryStatus,
  }
}

function durablePresentation(data: MenubarPayload, accounting: DurableModelAccounting): ModelPresentation {
  return data.current.modelPresentation ?? {
    rows: accounting.rows.map(legacyPresentationRow),
    accountingRowCount: accounting.rows.length,
  }
}

function hasAccountingValue(accounting: DurableModelAccounting): boolean {
  return accounting.rows.length > 0 || accounting.gap.cost > 0.000001 || accounting.gap.calls > 0 || accounting.gap.savingsUSD > 0.000001
}

export function Models({
  period,
  provider,
  projectScopeId,
  range = null,
  refreshToken = 0,
  onNavigate,
  overview,
  ready = true,
}: {
  period: Period
  provider: string
  projectScopeId?: string
  range?: DateRange | null
  refreshToken?: number
  onNavigate?: (section: Section, pane?: SettingsPane) => void
  overview: Polled<MenubarPayload>
  ready?: boolean
}) {
  const [lens, setLens] = useState<ModelsLens>('model')
  const onAddAlias = () => onNavigate?.('settings', 'aliases')

  return (
    <div className="models-page">
      <ModelsHeading
        current={overview.data?.current}
        lens={lens}
        onLensChange={value => setLens(value)}
        onCompare={() => setLens('compare')}
      />
      {lens === 'audit' ? (
        <AuditLens period={period} provider={provider} range={range} refreshToken={refreshToken} ready={ready} />
      ) : (
        <ModelsUsage
          period={period}
          provider={provider}
          projectScopeId={projectScopeId}
          range={range}
          view={lens === 'task' ? 'task' : lens === 'compare' ? 'compare' : 'model'}
          refreshToken={refreshToken}
          onAddAlias={onAddAlias}
          overview={overview}
          onExitCompare={() => setLens('model')}
          ready={ready}
        />
      )}
    </div>
  )
}

function meteredTokenTotal(current: MenubarPayload['current'] | undefined): number | null {
  if (!current) return null
  const values = [current.inputTokens, current.outputTokens, current.cacheReadTokens, current.cacheWriteTokens]
  return values.every(value => typeof value === 'number' && Number.isFinite(value))
    ? values.reduce((sum, value) => sum + value, 0)
    : null
}

function ModelsHeading({
  current,
  lens,
  onLensChange,
  onCompare,
}: {
  current?: MenubarPayload['current']
  lens: ModelsLens
  onLensChange: (value: ModelsLens) => void
  onCompare: () => void
}) {
  const modelCount = current?.modelPresentation?.rows.length ?? current?.modelAccounting?.rows.length ?? current?.topModels.length ?? null
  const tokenTotal = meteredTokenTotal(current)
  const lensId = (value: ModelsLens) => `models-lens-${value}`

  return (
    <header className="models-heading">
      <div className="models-title-line">
        <h1>Models</h1>
        <span>
          {modelCount == null ? 'Loading usage' : `${modelCount.toLocaleString('en-US')} models`}
          {current ? <><i>·</i>{current.calls.toLocaleString('en-US')} calls<i>·</i>{tokenTotal == null ? 'tokens unavailable' : `${formatCompact(tokenTotal)} metered tokens`}<i>·</i>{formatUsd(current.cost)} total spend</> : null}
        </span>
      </div>
      <p>Compare observed model usage, pricing evidence, and route coverage across the selected scope.</p>
      <div className="models-view-tabs" role="tablist" aria-label="Model views">
        {LENSES.map(option => (
          <button
            key={option.value}
            id={lensId(option.value as ModelsLens)}
            type="button"
            role="tab"
            aria-selected={lens === option.value}
            onClick={() => onLensChange(option.value as ModelsLens)}
          >
            <span className="models-view-tab-icon" aria-hidden="true">{option.value === 'model' ? '◈' : option.value === 'task' ? '✣' : '◌'}</span>
            {option.label}
          </button>
        ))}
        <button type="button" className="models-view-tab models-view-tab-route" role="tab" aria-selected={lens === 'compare'} onClick={onCompare}>
          <span className="models-view-tab-icon" aria-hidden="true">⇄</span>
          Compare
        </button>
      </div>
    </header>
  )
}

function ModelsUsage({
  period,
  provider,
  projectScopeId,
  range,
  view,
  refreshToken,
  onAddAlias,
  overview,
  onExitCompare,
  ready,
}: {
  period: Period
  provider: string
  projectScopeId?: string
  range: DateRange | null
  view: 'model' | 'task' | 'compare'
  refreshToken: number
  onAddAlias: () => void
  overview: Polled<MenubarPayload>
  onExitCompare: () => void
  ready: boolean
}) {
  // Task attribution genuinely requires surviving source sessions. The primary
  // model table does not: it reads the already-loaded durable Overview payload,
  // avoiding both a second authority and another CLI spawn on first navigation.
  const scopedProject = projectScopeId && projectScopeId !== 'all' ? projectScopeId : undefined
  const report = usePolled<ModelReportRow[]>(
    () => range
      ? scopedProject ? metrora.getModels(period, provider, true, range, scopedProject) : metrora.getModels(period, provider, true, range)
      : scopedProject ? metrora.getModels(period, provider, true, undefined, scopedProject) : metrora.getModels(period, provider, true),
    [period, provider, projectScopeId, range?.from, range?.to, refreshToken],
    { enabled: ready && view === 'task', memoKey: `models|${period}|${provider}|${projectScopeId ?? 'all'}|task|${range?.from ?? ''}-${range?.to ?? ''}` },
  )

  if (view === 'task') {
    if (!report.data) {
      if (report.error) return <CliErrorPanel error={report.error} subject="model task detail" />
      return <SectionSkeleton label="Loading available task detail…" rows={5} />
    }
    return (
      <div className="models-analytics-workspace">
        <section className="models-list-pane" aria-label="Models grouped by task">
          {report.error && <StaleBanner error={report.error} />}
          <Panel className="scroll-x">
            <div style={{ padding: '12px 14px 4px' }}>
              <strong>Task breakdown · Available detail</strong>
              <div style={authorityNoteStyle}>Task attribution needs the original session records. Model totals above remain durable after those records expire.</div>
            </div>
            {report.data.length ? (
              <ModelsByTaskTable rows={report.data} onAddAlias={onAddAlias} />
            ) : (
              <EmptyNote>No task-level session detail is available in this range.</EmptyNote>
            )}
          </Panel>
        </section>
        <ModelsTaskInsightsRail rows={report.data} />
      </div>
    )
  }

  if (!overview.data) {
    if (overview.error) return <CliErrorPanel error={overview.error} subject="model usage" />
    return <SectionSkeleton label="Loading model totals…" rows={5} />
  }

  const accounting = durableAccounting(overview.data)
  const presentation = durablePresentation(overview.data, accounting)
  return (
    <>
      {overview.error && <StaleBanner error={overview.error} />}
      {!overview.error && overview.data.freshness?.reconciliation === 'degraded' && <IncompleteReconciliationBanner />}
      {hasAccountingValue(accounting) ? (
        <ModelsControlCenter
          mode={view}
          accounting={accounting}
          presentation={presentation}
          legacyPresentationRow={legacyPresentationRow}
          unpricedModels={overview.data.current.unpricedModels}
          history={overview.data.history}
          onExitCompare={onExitCompare}
        />
      ) : <div className="models-empty-state"><strong>No model usage in this range yet.</strong><EmptyNote>Change the scope or refresh after new activity is collected.</EmptyNote></div>}
    </>
  )
}

// A row's cost is "estimated" when it has no live pricing entry, or when the
// attributed cost diverges from a straight rate x displayed-token recompute
// (fast-mode multipliers or the 1-hour cache rate that calculateCost applies).
function auditEstimated(row: AuditRow): boolean {
  if (!row.rates) return true
  return Math.abs(row.cost.recomputedTotalUSD - row.attributedCostUSD) > 0.005
}

function auditPricingState(row: AuditRow): 'Priced' | 'Estimated' | 'Unpriced' {
  if (!row.rates) return 'Unpriced'
  return auditEstimated(row) ? 'Estimated' : 'Priced'
}

function auditDisplayedTotal(row: AuditRow): number {
  return row.displayed.inputTokens + row.displayed.outputTokens + row.displayed.cacheReadTokens + row.displayed.cacheWriteTokens
}

function auditReconciliation(row: AuditRow): number | null {
  if (!row.rates) return null
  const denominator = Math.abs(row.attributedCostUSD)
  if (denominator <= 0.000001 && Math.abs(row.cost.recomputedTotalUSD) <= 0.000001) return 100
  if (denominator <= 0.000001) return 0
  return Math.max(0, Math.min(100, (1 - Math.abs(row.cost.recomputedTotalUSD - row.attributedCostUSD) / denominator) * 100))
}

function auditEvidenceComplete(row: AuditRow): boolean {
  return Object.values(row.raw).every(value => typeof value === 'number' && Number.isFinite(value))
    && Object.values(row.displayed).every(value => typeof value === 'number' && Number.isFinite(value))
}

function auditUnitCost(row: AuditRow): number | null {
  const total = auditDisplayedTotal(row)
  if (!row.rates || total <= 0) return null
  const tokenCost = row.cost.input + row.cost.output + row.cost.cacheWrite + row.cost.cacheRead
  return tokenCost / total * 1_000_000
}

function AuditLens({
  period,
  provider,
  range,
  refreshToken,
  ready,
}: {
  period: Period
  provider: string
  range: DateRange | null
  refreshToken: number
  ready: boolean
}) {
  const report = usePolled<AuditRow[]>(
    () => range ? metrora.getAudit(period, provider, range) : metrora.getAudit(period, provider),
    [period, provider, range?.from, range?.to, refreshToken],
    { enabled: ready, memoKey: `audit|${period}|${provider}|${range?.from ?? ''}-${range?.to ?? ''}` },
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedId(current => {
      if (current && report.data?.some((row, index) => auditIdentity(row, index) === current)) return current
      return report.data?.[0] ? auditIdentity(report.data[0], 0) : null
    })
  }, [report.data])

  if (!report.data) {
    if (report.error) return <CliErrorPanel error={report.error} subject="model usage evidence" />
    return <SectionSkeleton label="Loading usage evidence…" rows={5} />
  }

  const selected = selectedId ? report.data.find((row, index) => auditIdentity(row, index) === selectedId) ?? null : null
  return (
    <div className="models-analytics-workspace">
      <section className="models-list-pane" aria-label="Model usage evidence list">
        {report.error && <StaleBanner error={report.error} />}
        <Panel className="scroll-x">
          {report.data.length ? (
            <AuditTable rows={report.data} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <EmptyNote>No usage evidence is available for this range yet.</EmptyNote>
          )}
        </Panel>
      </section>
      {selected ? <ModelsEvidencePanel rows={report.data} selected={selected} onClose={() => setSelectedId(null)} /> : null}
    </div>
  )
}

function auditIdentity(row: AuditRow, index: number): string {
  return `${row.provider}\u0000${row.model}\u0000${index}`
}

function AuditTable({ rows, selectedId, onSelect }: { rows: AuditRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <table className="audit-table" aria-label="Model usage evidence">
      <caption className="sr-only">Model usage evidence</caption>
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col">Provider</th>
          <th scope="col">Calls</th>
          <th scope="col">Total tokens</th>
          <th scope="col">Cost</th>
          <th scope="col">Cost / 1M</th>
          <th scope="col">Evidence</th>
          <th scope="col">Pricing</th>
          <th scope="col">Recon</th>
          <th scope="col">Reasoning</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <AuditTableRow key={`${row.provider}-${row.model}-${i}`} row={row} selected={selectedId === auditIdentity(row, i)} onSelect={() => onSelect(auditIdentity(row, i))} />
        ))}
      </tbody>
    </table>
  )
}

function AuditTableRow({ row, selected, onSelect }: { row: AuditRow; selected: boolean; onSelect: () => void }) {
  const estimated = auditEstimated(row)
  const total = auditDisplayedTotal(row)
  const unitCost = auditUnitCost(row)
  const reconciliation = auditReconciliation(row)
  const complete = auditEvidenceComplete(row)
  const pricingState = auditPricingState(row)
  return (
    <tr>
      <td title={row.model}>
        <button type="button" className="models-evidence-row-trigger" aria-label={`Select evidence for ${row.modelDisplayName}`} aria-pressed={selected} onClick={onSelect}>
          <span className="mdot" style={{ display: 'inline-block', background: seriesColorForModel(row.modelDisplayName || row.model), marginRight: 8 }} />
          {row.modelDisplayName}
        </button>
      </td>
      <td>
        <span className="models-provider-value" title={row.providerDisplayName || row.provider}>
          <ProviderLogo provider={providerLogoKey(row.provider)} size={14} />
          <span>{row.providerDisplayName || formatProviderLabel(row.provider)}</span>
        </span>
      </td>
      <td>{fmtInt(row.calls)}</td>
      <td>{formatCompact(total)}</td>
      <td>
        {formatUsd(row.attributedCostUSD)}
        {estimated ? <span className="est" title="Cost is estimated (no live pricing or derived rate)"> est</span> : null}
      </td>
      <td>{unitCost == null ? <span className="models-unavailable" aria-label="Cost per 1M is unavailable">—</span> : formatUsd(unitCost)}</td>
      <td><span className={`models-evidence-state ${complete ? 'is-complete' : 'is-partial'}`} title={complete ? 'Raw and displayed token fields are present.' : 'One or more audited token fields are unavailable.'}>{complete ? 'Complete' : 'Partial'}</span></td>
      <td><span className={`models-evidence-state ${pricingState === 'Priced' ? 'is-complete' : pricingState === 'Estimated' ? 'is-partial' : 'is-unpriced'}`} title={pricingState === 'Unpriced' ? 'No pricing rate record was resolved for this audit row.' : pricingState === 'Estimated' ? 'A rate record was resolved, but attributed cost does not equal a simple displayed-token recompute.' : 'A pricing rate record was resolved for this audit row.'}>{pricingState}</span></td>
      <td>{reconciliation == null ? <span className="models-unavailable" aria-label="Reconciliation is unavailable">—</span> : `${reconciliation.toFixed(0)}%`}</td>
      <td><span className={`models-evidence-state ${row.raw.reasoningTokens > 0 ? 'is-observed' : 'is-none'}`}>{row.raw.reasoningTokens > 0 ? 'Observed' : 'None recorded'}</span></td>
    </tr>
  )
}

function ModelsByTaskTable({ rows, onAddAlias }: { rows: ModelReportRow[]; onAddAlias: () => void }) {
  const groups = groupTaskRows(rows)

  return (
    <table className="models-by-task" aria-label="Models grouped by task">
      <thead>
        <tr>
          <th>Task</th>
          <th>Model</th>
          <th>Provider</th>
          <th>Calls</th>
          <th>Reasoning</th>
          <th>Input</th>
          <th>Output</th>
          <th>Cache R</th>
          <th>Cache W</th>
          <th>Cache ×</th>
          <th>Total</th>
          <th>Cost</th>
          <th>Cost / 1M</th>
        </tr>
      </thead>
      {groups.map(group => (
        <tbody className="model-task-group" key={group.category}>
          <tr className="models-task-group-header">
            <td colSpan={13}>
              <span className="models-task-group-icon" aria-hidden="true">✣</span>
              <strong className="models-task-title">{group.category}</strong>
              <span className="models-task-group-meta">{group.rows.length} models · {fmtInt(group.calls)} calls</span>
            </td>
          </tr>
          {group.rows.map((row, i) => (
            <ModelTaskRow key={`${row.provider}-${row.model}-${i}`} row={row} onAddAlias={onAddAlias} />
          ))}
        </tbody>
      ))}
    </table>
  )
}

function reportRowTotal(row: ModelReportRow): number {
  return totalTokenCount({
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    additiveReasoningTokens: row.additiveReasoningTokens,
    reasoningSemantics: row.reasoningSemantics,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
  })
}

function ModelTaskRow({ row, onAddAlias }: { row: ModelReportRow; onAddAlias: () => void }) {
  const pricing = modelPricingPresentation(row.pricing, row.calls)
  const costValue = pricing.costMode === 'unavailable' ? '—' : formatUsd(row.costUSD)
  const total = reportRowTotal(row)
  const reuse = cacheReuseMultiple(row.inputTokens, row.cacheReadTokens)
  const unitCost = costPerMillionTotal(row.costUSD, {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    additiveReasoningTokens: row.additiveReasoningTokens,
    reasoningSemantics: row.reasoningSemantics,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
  })

  return (
    <tr className="model-task-row">
      <td className="models-task-branch"><span aria-hidden="true">↳</span></td>
      <td className="models-task-model-cell">
        <span className="models-task-model-value">
          <ModelIdentity name={row.modelDisplayName} />
          {pricing.showAlias ? <button type="button" className="alias" onClick={onAddAlias}>add alias ›</button> : null}
        </span>
      </td>
      <td>
        <span className="models-provider-value" title={row.providerDisplayName || row.provider}>
          <ProviderLogo provider={providerLogoKey(row.provider)} size={14} />
          <span>{row.providerDisplayName || formatProviderLabel(row.provider)}</span>
        </span>
      </td>
      <td>{fmtInt(row.calls)}</td>
      <td>{row.reasoningSemantics !== 'unavailable' && row.reasoningTokens !== undefined ? formatCompact(row.reasoningTokens) : '—'}</td>
      <td>{formatCompact(row.inputTokens)}</td>
      <td>{formatCompact(row.outputTokens)}</td>
      <td>{formatCompact(row.cacheReadTokens)}</td>
      <td>{formatCompact(row.cacheWriteTokens)}</td>
      <td>{formatReuseMultiple(reuse)}</td>
      <td>{formatCompact(total)}</td>
      <td className={pricing.muteCost ? 'dim' : undefined} title={pricing.title}>{costValue}</td>
      <td>{pricing.costMode === 'unavailable' || unitCost == null ? '—' : formatUsd(unitCost)}</td>
    </tr>
  )
}

function groupTaskRows(rows: ModelReportRow[]): Array<{ category: string; calls: number; tokens: number; rows: ModelReportRow[] }> {
  const groups = new Map<string, { category: string; calls: number; tokens: number; rows: ModelReportRow[] }>()
  for (const row of rows) {
    const category = row.category ?? 'uncategorized'
    const key = normalize(category)
    const group = groups.get(key)
    if (group) {
      group.calls += row.calls
      group.tokens += reportRowTotal(row)
      group.rows.push(row)
    } else {
      groups.set(key, { category, calls: row.calls, tokens: reportRowTotal(row), rows: [row] })
    }
  }
  return [...groups.values()]
    .map(group => ({
      ...group,
      rows: [...group.rows].sort((a, b) => b.calls - a.calls || reportRowTotal(b) - reportRowTotal(a)),
    }))
    .sort((a, b) => b.calls - a.calls || b.tokens - a.tokens)
}
