import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { formatCompact, formatUsd } from '../lib/format'
import type { WorkspaceUsage } from './workspaceUsage'

export function WorkspaceUsagePanel({
  usage,
  scope,
  analyticsLoading,
}: {
  usage: WorkspaceUsage | null
  scope: string
  analyticsLoading: boolean
}) {
  return (
    <Panel title="Canonical usage" right={scope}>
      {usage ? (
        <>
          <div className="workspace-usage-note">
            These values are read directly from the current Overview payload. Workspace evidence and signed batches never recalculate them.
          </div>
          <div className="workspace-stats" aria-label="Canonical Overview usage">
            <UsageStat label="Cost" value={formatUsd(usage.cost)} testId="workspace-cost" />
            <UsageStat label="Calls" value={formatCompact(usage.calls)} testId="workspace-calls" />
            <UsageStat label="Sessions" value={formatCompact(usage.sessions)} testId="workspace-sessions" />
            <UsageStat label="Input tokens" value={formatCompact(usage.inputTokens)} testId="workspace-input-tokens" />
            <UsageStat label="Output tokens" value={formatCompact(usage.outputTokens)} testId="workspace-output-tokens" />
            <UsageStat label="Cache read" value={formatCompact(usage.cacheReadTokens)} testId="workspace-cache-read" />
            <UsageStat label="Cache write" value={formatCompact(usage.cacheWriteTokens)} testId="workspace-cache-write" />
            <UsageStat
              label="Pricing coverage"
              value={usage.pricingCoverage == null ? 'Not available' : `${Math.round(usage.pricingCoverage * 1000) / 10}%`}
              testId="workspace-pricing-coverage"
            />
          </div>
          <div className="workspace-source-line">Overview period: {usage.label}{analyticsLoading ? ' · refreshing' : ''}</div>
        </>
      ) : (
        <EmptyNote>Canonical Overview analytics are still loading. Workspace identity and evidence actions remain separate.</EmptyNote>
      )}
    </Panel>
  )
}

function UsageStat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="workspace-stat">
      <span>{label}</span>
      <b data-testid={testId}>{value}</b>
    </div>
  )
}
