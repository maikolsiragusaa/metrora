export type BenchView =
  | 'overview'
  | 'performance'
  | 'model-evaluations'
  | 'coding-evaluations'
  | 'agent-evaluations'
  | 'advanced'

export type AdvancedBenchTab = 'performance' | 'compatibility'

export const BENCH_VIEWS: BenchView[] = [
  'overview',
  'performance',
  'model-evaluations',
  'coding-evaluations',
  'agent-evaluations',
  'advanced',
]
