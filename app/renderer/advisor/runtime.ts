import { formatAdvisorCreditsUsd, formatAdvisorPercent, formatAdvisorUsd, periodLabel, scopeLabel } from './evidence'
import type { AdvisorAnswer, AdvisorEvidence, AdvisorModelEvidenceRow, AdvisorModelRuntime, AdvisorRuntimeInput } from './types'
import { sanitizeAdvisorAnswer } from './privacy'

export class AdvisorRuntimeUnavailableError extends Error {
  constructor() {
    super('No verified Advisor model runtime is configured')
    this.name = 'AdvisorRuntimeUnavailableError'
  }
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Advisor investigation cancelled', 'AbortError')
}
function resetLabel(value: string | null): string | null {
  if (!value) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  const minutes = Math.ceil((time - Date.now()) / 60_000)
  if (minutes <= 0) return 'reset boundary has passed; refresh for the current window'
  if (minutes >= 1440) return 'resets in ' + Math.floor(minutes / 1440) + 'd'
  if (minutes >= 60) return 'resets in ' + Math.floor(minutes / 60) + 'h'
  return 'resets in ' + minutes + 'm'
}
function baseAnswer(evidence: AdvisorEvidence, runtime: AdvisorModelRuntime): AdvisorAnswer {
  return {
    conclusion: '',
    scopeLabel: scopeLabel(evidence.scope),
    periodLabel: periodLabel(evidence.scope),
    evidence: evidence.refs,
    coverage: evidence.coverage,
    assumptions: evidence.assumptions,
    unknown: evidence.unknown,
    nextInvestigations: evidence.nextInvestigations,
    details: [],
    runtime: { id: runtime.id, label: runtime.label, mode: runtime.mode },
  }
}
function modelRow(row: AdvisorModelEvidenceRow): string {
  return row.model + ' · ' + (row.costPerCallUSD === null ? 'cost per call unavailable' : formatAdvisorUsd(row.costPerCallUSD) + ' per observed call') + ' · ' + row.calls.toLocaleString('en-US') + ' calls'
}
function spendAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer): AdvisorAnswer {
  const spend = evidence.spend
  if (!spend || evidence.coverage.level === 'unavailable') return { ...answer, conclusion: 'I could not find measured spend for this scope yet.', details: ['No cost or call total was available from the canonical Overview payload.'] }
  const trend = spend.trend
  const trendText = trend ? ' The latest returned day was ' + formatAdvisorUsd(trend.latestCostUSD) + ', ' + (trend.direction === 'up' ? 'above' : trend.direction === 'down' ? 'below' : 'near') + ' the ' + trend.comparisonLabel + ' (' + formatAdvisorUsd(trend.comparisonCostUSD) + ').' : ''
  const driver = spend.models[0]
  const facts = [
    spend.measuredCostUSD === null ? null : 'Metrora measured ' + formatAdvisorUsd(spend.measuredCostUSD),
    spend.calls === null ? null : spend.calls.toLocaleString('en-US') + ' calls',
    spend.sessions === null ? null : spend.sessions.toLocaleString('en-US') + ' sessions',
  ].filter((item): item is string => Boolean(item))
  const intro = facts.length ? facts.join(' across ') + ' in this scope.' : 'Metrora returned no usable measured totals for this scope.'
  return {
    ...answer,
    conclusion: intro + trendText + (driver ? ' Largest represented model driver: ' + driver.name + ' at ' + formatAdvisorUsd(driver.costUSD) + '.' : ''),
    details: [
      ...spend.models.slice(0, 4).map(row => 'Model · ' + row.name + ' · ' + formatAdvisorUsd(row.costUSD) + ' · ' + row.calls.toLocaleString('en-US') + ' calls'),
      ...spend.projects.slice(0, 4).map(row => 'Project · ' + row.name + ' · ' + formatAdvisorUsd(row.costUSD) + ' · ' + row.calls.toLocaleString('en-US') + ' sessions'),
      ...(trend ? ['History · ' + trend.latestDate + ' vs ' + trend.comparisonLabel + ' · change ' + formatAdvisorUsd(trend.deltaUSD) + (trend.deltaPercent === null ? '' : ' (' + formatAdvisorPercent(trend.deltaPercent) + ')')] : []),
    ],
  }
}
function modelAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer): AdvisorAnswer {
  const model = evidence.modelEfficiency
  if (!model || !model.rows.length) return { ...answer, conclusion: 'I could not find model detail for this scope yet.', details: ['The canonical model report returned no rows for the selected context.'] }
  const best = model.rows[0]!
  return {
    ...answer,
    conclusion: 'The lowest observed cost per call' + (model.selectedModel ? ' for ' + model.selectedModel : '') + ' is ' + (best.costPerCallUSD === null ? 'not available' : formatAdvisorUsd(best.costPerCallUSD)) + ' on ' + best.model + '. This is a descriptive cost signal, not proof that the model is better for comparable work.',
    details: model.rows.slice(0, 8).map(modelRow),
  }
}
function quotaAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer): AdvisorAnswer {
  const quota = evidence.quota
  if (!quota || !quota.providers.length || evidence.coverage.level === 'unavailable') return { ...answer, conclusion: 'No usable provider-reported quota is available for this scope.', details: ['Quota is unavailable, so no remaining percentage, reset, plan, or credit number is shown.'] }
  const summaries: string[] = []
  const details: string[] = []
  for (const provider of quota.providers) {
    const name = provider.provider === 'claude' ? 'Claude' : 'Codex'
    const staleNote = provider.freshness === 'stale' ? ' Last observation ' + (provider.observedAt ? new Date(provider.observedAt).toLocaleString('en-US') : 'unknown') + '; refresh failed.' : provider.freshness === 'fresh' ? ' Fresh provider response.' : ' Provider response unavailable.'
    if (provider.freshness === 'unavailable') {
      summaries.push(name + ' quota is unavailable.')
      continue
    }
    const windows = provider.windows.map(window => {
      const reset = resetLabel(window.resetsAt)
      details.push(name + ' · ' + window.label + ' · ' + window.usedPercent + '% used · ' + window.remainingPercent + '% remaining' + (reset ? ' · ' + reset : ''))
      return window.label + ' ' + window.remainingPercent + '% remaining'
    })
    summaries.push(name + (provider.planLabel ? ' (' + provider.planLabel + ')' : '') + (windows.length ? ' reports ' + windows.join(', ') + '.' : ' reports no quota windows.') + staleNote)
    if (provider.creditsUSD !== null) details.push(name + ' · provider credits remaining · ' + formatAdvisorCreditsUsd(provider.creditsUSD))
  }
  if (quota.measuredSpendUSD !== null) details.push('Metrora usage context · ' + formatAdvisorUsd(quota.measuredSpendUSD) + ' measured spend · separate from provider quota authority.')
  return { ...answer, conclusion: summaries.join(' '), details }
}
export class DeterministicAdvisorRuntime implements AdvisorModelRuntime {
  readonly id = 'metrora-deterministic-local'
  readonly label = 'Metrora local evidence runtime'
  readonly mode = 'deterministic-local' as const
  readonly providerSupport = [] as const
  async generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> {
    throwIfAborted(signal)
    const answer = baseAnswer(input.evidence, this)
    if (input.evidence.intent === 'spend-change') return sanitizeAdvisorAnswer(spendAnswer(input.evidence, answer))
    if (input.evidence.intent === 'model-efficiency') return sanitizeAdvisorAnswer(modelAnswer(input.evidence, answer))
    if (input.evidence.intent === 'quota-capacity') return sanitizeAdvisorAnswer(quotaAnswer(input.evidence, answer))
    return { ...answer, conclusion: 'I can investigate spend changes, observed model efficiency, and provider quota. Try one of the suggested questions.', details: ['This local foundation does not send your question or Metrora data to a hosted model.'] }
  }
}
/** Explicit placeholder for future verified local/BYOK adapters; it never pretends to support a provider. */
export class UnsupportedAdvisorModelRuntime implements AdvisorModelRuntime {
  readonly id = 'unsupported-advisor-runtime'
  readonly label = 'No verified model runtime'
  readonly mode = 'unsupported' as const
  readonly providerSupport = [] as const
  async generate(_input: AdvisorRuntimeInput, _signal?: AbortSignal): Promise<AdvisorAnswer> {
    throw new AdvisorRuntimeUnavailableError()
  }
}
export function createAdvisorRuntime(): AdvisorModelRuntime {
  return new DeterministicAdvisorRuntime()
}
