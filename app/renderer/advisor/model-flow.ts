import { advisorScopeFingerprint, type AdvisorAnswer, type AdvisorEvidence, type AdvisorModelRuntime, type AdvisorRuntimeInput, type AdvisorSynthesisBlockV1, type AdvisorTurnPlanV1 } from './types'
import { contentMinimalEvidence, contentMinimalScope, sanitizeAdvisorAnswer } from './privacy'
import { buildAdvisorPresentationBlocks } from './presentation'
import { parseAdvisorSynthesisDraft, verifyAdvisorSynthesis } from './synthesis'
import { hasMixedEvidenceScopes, mergeEvidence } from './merge-evidence'
import { DeterministicAdvisorRuntime } from './runtime'

type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string }

function bounded(value: string, max = 4_000): string {
  return value.trim().slice(0, max)
}

function safeConversation(input: AdvisorRuntimeInput): ModelMessage[] {
  const currentScopeFingerprint = advisorScopeFingerprint(input.evidence.scope)
  return (input.conversation ?? [])
    .filter(turn => turn.scopeFingerprint === currentScopeFingerprint)
    .slice(-12)
    .flatMap(turn => {
      const content = bounded(turn.content)
      return content ? [{ role: turn.role, content }] : []
    })
}

export function buildAdvisorPlanningMessages(input: AdvisorRuntimeInput, guardPlan: AdvisorTurnPlanV1): ModelMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the bounded planning phase of Metrora Advisor.',
        'Do not answer the user and do not state facts, numbers, causes, trends, or recommendations.',
        'Return only one JSON object with contractVersion "advisor-planning-draft-v1" and schemaVersion 1.',
        'The object must contain turnKind, questionFamily, requestedEvidenceDomains, toolRequests, presentationIntent, expertDetailRequested, and clarification.',
        'toolRequests may contain only fixed Metrora read-only tools and bounded filters. Never request an action, write, web, shell, file, or unknown tool.',
        'The deterministic guard owns proposal-required execution, scope authorization, and privacy. Do not widen its scope.',
        'The guarded scope is: ' + JSON.stringify(contentMinimalScope(input.evidence.scope)),
        'The guarded turn plan is: ' + JSON.stringify(guardPlan),
      ].join(' '),
    },
    ...safeConversation(input),
    { role: 'user', content: bounded(input.question) },
  ]
}

export function buildAdvisorSynthesisMessages(input: AdvisorRuntimeInput, plan: AdvisorTurnPlanV1, evidence: AdvisorEvidence): ModelMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the fresh synthesis phase of Metrora Advisor.',
        'Answer the original question using only the supplied verified Metrora evidence and the verified scope.',
        'Return only one JSON object with contractVersion "advisor-synthesis-draft-v1" and schemaVersion 1.',
        'conclusion, why, and details are bounded blocks shaped {text, claimIds}; every non-empty factual or qualitative block must reference one or more claim IDs.',
        'Every referenced claim must be verified by deterministic evidence paths. Do not leave material prose outside the claim graph.',
        'Claims must use exact evidence reference IDs and exact evidence paths. Never use ordinal aliases. Causal, forecast, and recommendation claims are unsupported.',
        'A qualitative claim is not evidence-free: it still needs a verified claim, exact reference, and exact path.',
        'Do not include chart values; presentationRequests may only select a presentation kind.',
        'Verified scope: ' + JSON.stringify(contentMinimalScope(evidence.scope)),
        'Validated plan: ' + JSON.stringify(plan),
      ].join(' '),
    },
    ...safeConversation(input),
    { role: 'user', content: bounded(input.question) },
    { role: 'system', content: 'Final merged canonical evidence. Treat this as authoritative and do not recompute it: ' + JSON.stringify(contentMinimalEvidence(evidence, { preserveEvidenceIds: true })) },
  ]
}

export function synthesisBlockText(block: AdvisorSynthesisBlockV1): string {
  return block.text
}

export type FinalizeModelAnswerOptions = {
  runtime: AdvisorModelRuntime
  input: AdvisorRuntimeInput
  evidenceItems: AdvisorEvidence[]
  finalContent: string
  modelUsed: boolean
  fallbackNote?: string
}

export async function finalizeModelAnswer(options: FinalizeModelAnswerOptions, signal?: AbortSignal): Promise<AdvisorAnswer> {
  const { runtime, input, finalContent, modelUsed, fallbackNote } = options
  const evidenceItems = options.evidenceItems.length ? options.evidenceItems : [input.evidence]
  const evidence = mergeEvidence(evidenceItems, input.evidence)
  const homogeneous = !hasMixedEvidenceScopes(evidenceItems)
  const deterministicItems = homogeneous ? evidenceItems : [evidence]
  const deterministicRuntime = new DeterministicAdvisorRuntime()
  const deterministicAnswers = await Promise.all(deterministicItems.map(item => deterministicRuntime.generate({ question: input.question, evidence: item, plan: input.plan }, signal)))
  const fallback = await deterministicRuntime.generate({ question: input.question, evidence, plan: input.plan }, signal)
  const verifiedConclusions = Array.from(new Set(deterministicAnswers.map(answer => answer.conclusion).filter(Boolean)))
  const verifiedConclusion = verifiedConclusions.length ? verifiedConclusions.join(' ') : fallback.conclusion
  const details = Array.from(new Set([
    ...deterministicAnswers.flatMap(answer => answer.details),
    ...fallback.details,
    ...(homogeneous ? options.evidenceItems.flatMap(item => item.refs.map(ref => 'Evidence · ' + ref.label)) : []),
  ]))
  const draft = parseAdvisorSynthesisDraft(finalContent)
  const verification = draft ? verifyAdvisorSynthesis(draft, evidence) : null
  const plan = input.plan ?? input.evidence.plan
  if (draft && verification?.valid && plan) {
    return sanitizeAdvisorAnswer({
      ...fallback,
      conclusion: synthesisBlockText(draft.conclusion),
      why: draft.why.map(synthesisBlockText),
      details: draft.details.map(synthesisBlockText),
      claims: verification.claims.filter(claim => claim.status === 'verified'),
      synthesis: { ...draft, claims: verification.claims },
      presentation: buildAdvisorPresentationBlocks(evidence, plan, input.question, draft),
      runtime: { id: runtime.id, label: runtime.label, mode: runtime.mode },
      generatedByModel: modelUsed,
      streamed: false,
    })
  }
  const notes = [
    ...(fallback.materialLimits ?? []),
    ...(fallbackNote ? [fallbackNote] : []),
    ...(draft ? ['The model explanation did not pass Metrora claim verification; verified facts are shown instead.'] : []),
  ]
  return sanitizeAdvisorAnswer({
    ...fallback,
    conclusion: verifiedConclusion,
    details,
    materialLimits: notes,
    presentation: plan ? buildAdvisorPresentationBlocks(evidence, plan, input.question) : undefined,
    runtime: { id: runtime.id, label: runtime.label, mode: runtime.mode },
    generatedByModel: modelUsed,
    streamed: false,
  })
}

export function evidenceUsable(items: AdvisorEvidence[]): boolean {
  return !hasMixedEvidenceScopes(items) && items.some(item => item.intent !== 'unknown' && item.coverage.level !== 'unavailable' && item.refs.length > 0)
}
