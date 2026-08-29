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
  const kind = /\b(?:bench|benchmark|task[ -]?pack)\b/u.test(value) ? 'run-bench' as const
    : /\b(?:agent|agents|agenti|orchestrat)/u.test(value) ? 'launch-agents' as const
      : /\b(?:routing|route|routing policy)\b/u.test(value) ? 'change-routing' as const
        : 'apply-policy' as const
  return {
    intent: 'action-proposal',
    question,
    scope,
    refs: [],
    coverage: { level: 'unavailable', state: 'UNSUPPORTED', label: 'Approval required', detail: boundary },
    assumptions: ['Advisor read/investigate access is separate from action/execute authority.'],
    unknown: ['No action was prepared or executed from this conversation.'],
    nextInvestigations: ['Ask Advisor to inspect an existing result, or use the dedicated authorized product surface for execution.'],
    actionProposal: createAdvisorActionProposalV1({ kind, summary: boundary, target: kind === 'run-bench' ? 'selected Bench task pack' : kind === 'launch-agents' ? 'requested agent set' : 'selected Metrora policy surface', scope }),
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
  const unknown = bench.state === 'NO_DATA'
    ? ['No completed controlled result is available for this scope.']
    : bench.state === 'UNAVAILABLE'
      ? ['Bench history is unavailable; no score or task result is inferred.']
      : bench.state === 'NOT_COMPARABLE'
        ? ['The selected runs cannot be compared because their canonical identities differ.']
        : bench.state === 'PARTIAL'
          ? ['The controlled result is bounded; task or comparable-history coverage may be incomplete.']
          : ['A controlled task pack does not establish universal model quality or a recommendation.']
  return {
    intent: 'bench-result',
    question,
    scope,
    refs,
    coverage: coverageForBench(bench.state),
    assumptions: [
      'Bench scores and task outcomes are canonical controlled evidence, not Metrora-measured usage.',
      'Latency and time-to-first-content are reported only where the controlled run recorded them.',
    ],
    unknown,
    nextInvestigations: ['Open the Bench surface for the full bounded task status and canonical comparison details.'],
    bench,
  }
}
