import { Fragment, useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { SectionSkeleton } from '../components/Skeleton'
import { SegTabs } from '../components/SegTabs'
import { StaleBanner } from '../components/StaleBanner'
import { type Polled, usePolled } from '../hooks/usePolled'
import { formatCompact, formatUsd } from '../lib/format'
import { metrora } from '../lib/ipc'
import type { DateRange, MenubarPayload, OptimizeJsonReport, Period, SessionYieldJson, WasteAction, YieldJsonReport } from '../lib/types'

type OptimizeTab = 'opportunities' | 'reverts' | 'abandoned' | 'quickFixes'
type YieldCategory = 'reverted' | 'abandoned'

function yieldTabValue(report: Polled<YieldJsonReport>, category: YieldCategory): string {
  if (report.data) return formatUsd(report.data.summary[category].costUSD)
  return report.error ? '—' : '…'
}

function identified(value: string, fallback: string): string {
  const normalized = value.trim()
  return normalized || fallback
}

export function Optimize({ period, provider, range = null }: { period: Period; provider: string; range?: DateRange | null }) {
  const overview = usePolled<MenubarPayload>(
    () => range ? metrora.getOverview(period, provider, range) : metrora.getOverview(period, provider),
    [period, provider, range?.from, range?.to],
  )
  return <OptimizeContent period={period} provider={provider} range={range} overview={overview} />
}

export function OptimizeContent({
  period,
  provider = 'all',
  range = null,
  overview,
  refreshToken = 0,
  ready = true,
}: {
  period: Period
  provider?: string
  range?: DateRange | null
  overview: Polled<MenubarPayload>
  refreshToken?: number
  ready?: boolean
}) {
  // Deterministic findings remain the evidence engine. This surface presents
  // them as prioritized insights today; a future conversational Advisor can
  // consume the same evidence without duplicating or replacing its authority.
  const optimizeReport = usePolled<OptimizeJsonReport>(
    () => range ? metrora.getOptimizeReport(period, provider, range) : metrora.getOptimizeReport(period, provider),
    [period, provider, range?.from, range?.to, refreshToken],
    { enabled: ready, memoKey: `optimize|${period}|${provider}|${range?.from ?? ''}-${range?.to ?? ''}` },
  )
  const yieldReport = usePolled<YieldJsonReport>(
    () => range ? metrora.getYield(period, provider, range) : metrora.getYield(period, provider),
    [period, provider, range?.from, range?.to, refreshToken],
    { enabled: ready, memoKey: `optyield|${period}|${provider}|${range?.from ?? ''}-${range?.to ?? ''}` },
  )
  const [tab, setTab] = useState<OptimizeTab>('opportunities')

  if (!overview.data) {
    if (overview.error) return <CliErrorPanel error={overview.error} subject="insights" />
    return <SectionSkeleton label="Preparing insights…" rows={5} />
  }

  const options = [
    { value: 'opportunities', label: `Opportunities ${formatUsd(overview.data.optimize.savingsUSD)}` },
    { value: 'reverts', label: `Reverted work ${yieldTabValue(yieldReport, 'reverted')}` },
    { value: 'abandoned', label: `Abandoned work ${yieldTabValue(yieldReport, 'abandoned')}` },
    { value: 'quickFixes', label: `Quick fixes ${overview.data.optimize.topFindings.length.toLocaleString('en-US')}` },
  ]

  return (
    <>
      {overview.error && <StaleBanner error={overview.error} />}
      <div className="opt-intro">
        <div>
          <span className="ov-label">Evidence-based insights</span>
          <strong>What deserves your attention</strong>
          <p>Prioritized from your observed local usage. These are deterministic signals, not generic AI advice.</p>
        </div>
        {overview.data.optimize.savingsUSD > 0 ? (
          <div className="opt-intro-kpi">
            <span>Potential</span>
            <strong>{formatUsd(overview.data.optimize.savingsUSD)}</strong>
            <small>{overview.data.optimize.findingCount.toLocaleString('en-US')} detected opportunities</small>
          </div>
        ) : null}
      </div>
      <SegTabs
        options={options}
        value={tab}
        onChange={value => setTab(value as OptimizeTab)}
        style={{ alignSelf: 'flex-start' }}
      />
      <Panel>
        {tab === 'opportunities' ? (
          <OpportunityRows report={optimizeReport} />
        ) : tab === 'reverts' ? (
          <YieldRows report={yieldReport} category="reverted" empty="No reverted work detected in this range." />
        ) : tab === 'abandoned' ? (
          <YieldRows report={yieldReport} category="abandoned" empty="No abandoned work detected in this range." />
        ) : (
          <FixesRows data={overview.data} />
        )}
      </Panel>
    </>
  )
}

function OpportunityRows({ report }: { report: Polled<OptimizeJsonReport> }) {
  if (!report.data) {
    if (report.error) return <CliErrorPanel error={report.error} subject="insights" />
    return <EmptyNote>Analyzing observed usage for opportunities…</EmptyNote>
  }

  if (!report.data.findings.length) {
    return <EmptyNote>No actionable opportunities detected in this range.</EmptyNote>
  }

  return (
    <div className="opt-waste">
      <div className="opt-summary">
        <strong>{report.data.summary.findingCount.toLocaleString('en-US')} opportunities</strong>
        <span>{formatUsd(report.data.summary.potentialSavingsCostUSD)} estimated potential</span>
        <span>{formatCompact(report.data.summary.potentialSavingsTokens)} tokens</span>
      </div>
      <ActionableFindingRows findings={report.data.findings} />
    </div>
  )
}

type OptimizeFinding = OptimizeJsonReport['findings'][number]

const IMPACT_ICON: Record<'high' | 'medium' | 'low', string> = {
  high: '↑',
  medium: '→',
  low: '↓',
}

function actionText(fix: WasteAction): string {
  return fix.type === 'file-content' ? fix.content : fix.text
}

function ActionableFindingRows({ findings }: { findings: OptimizeFinding[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyFix = async (finding: OptimizeFinding) => {
    await navigator.clipboard.writeText(actionText(finding.fix))
    setCopiedId(finding.id)
    window.setTimeout(() => setCopiedId(current => current === finding.id ? null : current), 1_500)
  }

  return (
    <div className="opt-findings">
      {findings.map((finding, index) => {
        const expanded = expandedId === finding.id
        return (
          <Fragment key={finding.id}>
            <button
              className="opt-finding opt-finding-toggle"
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedId(current => current === finding.id ? null : finding.id)}
            >
              <span className="opt-finding-rank">{String(index + 1).padStart(2, '0')}</span>
              <span className={`opt-impact opt-impact-${finding.severity}`}>
                <span aria-hidden="true">{IMPACT_ICON[finding.severity]}</span>
                {finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1)}
              </span>
              <span className="opt-finding-titlewrap">
                <b className="opt-finding-title">{finding.title}</b>
                <span className="opt-finding-preview">{finding.explanation}</span>
                {finding.trend === 'improving' && (
                  <span className="opt-trend opt-trend-improving">improving<span aria-hidden="true"> ↓</span></span>
                )}
              </span>
              <span className="opt-finding-savings">{finding.estimatedSavingsUSD > 0 ? formatUsd(finding.estimatedSavingsUSD) : '—'}</span>
              <span className="opt-finding-tokens">{formatCompact(finding.tokensSaved)} tokens</span>
              <span className="opt-finding-chevron" aria-hidden="true">›</span>
            </button>
            {expanded && (
              <div className="opt-finding-detail" role="region" aria-label={`${finding.title} details`}>
                <p className="opt-explanation">{finding.explanation}</p>
                <div className={`opt-fix opt-fix-${finding.fix.type}`}>
                  <div className="opt-fix-head">
                    <div>
                      <b>{finding.fix.label}</b>
                      {finding.fix.type === 'file-content' && <span className="opt-fix-path">{finding.fix.path}</span>}
                    </div>
                    <button className="opt-copy" type="button" onClick={() => void copyFix(finding)}>
                      {copiedId === finding.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="opt-fix-code"><code>{actionText(finding.fix)}</code></pre>
                </div>
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

type Finding = MenubarPayload['optimize']['topFindings'][number]

function FindingRows({ findings, empty }: { findings: Finding[]; empty: string }) {
  if (!findings.length) return <EmptyNote>{empty}</EmptyNote>

  return (
    <div className="opt-findings">
      {findings.map((finding, i) => (
        <div className="opt-finding opt-finding-legacy" key={`${finding.title}-${i}`}>
          <span className="opt-finding-rank">{String(i + 1).padStart(2, '0')}</span>
          <b className="opt-finding-title">{finding.title}</b>
          <span className={`opt-impact opt-impact-${finding.impact}`}>
            <span aria-hidden="true">{IMPACT_ICON[finding.impact]}</span>
            {finding.impact.charAt(0).toUpperCase() + finding.impact.slice(1)}
          </span>
          <span className="opt-finding-savings">{finding.savingsUSD > 0 ? formatUsd(finding.savingsUSD) : '—'}</span>
        </div>
      ))}
    </div>
  )
}

function YieldRows({
  report,
  category,
  empty,
}: {
  report: Polled<YieldJsonReport>
  category: SessionYieldJson['category']
  empty: string
}) {
  if (!report.data) {
    return <EmptyNote>{report.error ? 'Outcome data is unavailable right now.' : 'Reviewing session outcomes…'}</EmptyNote>
  }

  const rows = report.data.details.filter(row => row.category === category)
  if (!rows.length) return <EmptyNote>{empty}</EmptyNote>

  return (
    <div role="table" aria-label={`${category === 'reverted' ? 'Reverted' : 'Abandoned'} sessions`}>
      <div className="sr-only" role="row">
        <span role="columnheader">Rank</span>
        <span role="columnheader">Project and session</span>
        <span role="columnheader">Cost</span>
      </div>
      {rows.map((row, i) => {
        const project = identified(row.project, 'Project not identified')
        const sessionId = identified(row.sessionId, 'Not available')
        const commitLabel = `${row.commitCount.toLocaleString('en-US')} ${row.commitCount === 1 ? 'commit' : 'commits'}`
        return (
          <div
            className="li"
            style={{ alignItems: 'flex-start' }}
            key={`${category}-${row.sessionId || i}`}
            role="row"
            aria-label={`${project}. ${commitLabel}. Session ID ${sessionId}. Cost ${formatUsd(row.costUSD)}.`}
          >
            <span className="no" role="cell">{String(i + 1).padStart(2, '0')}</span>
            <div className="lx" role="cell">
              <b>{project}</b>
              <span>{commitLabel} · Session ID {sessionId}</span>
            </div>
            <span className="val" role="cell">{formatUsd(row.costUSD)}</span>
          </div>
        )
      })}
    </div>
  )
}

function FixesRows({ data }: { data: MenubarPayload }) {
  return <FindingRows findings={data.optimize.topFindings} empty="No quick fixes in this range." />
}
