import { EmptyNote } from '../components/EmptyState'
import { ModelIdentity } from './ModelsDurableTable'
import { Panel } from '../components/Panel'
import { formatCompact, formatUsd } from '../lib/format'
import { observedTokenTotal } from '../lib/usageMetrics'
import type { DailyHistoryEntry, MenubarPayload } from '../lib/types'
import { SpendDailyChart } from './SpendDailyChart'
import { SpendKpiRow, SpendRankRow } from './SpendPrimitives'

export function SpendOverview({
  data,
  daily,
  animateKey,
}: {
  data: MenubarPayload
  daily: DailyHistoryEntry[]
  animateKey: string
}) {
  const current = data.current
  const modelRows = current.modelPresentation?.rows ?? current.topModels
  const activityRows = current.topActivities

  return (
    <div className="spend-view spend-overview-view" data-testid="spend-overview-view">
      <SpendKpiRow items={[
        { label: 'Total spend', value: formatUsd(current.cost), detail: 'Observed cost', tone: 'accent' },
        { label: 'Sessions', value: current.sessions.toLocaleString('en-US'), detail: 'In selected scope' },
        { label: 'Calls', value: current.calls.toLocaleString('en-US'), detail: 'Metered API calls' },
        { label: 'Metered tokens', value: formatCompact(observedTokenTotal(current)), detail: 'Input, output & cache' },
      ]} />

      <Panel title="Daily spend" right={daily.length ? 'Observed cost over time' : undefined} className="spend-chart-panel">
        {daily.some(day => day.cost > 0)
          ? <SpendDailyChart daily={daily} animateKey={animateKey} />
          : <EmptyNote>No observed spend in this range yet.</EmptyNote>}
      </Panel>

      <div className="spend-overview-grid">
        <Panel title="Top projects" right={current.topProjects.length ? 'By observed spend' : undefined} className="spend-ranking-panel">
          {current.topProjects.length ? current.topProjects.map((project, index) => (
            <SpendRankRow
              key={project.name}
              rank={index + 1}
              label={project.name}
              detail={`${project.sessions.toLocaleString('en-US')} ${project.sessions === 1 ? 'session' : 'sessions'}`}
              cost={project.cost}
              total={current.cost}
            />
          )) : <EmptyNote>No project spend in this range yet.</EmptyNote>}
        </Panel>

        <Panel title={activityRows.length ? 'Top activities by spend' : 'Top models by spend'} right="Observed cost" className="spend-ranking-panel">
          {activityRows.length ? activityRows.slice(0, 8).map((activity, index) => (
            <SpendRankRow
              key={activity.name}
              rank={index + 1}
              label={activity.name}
              detail={`${activity.turns.toLocaleString('en-US')} ${activity.turns === 1 ? 'turn' : 'turns'}`}
              cost={activity.cost}
              total={current.cost}
            />
          )) : modelRows.length ? modelRows.slice(0, 8).map((model, index) => (
            <SpendRankRow
              key={model.name}
              rank={index + 1}
              label={<ModelIdentity name={model.name} brandId={'brandId' in model ? model.brandId : undefined} />}
              detail={`${model.calls.toLocaleString('en-US')} ${model.calls === 1 ? 'call' : 'calls'}`}
              cost={model.cost}
              total={current.cost}
            />
          )) : <EmptyNote>No activity or model spend in this range yet.</EmptyNote>}
        </Panel>
      </div>

      <div className="spend-scope-note">Scope: {current.label} · {formatUsd(current.cost)} observed across {current.sessions.toLocaleString('en-US')} sessions.</div>
    </div>
  )
}
