import { periodLabel, scopeLabel } from './evidence'
import type { AdvisorAnswer, AdvisorEvidence, AdvisorModelRuntime, AdvisorRuntimeInput } from './types'
import { sanitizeAdvisorAnswer } from './privacy'
import { buildAdvisorPresentationBlocks } from './presentation'
import { advisorCopyLanguage } from './turn-plan'
import { renderDeterministicEvidenceAnswer } from './claim-atoms'

export class AdvisorRuntimeUnavailableError extends Error {
  constructor() {
    super('No verified Advisor model runtime is configured')
    this.name = 'AdvisorRuntimeUnavailableError'
  }
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Advisor investigation cancelled', 'AbortError')
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
  const italian = advisorCopyLanguage(value) === 'it'
  if (/^(?:grazie|grazie mille|thanks|thank you|thankyou|much appreciated)[!.?,\s]*$/u.test(value)) {
    return { ...answer, conclusion: italian ? 'Di nulla. Quando vuoi, possiamo guardare un altro periodo o confronto.' : 'You’re welcome. Whenever you like, we can look at another period or comparison.' }
  }
  if (/^(?:come stai|how are you)[!?.,\s]*$/u.test(value)) {
    return { ...answer, conclusion: italian ? 'Bene, grazie. Sono qui per aiutarti a leggere i dati di Metrora.' : 'I’m well, thanks. I’m here to help you read your Metrora data.' }
  }
  return { ...answer, conclusion: italian ? 'Buongiorno. Posso aiutarti a capire spesa, modelli, Projects, sessioni, quota e risultati Bench.' : 'Hello. I can help you understand spend, models, Projects, sessions, quota, and Bench results.' }
}

function actionProposalAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer): AdvisorAnswer {
  return {
    ...answer,
    conclusion: evidence.understanding?.boundary ?? 'This request needs a separately authorized action proposal; no action was executed.',
    materialLimits: ['Advisor can read and explain existing Metrora evidence here. It does not execute Bench runs, launch agents, change routing, or apply policy from conversation text.'],
    details: ['Action state · proposal only', 'Execution · not requested from an authorized action surface'],
  }
}
function factualAnswer(evidence: AdvisorEvidence, answer: AdvisorAnswer, question: string): AdvisorAnswer {
  const rendered = renderDeterministicEvidenceAnswer(answer, evidence, question)
  if (!rendered.claims?.length) {
    return {
      ...rendered,
      materialLimits: [...(rendered.materialLimits ?? []), 'No typed factual atom was available for the selected evidence scope.'],
    }
  }
  return rendered
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
      presentation: plan ? buildAdvisorPresentationBlocks(input.evidence, plan, input.question, next.synthesis ?? null, next.claims ?? []) : next.presentation,
    })
    if (input.evidence.intent === 'social') return finalize(socialAnswer(input.evidence, answer))
    if (input.evidence.intent === 'action-proposal') return finalize(actionProposalAnswer(input.evidence, answer))
    if (input.evidence.intent === 'spend-change' || input.evidence.intent === 'model-efficiency' || input.evidence.intent === 'quota-capacity' || input.evidence.intent === 'bench-result') return finalize(factualAnswer(input.evidence, answer, input.question))
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
