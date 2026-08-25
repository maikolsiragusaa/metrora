import { formatAdvisorCreditsUsd, formatAdvisorPercent, formatAdvisorUsd, periodLabel, scopeLabel } from './evidence'
import type { AdvisorAnswer, AdvisorEvidence, AdvisorModelEvidenceRow, AdvisorModelRuntime, AdvisorRuntimeInput } from './types'
import { sanitizeAdvisorAnswer } from './privacy'
import { buildAdvisorPresentationBlocks } from './presentation'

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
    why: [],
    materialLimits: [],
    understanding: evidence.understanding,
    plan: evidence.plan,
    actionProposal: evidence.actionProposal,
    runtime: { id: runtime.id, label: runtime.label, mode: runtime.mode },
  }
}

function socialAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer): AdvisorAnswer {
  const value = evidence.question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/^(?:grazie|grazie mille|thanks|thank you|thankyou|much appreciated)[!.?,\s]*$/u.test(value)) {
    return { ...answer, conclusion: 'Di nulla. Quando vuoi, possiamo guardare un altro periodo o confronto.' }
  }
  if (/^(?:come stai|how are you)[!?.,\s]*$/u.test(value)) {
    return { ...answer, conclusion: 'Bene, grazie. Sono qui per aiutarti a leggere i dati di Metrora.' }
  }
  return { ...answer, conclusion: 'Buongiorno. Posso aiutarti a capire spesa, modelli, Projects, sessioni, quota e risultati Bench.' }
}

function actionProposalAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer): AdvisorAnswer {
  return {
    ...answer,
    conclusion: evidence.understanding?.boundary ?? 'This request needs a separately authorized action proposal; no action was executed.',
    materialLimits: ['Advisor can read and explain existing Metrora evidence here. It does not execute Bench runs, launch agents, change routing, or apply policy from conversation text.'],
    details: ['Action state · proposal only', 'Execution · not requested from an authorized action surface'],
  }
}
function modelRow(row: AdvisorModelEvidenceRow): string {
  return row.model + ' · ' + (row.costPerCallUSD === null ? 'cost per call unavailable' : formatAdvisorUsd(row.costPerCallUSD) + ' per observed call') + ' · ' + row.calls.toLocaleString('en-US') + ' calls'
}
function spendAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer): AdvisorAnswer {
  const spend = evidence.spend
  if (!spend || evidence.coverage.level === 'unavailable') return {
    ...answer,
    conclusion: 'I do not have measured spend for this scope yet.',
    materialLimits: ['No measured cost or call total was available for the selected scope.'],
    details: ['No measured usage total was returned.'],
  }
  if (evidence.coverage.state === 'NO_DATA' && (spend.calls === 0 || spend.calls === null) && (spend.measuredCostUSD === 0 || spend.measuredCostUSD === null)) return {
    ...answer,
    conclusion: 'Metrora measured no spend or calls in this scope.',
    materialLimits: ['This is an explicit zero in the selected scope, not an unavailable result.'],
    details: ['Measured spend · $0.00', 'Measured calls · 0'],
  }
  const trend = spend.trend
  const driver = spend.models[0]
  const facts = [
    spend.measuredCostUSD === null ? null : 'Metrora measured ' + formatAdvisorUsd(spend.measuredCostUSD),
    spend.calls === null ? null : spend.calls.toLocaleString('en-US') + ' calls',
    spend.sessions === null ? null : spend.sessions.toLocaleString('en-US') + ' sessions',
  ].filter((item): item is string => Boolean(item))
  const intro = facts.length ? facts.join(' across ') + ' in this scope.' : 'Metrora returned no usable measured totals for this scope.'
  return {
    ...answer,
    conclusion: intro + (driver ? ' Largest represented model driver: ' + driver.name + '.' : ''),
    why: [
      ...(trend ? ['The latest returned day was ' + formatAdvisorUsd(trend.latestCostUSD) + ', ' + (trend.direction === 'up' ? 'above' : trend.direction === 'down' ? 'below' : 'near') + ' the ' + trend.comparisonLabel + ' (' + formatAdvisorUsd(trend.comparisonCostUSD) + ').'] : []),
      ...(driver ? ['The largest represented model driver was ' + driver.name + ' at ' + formatAdvisorUsd(driver.costUSD) + '.'] : []),
    ],
    materialLimits: [
      'The driver list describes measured patterns; it does not prove causality.',
    ],
    details: [
      ...spend.models.slice(0, 4).map(row => 'Model · ' + row.name + ' · ' + formatAdvisorUsd(row.costUSD) + ' · ' + row.calls.toLocaleString('en-US') + ' calls'),
      ...spend.projects.slice(0, 4).map(row => 'Project · ' + row.name + ' · ' + formatAdvisorUsd(row.costUSD) + ' · ' + row.calls.toLocaleString('en-US') + ' sessions'),
      ...(trend ? ['History · ' + trend.latestDate + ' vs ' + trend.comparisonLabel + ' · change ' + formatAdvisorUsd(trend.deltaUSD) + (trend.deltaPercent === null ? '' : ' (' + formatAdvisorPercent(trend.deltaPercent) + ')')] : []),
    ],
  }
}
function modelAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer): AdvisorAnswer {
  const model = evidence.modelEfficiency
  if (!model || !model.rows.length) return {
    ...answer,
    conclusion: 'I do not have model cost detail for this scope yet.',
    materialLimits: ['No model rows were available for the selected context.'],
    details: ['No model usage detail was returned.'],
  }
  const lowest = model.rows[0]!
  return {
    ...answer,
    conclusion: 'The lowest observed cost per call' + (model.selectedModel ? ' for ' + model.selectedModel : '') + ' is ' + (lowest.costPerCallUSD === null ? 'not available' : formatAdvisorUsd(lowest.costPerCallUSD)) + ' on ' + lowest.model + '.',
    why: ['This is an observed cost signal from the selected scope.'],
    materialLimits: [
      'The comparison does not measure task quality, complexity, output quality, or which model is better overall.',
    ],
    details: model.rows.slice(0, 8).map(modelRow),
  }
}
function quotaAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer): AdvisorAnswer {
  const quota = evidence.quota
  if (!quota || !quota.providers.length || evidence.coverage.level === 'unavailable') return { ...answer, conclusion: 'No provider-reported quota is available for this scope.', materialLimits: ['No quota number is shown because the provider response is unavailable; Metrora usage is a separate source.'], details: ['No remaining percentage, reset, plan, or credit number is shown.'] }
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
  return { ...answer, conclusion: summaries.join(' '), why: ['These figures come from provider-reported quota, not a forecast from Metrora usage.'], materialLimits: ['Provider quota can be stale or incomplete; Metrora does not estimate a reset or remaining balance.'], details }
}
function benchAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer): AdvisorAnswer {
  const bench = evidence.bench
  const latest = bench?.latest
  if (!latest) return {
    ...answer,
    conclusion: bench?.state === 'NO_DATA' ? 'I do not have a completed controlled Bench result for this scope yet.' : 'The controlled Bench result is unavailable or incomplete.',
    materialLimits: ['No score or task outcome is inferred when the controlled result is unavailable.', 'Ask Metrora to compare only canonical runs with matching identities.'],
    details: [],
  }
  if (bench?.comparison?.compatibility === 'incompatible') return {
    ...answer,
    conclusion: 'These controlled runs cannot be compared because their test setup is different.',
    why: ['Metrora kept the comparison blocked rather than treating different packs or policies as equivalent.'],
    materialLimits: ['A controlled test result does not establish universal model quality or a recommendation.'],
    details: latest.tasks.slice(0, 12).map(task => task.taskId + ' · ' + task.status),
  }
  const score = latest.aggregate.scoreValue === null ? 'no score' : formatAdvisorPercent(latest.aggregate.scoreValue) + ' score'
  const comparison = bench?.comparison
  return {
    ...answer,
    conclusion: 'In the latest controlled test, ' + latest.model.selected + ' passed ' + latest.aggregate.passed + ' of ' + latest.aggregate.planned + ' planned tasks with ' + score + '.',
    why: [
      ...(comparison?.compatibility === 'compatible' && comparison.passedDelta !== null ? ['Compared with the prior compatible run, passed tasks changed by ' + comparison.passedDelta + '.'] : []),
      ...(comparison?.compatibility === 'compatible' && comparison.medianLatencyDeltaMs !== null ? ['Median request latency changed by ' + comparison.medianLatencyDeltaMs + ' ms.'] : []),
    ],
    materialLimits: ['This is evidence for one bounded task pack; it is not a universal ranking, quality claim, or buying recommendation.'],
    details: latest.tasks.slice(0, 12).map(task => task.taskId + ' · ' + task.status + (task.requestLatencyMs === null ? '' : ' · ' + task.requestLatencyMs + ' ms')),
  }
}
export class DeterministicAdvisorRuntime implements AdvisorModelRuntime {
  readonly id = 'metrora-deterministic-local'
  readonly label = 'Metrora local evidence runtime'
  readonly mode = 'deterministic-local' as const
  readonly providerSupport = [] as const
  async generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> {
    throwIfAborted(signal)
    const answer = baseAnswer(input.evidence, this)
    const plan = input.plan ?? input.evidence.plan
    const finalize = (next: AdvisorAnswer): AdvisorAnswer => sanitizeAdvisorAnswer({
      ...next,
      plan,
      presentation: plan ? buildAdvisorPresentationBlocks(input.evidence, plan, input.question, next.synthesis ?? null) : next.presentation,
    })
    if (input.evidence.intent === 'social') return finalize(socialAnswer(input.evidence, answer))
    if (input.evidence.intent === 'action-proposal') return finalize(actionProposalAnswer(input.evidence, answer))
    if (input.evidence.intent === 'spend-change') return finalize(spendAnswer(input.evidence, answer))
    if (input.evidence.intent === 'model-efficiency') return finalize(modelAnswer(input.evidence, answer))
    if (input.evidence.intent === 'quota-capacity') return finalize(quotaAnswer(input.evidence, answer))
    if (input.evidence.intent === 'bench-result') return finalize(benchAnswer(input.evidence, answer))
    if (input.evidence.intent === 'clarification' || input.evidence.intent === 'unsupported') return finalize({
      ...answer,
      conclusion: input.evidence.understanding?.clarification ?? input.evidence.understanding?.boundary ?? 'Choose a supported Metrora evidence question.',
      materialLimits: ['No evidence was read until the question had a single supported meaning.'],
    })
    return finalize({
      ...answer,
      conclusion: 'I can investigate measured spend, observed model cost per call, provider quota, and controlled Bench results.',
      materialLimits: ['The deterministic Metrora evidence answer remains authoritative; any runtime context is supplementary and qualitative.'],
    })
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
