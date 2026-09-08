import { useEffect, useMemo, useState } from 'react'

import { ProviderLogo } from '../components/ProviderLogo'
import { formatCompact, formatDuration, formatUsd, shortenProjectPath } from '../lib/format'
import { metrora } from '../lib/ipc'
import type { SessionRow } from '../lib/types'
import {
  formatPrLabel,
  formatReuseMultiple,
  formatSessionTime,
  hasObservedReasoning,
  providerName,
  reasoningCoverageLabel,
  reasoningMixLabel,
  REASONING_LABELS,
  sessionCacheReuse,
  sessionCacheShare,
  sessionHeadline,
  sessionTotalTokens,
} from './sessions-presentation'

type InspectorTab = 'overview' | 'reasoning' | 'metadata'

function InspectorMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="session-inspector-metric" title={detail ? `${label}: ${detail}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function TokenActivity({ session }: { session: SessionRow }) {
  const points = session.tokenActivity ?? []
  const total = sessionTotalTokens(session)
  const maxPoint = useMemo(() => Math.max(0, ...points.map(point => point.totalTokens)), [points])
  const activityCalls = points.reduce((sum, point) => sum + point.calls, 0)
  const summary = [
    `Input ${formatCompact(session.inputTokens)}`,
    `Output ${formatCompact(session.outputTokens)}`,
    `Cache R ${formatCompact(session.cacheReadTokens)}`,
    `Cache W ${formatCompact(session.cacheWriteTokens)}`,
  ].join(' · ')

  return (
    <section className="session-inspector-chart" aria-labelledby="session-token-activity-title">
      <div className="session-inspector-section-head">
        <div>
          <h3 id="session-token-activity-title">Token activity</h3>
          <span>{points.length > 0 ? `${activityCalls.toLocaleString('en-US')} calls · ${points.length} points` : 'Temporal call evidence unavailable'}</span>
        </div>
        <span>{formatCompact(total)} total</span>
      </div>
      {points.length > 0 ? (
        <div className="session-token-activity-plot" role="img" aria-label={`Token activity: ${activityCalls.toLocaleString('en-US')} canonical calls across ${points.length} points, reconciling to ${formatCompact(total)} total tokens.`}>
          <div className="session-token-activity-grid">
            {points.map((point, index) => (
              <span
                className="session-token-activity-bar"
                key={`${point.timestamp}-${index}`}
                title={`${formatSessionTime(point.timestamp)} · ${point.calls.toLocaleString('en-US')} calls · ${formatCompact(point.totalTokens)} total`}
                style={{ height: `${maxPoint > 0 ? Math.max(8, point.totalTokens / maxPoint * 100) : 8}%` }}
              >
                <i className="session-token-activity-segment session-token-activity-segment--input" style={{ flexGrow: point.inputTokens }} />
                <i className="session-token-activity-segment session-token-activity-segment--output" style={{ flexGrow: point.outputTokens }} />
                <i className="session-token-activity-segment session-token-activity-segment--cache-read" style={{ flexGrow: point.cacheReadTokens }} />
                <i className="session-token-activity-segment session-token-activity-segment--cache-write" style={{ flexGrow: point.cacheWriteTokens }} />
                <i className="session-token-activity-segment session-token-activity-segment--reasoning" style={{ flexGrow: point.additiveReasoningTokens }} />
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="session-token-activity-unavailable" role="status">Temporal call activity is unavailable for this row; aggregate totals remain canonical.</div>
      )}
      <div className="session-token-activity-summary">{summary}</div>
    </section>
  )
}

function ReasoningView({ session }: { session: SessionRow }) {
  const mix = session.reasoningMix
  if (!mix) {
    return <p className="session-inspector-empty-note">Reasoning evidence is unavailable for this session; it is not inferred.</p>
  }
  return (
    <section className="session-reasoning-view" aria-label="Reasoning evidence">
      <div className="session-inspector-section-head">
        <div>
          <h3>Observed reasoning</h3>
          <span>{reasoningCoverageLabel(mix)}</span>
        </div>
        <span>{reasoningMixLabel(mix)}</span>
      </div>
      {mix.rows.length > 0 ? (
        <div className="session-reasoning-rows">
          {mix.rows.map(row => (
            <div className="session-reasoning-row" key={row.level}>
              <div className="session-reasoning-row-head">
                <strong>{REASONING_LABELS[row.level]}</strong>
                <span>{Math.round(row.callShare * 100)}% · {row.calls.toLocaleString('en-US')} calls</span>
              </div>
              <div className="session-reasoning-track" aria-hidden="true">
                <span style={{ width: `${Math.max(2, row.callShare * 100)}%` }} />
              </div>
              <small>{formatCompact(row.reasoningTokens)} reasoning tokens · {formatUsd(row.costUSD)}</small>
            </div>
          ))}
        </div>
      ) : <p className="session-inspector-empty-note">No attributed reasoning calls in this session.</p>}
    </section>
  )
}

function MetadataView({ session }: { session: SessionRow }) {
  const modelLabel = session.models.length > 0 ? session.models.join(', ') : 'Model not identified'
  return (
    <dl className="session-metadata-view">
      <div><dt>Session ID</dt><dd title={session.sessionId}>{session.sessionId}</dd></div>
      <div><dt>Client</dt><dd>{providerName(session.provider)}</dd></div>
      <div><dt>Project</dt><dd title={session.project}>{shortenProjectPath(session.project)}</dd></div>
      <div><dt>Model</dt><dd title={modelLabel}>{modelLabel}</dd></div>
      <div><dt>Started</dt><dd>{formatSessionTime(session.startedAt)}</dd></div>
      <div><dt>Last activity</dt><dd>{formatSessionTime(session.endedAt)}</dd></div>
      <div><dt>Duration</dt><dd>{formatDuration(session.durationMs)}</dd></div>
    </dl>
  )
}

function LinkedPullRequests({ session }: { session: SessionRow }) {
  if (!session.prLinks?.length) return null
  return (
    <section className="session-linked-prs" aria-label="Linked pull requests">
      <div className="session-inspector-section-head">
        <div>
          <h3>Linked pull requests</h3>
          <span>Exact session linkage</span>
        </div>
        <span>{session.prLinks.length}</span>
      </div>
      <ul>
        {session.prLinks.map(url => (
          <li key={url}>
            <span className="session-pr-icon" aria-hidden="true">↗</span>
            <a
              href={url}
              title={url}
              onClick={event => {
                event.preventDefault()
                if (typeof metrora.openExternal === 'function') void metrora.openExternal(url)
              }}
            >
              {formatPrLabel(url)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SessionsInspector({ session, inspectorId, onClose }: { session: SessionRow; inspectorId: string; onClose: () => void }) {
  const [tab, setTab] = useState<InspectorTab>('overview')
  const hasReasoningTab = Boolean(session.reasoningMix)
  const reuse = sessionCacheReuse(session)
  const share = sessionCacheShare(session)
  const observedReasoning = hasObservedReasoning(session)
  const titleId = `${inspectorId}-title`

  useEffect(() => {
    setTab('overview')
  }, [inspectorId])

  useEffect(() => {
    if (!hasReasoningTab && tab === 'reasoning') setTab('overview')
  }, [hasReasoningTab, tab])

  return (
    <aside className="session-inspector" id={inspectorId} aria-label="Session inspector" aria-labelledby={titleId}>
      <div className="session-inspector-header">
        <div className="session-inspector-kicker">Session detail</div>
        <button type="button" className="session-inspector-close" aria-label="Close session inspector" onClick={onClose}>×</button>
        <h2 id={titleId} title={sessionHeadline(session)}>{sessionHeadline(session)}</h2>
        <div className="session-inspector-id" title={session.sessionId}>{session.sessionId}</div>
        <div className="session-inspector-identity">
          <ProviderLogo provider={session.provider} size={16} />
          <strong>{providerName(session.provider)}</strong>
          <span>·</span>
          <span title={session.models.join(', ')}>{session.models.join(', ') || 'Model not identified'}</span>
        </div>
        <div className="session-inspector-project" title={session.project}>{shortenProjectPath(session.project)}</div>
        <div className="session-inspector-time">
          <span>{formatSessionTime(session.startedAt)} → {formatSessionTime(session.endedAt)}</span>
          <strong>{formatDuration(session.durationMs)}</strong>
        </div>
      </div>

      <div className="session-inspector-metrics" aria-label="Session metrics">
        <InspectorMetric label="Total cost" value={formatUsd(session.cost)} detail="API-equivalent value" />
        <InspectorMetric label="Total tokens" value={formatCompact(sessionTotalTokens(session))} detail="observed volume" />
        <InspectorMetric label="Calls" value={session.calls.toLocaleString('en-US')} detail="API calls" />
        <InspectorMetric label="Duration" value={formatDuration(session.durationMs)} detail="source span" />
        <InspectorMetric label="Cache read" value={formatCompact(session.cacheReadTokens)} detail="reused input" />
        <InspectorMetric label="Cache write" value={formatCompact(session.cacheWriteTokens)} detail="written input" />
        <InspectorMetric label="Cache reuse" value={formatReuseMultiple(reuse)} detail={share == null ? 'no comparable input' : `${Math.round(share * 1000) / 10}% cache share`} />
        <InspectorMetric label="Input" value={formatCompact(session.inputTokens)} detail="uncached input" />
        <InspectorMetric label="Output" value={formatCompact(session.outputTokens)} detail="generated output" />
        <InspectorMetric label="Reasoning observed" value={observedReasoning ? formatCompact(session.reasoningTokens!) : '—'} detail={observedReasoning ? 'observed evidence' : 'not exposed by this source'} />
      </div>

      <div className="session-inspector-tabs" role="tablist" aria-label="Session detail views">
        <button type="button" role="tab" aria-selected={tab === 'overview'} tabIndex={tab === 'overview' ? 0 : -1} onClick={() => setTab('overview')}>Overview</button>
        {hasReasoningTab ? <button type="button" role="tab" aria-selected={tab === 'reasoning'} tabIndex={tab === 'reasoning' ? 0 : -1} onClick={() => setTab('reasoning')}>Reasoning</button> : null}
        <button type="button" role="tab" aria-selected={tab === 'metadata'} tabIndex={tab === 'metadata' ? 0 : -1} onClick={() => setTab('metadata')}>Metadata</button>
      </div>

      <div className="session-inspector-tab-panel" role="tabpanel">
        {tab === 'overview' ? (
          <>
            <TokenActivity session={session} />
            <div className="session-inspector-evidence">
              <span>Reasoning</span>
              <strong>{observedReasoning ? reasoningMixLabel(session.reasoningMix) : 'Evidence unavailable'}</strong>
              <small>{observedReasoning ? reasoningCoverageLabel(session.reasoningMix) : 'This source did not expose an observed reasoning-token count.'}</small>
            </div>
            <LinkedPullRequests session={session} />
          </>
        ) : tab === 'reasoning' ? (
          <ReasoningView session={session} />
        ) : <MetadataView session={session} />}
      </div>

    </aside>
  )
}
