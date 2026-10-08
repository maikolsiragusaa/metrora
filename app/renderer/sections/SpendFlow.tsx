import { CliErrorText } from '../components/CliErrorPanel'
import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { SectionSkeleton } from '../components/Skeleton'
import { Sankey } from '../components/Sankey'
import { formatUsd, shortenProjectPath } from '../lib/format'
import { isOtherNode } from '../lib/modelSeries'
import type { Polled } from '../hooks/usePolled'
import type { SpendFlow as SpendFlowData } from '../lib/types'
import { SpendKpiRow, SpendRankRow } from './SpendPrimitives'

export function SpendFlow({ flow }: { flow: Polled<SpendFlowData> }) {
  const linksCost = flow.data?.links.reduce((sum, link) => sum + link.cost, 0) ?? null
  return (
    <div className="spend-view spend-flow-view" data-testid="spend-flow-view">
      <SpendKpiRow items={[
        { label: 'Linked spend', value: linksCost === null ? '—' : formatUsd(linksCost), detail: 'Observed model → project links', tone: 'accent' },
        { label: 'Models', value: flow.data?.models.length.toLocaleString('en-US') ?? '—', detail: 'Represented in flow' },
        { label: 'Projects', value: flow.data?.projects.length.toLocaleString('en-US') ?? '—', detail: 'Represented in flow' },
        { label: 'Links', value: flow.data?.links.length.toLocaleString('en-US') ?? '—', detail: 'Directional relationships' },
      ]} />

      <Panel title="Cost flow · model → project" right={flow.switching ? 'Refreshing flow…' : flow.data ? 'Observed cost allocation' : 'Building flow…'} className="spend-flow-panel">
        {flow.data && flow.data.links.length ? (
          <Sankey flow={flow.data} />
        ) : flow.error ? (
          <CliErrorText error={flow.error} />
        ) : flow.loading ? (
          <div className="spend-flow-loading" role="status" aria-live="polite">
            <SectionSkeleton label="Building model → project flow…" rows={2} chart />
          </div>
        ) : (
          <EmptyNote>No model-project flow in this range yet.</EmptyNote>
        )}
      </Panel>

      {flow.data && flow.data.links.length ? (
        <div className="spend-flow-support">
          <Panel title="Models in flow" right="Observed spend" className="spend-ranking-panel">
            {flow.data.models.map((node, index) => (
              <SpendRankRow key={node.id} rank={index + 1} label={node.label} cost={node.cost} total={linksCost ?? 0} />
            ))}
          </Panel>
          <Panel title="Projects in flow" right="Observed spend" className="spend-ranking-panel">
            {flow.data.projects.map((node, index) => (
              <SpendRankRow key={node.id} rank={index + 1} label={isOtherNode(node.label) ? 'Other' : shortenProjectPath(node.label)} cost={node.cost} total={linksCost ?? 0} />
            ))}
          </Panel>
        </div>
      ) : null}
    </div>
  )
}
