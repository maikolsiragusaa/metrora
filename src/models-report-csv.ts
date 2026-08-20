import { CATEGORY_LABELS, type TaskCategory } from './types.js'
import type { ModelReportRow } from './models-report-types.js'
function categoryLabel(category: TaskCategory): string {
  return CATEGORY_LABELS[category] ?? category
}
function csvEscape(value: string | undefined | null): string {
  if (value === undefined || value === null) return ''
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}
/** CSV renderer kept separate so the model aggregation module stays focused. */
export function renderCsv(rows: ModelReportRow[], opts: { byTask?: boolean; byAgent?: boolean } = {}): string {
  const byTask = opts.byTask ?? false
  const byAgent = opts.byAgent ?? false
  const header = byAgent
    ? ['provider', 'model', 'agent', 'input_tokens', 'output_tokens', 'reasoning_tokens', 'additive_reasoning_tokens', 'cache_write_tokens', 'cache_read_tokens', 'total_tokens', 'calls', 'cost_usd', 'savings_usd', 'savings_baseline_model']
    : byTask
    ? ['provider', 'model', 'task', 'input_tokens', 'output_tokens', 'reasoning_tokens', 'additive_reasoning_tokens', 'cache_write_tokens', 'cache_read_tokens', 'total_tokens', 'calls', 'cost_usd', 'savings_usd', 'savings_baseline_model']
    : ['provider', 'model', 'top_task', 'top_task_share', 'input_tokens', 'output_tokens', 'reasoning_tokens', 'additive_reasoning_tokens', 'cache_write_tokens', 'cache_read_tokens', 'total_tokens', 'calls', 'cost_usd', 'savings_usd', 'savings_baseline_model']
  const lines: string[] = [header.join(',')]
  for (const r of rows) {
    const cells = byAgent
      ? [
          csvEscape(r.providerDisplayName),
          csvEscape(r.modelDisplayName),
          csvEscape(r.agentType ?? ''),
          String(r.inputTokens),
          String(r.outputTokens),
          String(r.reasoningTokens ?? 0),
          String(r.additiveReasoningTokens ?? 0),
          String(r.cacheWriteTokens),
          String(r.cacheReadTokens),
          String(r.totalTokens),
          String(r.calls),
          r.costUSD.toFixed(6),
          (r.savingsUSD ?? 0).toFixed(6),
          csvEscape(r.savingsBaselineModel),
        ]
      : byTask
      ? [
          csvEscape(r.providerDisplayName),
          csvEscape(r.modelDisplayName),
          r.category ? categoryLabel(r.category) : '',
          String(r.inputTokens),
          String(r.outputTokens),
          String(r.reasoningTokens ?? 0),
          String(r.additiveReasoningTokens ?? 0),
          String(r.cacheWriteTokens),
          String(r.cacheReadTokens),
          String(r.totalTokens),
          String(r.calls),
          r.costUSD.toFixed(6),
          (r.savingsUSD ?? 0).toFixed(6),
          csvEscape(r.savingsBaselineModel),
        ]
      : [
          csvEscape(r.providerDisplayName),
          csvEscape(r.modelDisplayName),
          r.topCategory ? categoryLabel(r.topCategory) : '',
          r.topCategoryShare !== undefined ? r.topCategoryShare.toFixed(4) : '',
          String(r.inputTokens),
          String(r.outputTokens),
          String(r.reasoningTokens ?? 0),
          String(r.additiveReasoningTokens ?? 0),
          String(r.cacheWriteTokens),
          String(r.cacheReadTokens),
          String(r.totalTokens),
          String(r.calls),
          r.costUSD.toFixed(6),
          (r.savingsUSD ?? 0).toFixed(6),
          csvEscape(r.savingsBaselineModel),
        ]
    lines.push(cells.join(','))
  }
  return lines.join('\n')
}
