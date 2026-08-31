import type { AdvisorBenchEvidence, AdvisorCoverage, AdvisorEvidence, AdvisorEvidenceRef, AdvisorScope } from './types'
import { createAdvisorActionProposalV1 } from './action'

export function buildSocialEvidence(question: string, scope: AdvisorScope): AdvisorEvidence {
  return {
    intent: 'social',
    question,
    scope,
    refs: [],
    coverage: { level: 'high', state: 'UNSUPPORTED', label: 'Conversation', detail: 'No Metrora evidence was needed for this conversational turn.' },
    assumptions: [],
    unknown: [],
    nextInvestigations: ['Ask about spend, models, Projects, sessions, quota, or a controlled Bench result.'],
  }
}

/** Empty, neutral evidence for a capable model’s ordinary chat response. */
export function buildConversationEvidence(question: string, scope: AdvisorScope): AdvisorEvidence {
  return {
    intent: 'social',
    question,
    scope,
    refs: [],
    coverage: { level: 'high', state: 'UNSUPPORTED', label: 'Conversation', detail: 'No Metrora evidence was used for this turn.' },
    assumptions: [],
    unknown: [],
    nextInvestigations: [],
  }
}

export function buildActionProposalEvidence(question: string, scope: AdvisorScope, boundary: string): AdvisorEvidence {
  const value = question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const kind = /\b(?:core[ -]?compatibility|compatibility[ -]?runtime|runtime health)\b/u.test(value) ? 'run-core-compatibility' as const
    : /\b(?:bench|benchmark|task[ -]?pack)\b/u.test(value) ? 'run-bench' as const
      : /\b(?:agent|agents|agenti|orchestrat)/u.test(value) ? 'launch-agents' as const
        : /\b(?:routing|route|routing policy)\b/u.test(value) ? 'change-routing' as const
          : 'apply-policy' as const
  return {
    intent: 'action-proposal',
    question,
    scope,
    refs: [],
    coverage: { level: 'unavailable', state: 'UNSUPPORTED', label: 'Approval required', detail: boundary },
    assumptions: ['Harness read/investigate access is separate from action/execute authority.'],
    unknown: ['No action was prepared or executed from this conversation.'],
    nextInvestigations: ['Ask Harness to inspect an existing result, or use the dedicated authorized product surface for execution.'],
    actionProposal: createAdvisorActionProposalV1({
      kind,
      summary: boundary,
      target: kind === 'run-core-compatibility'
        ? 'canonical Core Compatibility task pack'
        : kind === 'run-bench'
          ? 'selected Bench task pack'
          : kind === 'launch-agents'
            ? 'requested agent set'
            : 'selected Metrora policy surface',
      scope,
    }),
  }
}

function coverageForBench(state: AdvisorBenchEvidence['state']): AdvisorCoverage {
  if (state === 'NO_DATA') return { level: 'unavailable', state, label: 'No controlled result yet', detail: 'Metrora has no completed controlled Bench result for this request.' }
  if (state === 'UNAVAILABLE') return { level: 'unavailable', state, label: 'Controlled result unavailable', detail: 'Bench history did not provide a usable controlled result.' }
  if (state === 'NOT_COMPARABLE') return { level: 'partial', state, label: 'Runs are not comparable', detail: 'The selected runs differ in pack, runner, scoring, or generation policy.' }
  if (state === 'PARTIAL') return { level: 'partial', state, label: 'Bounded controlled result', detail: 'A controlled result exists, but its task-pack evidence and comparable history remain limited.' }
  if (state === 'AVAILABLE') return { level: 'high', state, label: 'Controlled result available', detail: 'The declared controlled task pack completed; it remains bounded evidence, not a universal model-quality claim.' }
  return { level: 'unavailable', state, label: 'Controlled result unavailable', detail: 'Bench evidence is not in a usable state for this request.' }
}

function coverageForPerformance(state: AdvisorBenchEvidence['state']): AdvisorCoverage {
  if (state === 'NO_DATA') return { level: 'unavailable', state, label: 'No native Performance result yet', detail: 'Metrora has no completed native Performance result for this request.' }
  if (state === 'UNAVAILABLE') return { level: 'unavailable', state, label: 'Native Performance unavailable', detail: 'Native Performance history did not provide a usable result; no throughput or latency is inferred.' }
  if (state === 'NOT_COMPARABLE') return { level: 'partial', state, label: 'Performance runs are not comparable', detail: 'The selected native Performance runs differ in methodology, setup, runtime/hardware identity or usable metrics.' }
  if (state === 'PARTIAL') return { level: 'partial', state, label: 'Bounded native Performance result', detail: 'A native Performance result exists, but its workload or comparable-history evidence remains limited.' }
  if (state === 'AVAILABLE') return { level: 'high', state, label: 'Native Performance available', detail: 'The declared native Performance method completed; its throughput and timing remain conditional on the retained model/runtime/hardware configuration.' }
  return { level: 'unavailable', state, label: 'Native Performance unavailable', detail: 'Performance evidence is not in a usable state for this request.' }
}

export function buildClarificationEvidence(question: string, scope: AdvisorScope, prompt: string): AdvisorEvidence {
  return {
    intent: 'clarification',
    question,
    scope,
    refs: [],
    coverage: { level: 'unavailable', state: 'UNSUPPORTED', label: 'One choice needed', detail: 'The wording can refer to two materially different Metrora evidence sources.' },
    assumptions: [prompt],
    unknown: ['No evidence was read until the user chooses the intended meaning.'],
    nextInvestigations: ['Choose provider-reported quota or Metrora-measured usage.'],
  }
}

export function buildUnsupportedEvidence(question: string, scope: AdvisorScope, boundary: string): AdvisorEvidence {
  return {
    intent: 'unsupported',
    question,
    scope,
    refs: [],
    coverage: { level: 'unavailable', state: 'UNSUPPORTED', label: 'Outside Metrora evidence', detail: boundary },
    assumptions: [],
    unknown: ['Metrora does not have canonical evidence for a universal ranking, recommendation, forecast, or general question.'],
    nextInvestigations: ['Ask about measured spend, provider-reported quota, observed cost per call, or a controlled Bench result.'],
  }
}

export function buildBenchEvidence(question: string, scope: AdvisorScope, bench: AdvisorBenchEvidence): AdvisorEvidence {
  const refs: AdvisorEvidenceRef[] = []
  if (bench.latest) refs.push({ id: 'bench.latest', label: 'Latest controlled Bench result', source: 'bench' })
  if (bench.runs.length) refs.push({ id: 'bench.history', label: 'Bounded Bench history', source: 'bench' })
  if (bench.comparison) refs.push({ id: 'bench.comparison', label: 'Canonical Bench comparison', source: 'bench' })
  const performance = bench.performance
  if (performance?.latest) refs.push({ id: 'bench.performance.latest', label: 'Latest native Performance result', source: 'bench' })
  if (performance?.runs.length) refs.push({ id: 'bench.performance.history', label: 'Bounded native Performance history', source: 'bench' })
  if (performance?.comparison) refs.push({ id: 'bench.performance.comparison', label: 'Evidence-aware Performance comparison', source: 'bench' })
  const performanceRequested = /\b(?:performance|throughput|latency|llama|prefill|decode|tokens\/?s)\b/u.test(question.toLowerCase())
  const usePerformance = Boolean(performance && (performanceRequested || !bench.latest))
  const effectiveState = usePerformance ? performance!.state : bench.state
  const unknown = effectiveState === 'NO_DATA'
    ? [usePerformance ? 'No completed native Performance result is available for this scope.' : 'No completed controlled result is available for this scope.']
    : effectiveState === 'UNAVAILABLE'
      ? [usePerformance ? 'Native Performance history is unavailable; no throughput or latency is inferred.' : 'Bench history is unavailable; no score or task result is inferred.']
      : effectiveState === 'NOT_COMPARABLE'
        ? [usePerformance ? 'The selected native Performance runs cannot be compared because their methodology, setup or hardware identities differ.' : 'The selected runs cannot be compared because their canonical identities differ.']
        : effectiveState === 'PARTIAL'
          ? [usePerformance ? 'The native Performance result is bounded; some workload or comparable-history coverage may be incomplete.' : 'The controlled result is bounded; task or comparable-history coverage may be incomplete.']
          : [usePerformance ? 'Native Performance does not establish model quality; its figures are conditional on the retained setup and environment.' : 'Core conformance does not establish universal model quality; Performance figures are conditional on their retained setup and environment.']
  const assumptions = usePerformance
    ? [
        'Native Performance throughput and timing are canonical controlled evidence, not Metrora-measured usage.',
        'Only metrics reported by the retained llama-bench evidence are described; absent fields remain unknown.',
        'This read-only path never starts a benchmark.',
      ]
    : [
        'Bench scores and task outcomes are canonical controlled evidence, not Metrora-measured usage.',
        'Latency and time-to-first-content are reported only where the controlled run recorded them.',
        'Native Performance throughput and timing are read from retained llama-bench evidence; this read-only path never starts a benchmark.',
      ]
  return {
    intent: 'bench-result',
    question,
    scope,
    refs,
    coverage: usePerformance ? coverageForPerformance(effectiveState) : coverageForBench(effectiveState),
    assumptions,
    unknown,
    nextInvestigations: ['Open the Bench surface for the full bounded task status and canonical comparison details.'],
    bench,
  }
}
