import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { formatCompact, formatUsd } from '../lib/format'
import type { MenubarPayload } from '../lib/types'
import { ModelIdentity } from './ModelsDurableTable'
import { SpendKpiRow, SpendRankRow } from './SpendPrimitives'

export function SpendDrivers({ data }: { data: MenubarPayload }) {
  const current = data.current
  const modelRows = current.modelPresentation?.rows ?? current.topModels
  const activityRows = current.topActivities.length > 0
    ? current.topActivities.map(row => ({ ...row, brandId: undefined }))
    : modelRows.map(row => ({ name: row.name, cost: row.cost, savingsUSD: row.savingsUSD, turns: row.calls, oneShotRate: null, brandId: row.brandId }))

  return (
    <div className="spend-view spend-drivers-view" data-testid="spend-drivers-view">
      <SpendKpiRow items={[
        { label: 'Total spend', value: formatUsd(current.cost), detail: 'Observed cost', tone: 'accent' },
        { label: 'Calls', value: current.calls.toLocaleString('en-US'), detail: 'Metered API calls' },
        { label: 'Sessions', value: current.sessions.toLocaleString('en-US'), detail: 'In selected scope' },
        { label: 'Metered tokens', value: formatCompact(current.inputTokens + current.outputTokens + current.cacheReadTokens + current.cacheWriteTokens), detail: 'Observed volume' },
      ]} />

      <div className="spend-drivers-grid">
        <Panel title={current.topActivities.length ? 'Activity cost attribution' : 'Model cost attribution'} right="By observed spend" className="spend-ranking-panel">
          {activityRows.length ? activityRows.slice(0, 12).map((row, index) => (
            <SpendRankRow
              key={row.name}
              rank={index + 1}
              label={current.topActivities.length ? row.name : <ModelIdentity name={row.name} brandId={row.brandId} />}
              detail={`${row.turns.toLocaleString('en-US')} ${row.turns === 1 ? 'turn' : 'turns'}`}
              cost={row.cost}
              total={current.cost}
            />
          )) : <EmptyNote>No activity attribution in this range yet.</EmptyNote>}
        </Panel>

        {current.subagents.length ? (
          <Panel title="Subagent spend" right="Observed cost" className="spend-ranking-panel">
            {current.subagents.slice(0, 12).map((row, index) => (
              <SpendRankRow
                key={row.name}
                rank={index + 1}
                label={row.name}
                detail={`${row.calls.toLocaleString('en-US')} ${row.calls === 1 ? 'call' : 'calls'}`}
                cost={row.cost}
                total={current.cost}
              />
            ))}
          </Panel>
        ) : null}
      </div>
      {!activityRows.length && !current.subagents.length ? <EmptyNote>No spend driver attribution is available in this range yet.</EmptyNote> : null}
      <div className="spend-scope-note">Tools and MCP are available as call inventories elsewhere in Metrora; they are not spend dimensions in this view because the payload reports no monetary attribution for them.</div>
    </div>
  )
}
