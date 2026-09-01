import type { AdvisorPresentationBlockV1, AdvisorPresentationChartSeries } from '../advisor/types'

function chartValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable'
  return (unit === 'USD' ? '$' + value.toFixed(2) : value.toLocaleString('en-US')) + ' ' + unit
}
function chartSeriesSegments(series: AdvisorPresentationChartSeries, width: number, height: number, max: number): Array<Array<[number, number]>> {
  const segments: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> = []
  const denominator = Math.max(1, series.points.length - 1)
  series.points.forEach((point, index) => {
    if (point.value === null || !Number.isFinite(point.value)) {
      if (current.length) segments.push(current)
      current = []
      return
    }
    const x = 22 + (index / denominator) * (width - 42)
    const y = height - 22 - (point.value / max) * (height - 42)
    current.push([x, y])
  })
  if (current.length) segments.push(current)
  return segments
}

export function HarnessChartBlock({ block }: { block: Extract<AdvisorPresentationBlockV1, { kind: 'line-chart' | 'bar-chart' }> }) {
  const width = 620
  const height = 190
  const values = block.series.flatMap(series => series.points.map(point => point.value).filter((value): value is number => value !== null && Number.isFinite(value)))
  const max = Math.max(1, ...values)
  return (
    <section className="harness-v3-presentation-block harness-v3-chart-block">
      <div className="harness-v3-presentation-head"><h4>{block.title}</h4><span>{block.scopeLabel} · {block.periodLabel}</span></div>
      <p className="harness-v3-presentation-summary">{block.summary}</p>
      <svg className="harness-v3-chart" viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label={block.accessibilityLabel}>
        <line x1="22" y1={height - 22} x2={width - 20} y2={height - 22} />
        <line x1="22" y1="18" x2="22" y2={height - 22} />
        {block.kind === 'line-chart'
          ? block.series.map((series, index) => <g key={series.id} className={'harness-v3-chart-series series-' + index}>
              {chartSeriesSegments(series, width, height, max).map((segment, segmentIndex) => segment.length > 1 ? <polyline key={segmentIndex} points={segment.map(([x, y]) => x + ',' + y).join(' ')} /> : null)}
              {series.points.map((point, pointIndex) => {
                if (point.value === null || !Number.isFinite(point.value)) return null
                const denominator = Math.max(1, series.points.length - 1)
                const x = 22 + (pointIndex / denominator) * (width - 42)
                const y = height - 22 - (point.value / max) * (height - 42)
                return <circle key={pointIndex} cx={x} cy={y} r="2.6"><title>{series.label} · {point.label} · {chartValue(point.value, block.unit)}</title></circle>
              })}
            </g>)
          : block.series[0]?.points.map((point, index) => {
              if (point.value === null || !Number.isFinite(point.value)) return null
              const slot = (width - 42) / Math.max(1, block.series[0]!.points.length)
              const barWidth = Math.max(4, slot * .62)
              const x = 22 + index * slot + (slot - barWidth) / 2
              const y = height - 22 - (point.value / max) * (height - 42)
              return <rect key={index} x={x} y={y} width={barWidth} height={Math.max(1, height - 22 - y)}><title>{point.label} · {chartValue(point.value, block.unit)}</title></rect>
            })}
      </svg>
      <div className="harness-v3-chart-legend">{block.series.map((series, index) => <span key={series.id}><i className={'series-' + index} />{series.label}</span>)}</div>
      <div className="harness-v3-chart-data">{block.series.flatMap(series => series.points.filter(point => point.value !== null).slice(-6).map(point => <span key={series.id + '-' + point.label}>{series.label} · {point.label} · {chartValue(point.value, block.unit)}</span>))}</div>
    </section>
  )
}
