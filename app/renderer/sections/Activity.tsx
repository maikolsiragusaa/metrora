import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { CliErrorPanel } from '../components/CliErrorPanel'
import { SectionSkeleton } from '../components/Skeleton'
import type { Polled } from '../hooks/usePolled'
import { formatDayShort, formatUsd } from '../lib/format'
import type { MenubarPayload } from '../lib/types'
import type { Section } from '../lib/desktopNavigation'

export function Activity({ overview, onNavigate }: { overview: Polled<MenubarPayload>; onNavigate?: (section: Section) => void }) {
  const { data, error } = overview
  if (!data) {
    if (error) return <CliErrorPanel error={error} subject="activity" />
    return <SectionSkeleton label="Loading activity…" rows={3} />
  }

  const sessions = data.current.topSessions.slice(0, 6)
  const pullRequests = data.current.pullRequests?.rows.slice(0, 6) ?? []
  const activities = data.current.topActivities.slice(0, 6)

  return (
    <div className="control-center-section activity-section">
      <div className="control-center-section__intro">
        <div>
          <span className="eyebrow">Activity</span>
          <h1>Usage signals, in one place.</h1>
          <p>Sessions, pull requests, and work patterns from the current Metrora scope.</p>
        </div>
        <div className="activity-section__scope">{data.current.label}</div>
      </div>

      {error && <div className="stale-banner" role="status">Showing the last good activity snapshot.</div>}

      <div className="activity-section__metrics" aria-label="Activity summary">
        <div className="control-center-stat"><span>Sessions</span><strong>{data.current.sessions.toLocaleString('en-US')}</strong><small>tracked in scope</small></div>
        <div className="control-center-stat"><span>Calls</span><strong>{data.current.calls.toLocaleString('en-US')}</strong><small>metered calls</small></div>
        <div className="control-center-stat"><span>Pull requests</span><strong>{data.current.pullRequests?.distinctSessions?.toLocaleString('en-US') ?? '—'}</strong><small>{pullRequests.length ? 'linked activity' : 'no linked activity yet'}</small></div>
      </div>

      <div className="activity-section__grid">
        <Panel title="Recent sessions" right={<button className="ov-link" type="button" onClick={() => onNavigate?.('sessions')}>Open Sessions →</button>}>
          {sessions.length ? sessions.map((session, index) => (
            <button className="activity-row" type="button" key={`${session.project}-${session.date}-${index}`} onClick={() => onNavigate?.('sessions')}>
              <span className="activity-row__main"><strong>{session.project}</strong><small>{formatDayShort(session.date)} · {session.calls.toLocaleString('en-US')} calls</small></span>
              <span className="activity-row__value">{formatUsd(session.cost)}</span>
            </button>
          )) : <EmptyNote>No sessions in this range.</EmptyNote>}
        </Panel>

        <Panel title="Pull request signal" right={<button className="ov-link" type="button" onClick={() => onNavigate?.('pullRequests')}>Open Pull Requests →</button>}>
          {pullRequests.length ? pullRequests.map(row => (
            <button className="activity-row" type="button" key={row.url} onClick={() => onNavigate?.('pullRequests')}>
              <span className="activity-row__main"><strong>{row.label}</strong><small>{row.sessions.toLocaleString('en-US')} sessions · {row.calls.toLocaleString('en-US')} calls</small></span>
              <span className="activity-row__value">{formatUsd(row.cost)}</span>
            </button>
          )) : <EmptyNote>No pull-request links were observed in this scope.</EmptyNote>}
        </Panel>

        <Panel title="Top activities" right="Sorted by cost">
          {activities.length ? activities.map(activity => (
            <div className="activity-row activity-row--static" key={activity.name}>
              <span className="activity-row__main"><strong>{activity.name}</strong><small>{activity.turns.toLocaleString('en-US')} turns</small></span>
              <span className="activity-row__value">{formatUsd(activity.cost)}</span>
            </div>
          )) : <EmptyNote>No activity in this range yet.</EmptyNote>}
        </Panel>
      </div>
    </div>
  )
}
