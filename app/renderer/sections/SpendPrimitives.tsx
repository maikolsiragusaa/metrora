import type { ReactNode } from 'react'

import { formatUsd } from '../lib/format'

export type SpendKpi = {
  label: string
  value: string
  detail?: string
  tone?: 'accent' | 'neutral'
}

export function SpendKpiRow({ items }: { items: SpendKpi[] }) {
  return (
    <div className="spend-kpi-grid">
      {items.map(item => (
        <div className={`spend-kpi spend-kpi-${item.tone ?? 'neutral'}`} key={item.label}>
          <span className="spend-kpi-label">{item.label}</span>
          <strong className="spend-kpi-value">{item.value}</strong>
          {item.detail ? <span className="spend-kpi-detail">{item.detail}</span> : null}
        </div>
      ))}
    </div>
  )
}

export function SpendRankRow({
  rank,
  label,
  detail,
  cost,
  total,
  leading,
  trailing,
}: {
  rank?: number
  label: ReactNode
  detail?: ReactNode
  cost: number
  total: number
  leading?: ReactNode
  trailing?: ReactNode
}) {
  const share = total > 0 ? Math.max(0, Math.min(1, cost / total)) : 0
  return (
    <div className="spend-rank-row">
      {rank !== undefined ? <span className="spend-rank-number">{String(rank).padStart(2, '0')}</span> : null}
      {leading ? <span className="spend-rank-leading">{leading}</span> : null}
      <div className="spend-rank-copy">
        <div className="spend-rank-line"><b>{label}</b><span>{formatUsd(cost)}</span></div>
        {detail ? <span className="spend-rank-detail">{detail}</span> : null}
        <span className="spend-rank-track" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></span>
      </div>
      {trailing ? <span className="spend-rank-trailing">{trailing}</span> : null}
    </div>
  )
}

export function SpendUnavailable({ children }: { children: ReactNode }) {
  return <span className="spend-unavailable">{children}</span>
}
