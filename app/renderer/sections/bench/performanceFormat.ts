import type { PerformanceComparisonV1 } from '../../../../src/bench/performance-compare-v1'
import type { PerformanceRunV1 } from '../../../../src/bench/performance-contract-v1'

export function formatNumber(value: number): string {
  return value >= 100 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

export function formatMetric(value: number | null, unit: string): string {
  return value === null ? 'Not available' : formatNumber(value) + ' ' + unit
}

export function formatSignedMetric(value: number | null, unit: string): string {
  if (value === null) return 'Not available'
  return (value > 0 ? '+' : '') + formatNumber(value) + ' ' + unit
}

export function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString()
}

export function formatDuration(startedAt: string, endedAt: string): string {
  const duration = Date.parse(endedAt) - Date.parse(startedAt)
  if (!Number.isFinite(duration) || duration < 0) return 'Not available'
  return duration < 1_000 ? duration + ' ms' : formatNumber(duration / 1_000) + ' s'
}

export function performanceStatusLabel(record: PerformanceRunV1): string {
  if (record.status === 'completed') return 'Complete'
  if (record.status === 'cancelled') return 'Cancelled'
  if (record.status === 'unavailable') return 'Unavailable'
  return record.termination.status === 'timeout' ? 'Timed out' : 'Incomplete'
}

export function performanceStatusTone(record: PerformanceRunV1): string {
  if (record.status === 'completed') return 'completed'
  return record.status === 'cancelled' ? 'cancelled' : 'unavailable'
}

export function performanceMetric(value: number | null, unit: string): string {
  return value === null || !Number.isFinite(value) ? 'Not available' : formatNumber(value) + ' ' + unit
}

export function performanceWorkload(
  record: PerformanceRunV1,
  workload: 'prefill' | 'decode',
): PerformanceRunV1['workloads'][number] | null {
  return record.workloads.find(item => item.workload === workload) ?? null
}

export function performanceModelLabel(record: PerformanceRunV1): string {
  return record.model.type ? record.model.selected + ' · ' + record.model.type : record.model.selected
}

export function observedConfigurationLabel(record: Pick<PerformanceRunV1, 'observedConfiguration'>): string {
  const observed = record.observedConfiguration
  if (!observed) return 'Not reported'
  const value = [
    observed.batchSize === null ? null : 'batch ' + observed.batchSize,
    observed.ubatchSize === null ? null : 'ubatch ' + observed.ubatchSize,
    observed.threads === null ? null : 'threads ' + observed.threads,
    observed.gpuLayers === null ? null : 'GPU layers ' + observed.gpuLayers,
    observed.splitMode === null ? null : 'split ' + observed.splitMode,
    observed.mainGpu === null ? null : 'main GPU ' + observed.mainGpu,
    observed.flashAttention === null ? null : 'Flash Attention ' + observed.flashAttention,
    observed.promptTokens === null ? null : 'prompt ' + observed.promptTokens,
    observed.generationTokens === null ? null : 'generation ' + observed.generationTokens,
    observed.repetitions === null ? null : 'repetitions ' + observed.repetitions,
    observed.depth === null ? null : 'depth ' + observed.depth,
  ].filter((item): item is string => item !== null)
  return value.length ? value.join(' · ') : 'Not reported'
}

export function performanceComparisonReason(reason: PerformanceComparisonV1['reason']): string {
  if (reason === 'methodology-mismatch') return 'methodology identity differs'
  if (reason === 'runner-mismatch') return 'runner identity differs'
  if (reason === 'setup-mismatch') return 'declared setup differs'
  if (reason === 'observed-config-mismatch') return 'observed native configuration differs'
  if (reason === 'hardware-mismatch') return 'runtime, hardware, or environment identity differs'
  if (reason === 'incomplete-run') return 'one run did not complete'
  if (reason === 'missing-metrics') return 'required metrics are unavailable'
  return 'compatible'
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] ?? path
}
