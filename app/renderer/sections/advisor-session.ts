import type { SwarmRunResultV1 } from '../../../src/swarm/contract-v1'
import { periodLabel, scopeLabel } from '../advisor/evidence'
import type { AdvisorAnswer, AdvisorConversationTurn, AdvisorScope } from '../advisor/types'
import type { AdvisorContextualScopeMode } from '../advisor/context'
import { sanitizeAdvisorDisplayText, sanitizeAdvisorModelOutput } from '../advisor/privacy'

export type DetectedProvider = { id: string; label: string }
export type AdvisorMessage = { id: string; role: 'user' | 'assistant'; text?: string; answer?: AdvisorAnswer; scopeFingerprint: string }
export type AdvisorConversation = { id: string; title: string; messages: AdvisorMessage[] }
export type AdvisorFailedRequest = { question: string; scope: AdvisorScope; conversationId: string; conversation: AdvisorConversationTurn[] }
export type AdvisorModelRuntimeLike = { id: string; label: string; mode: AdvisorAnswer['runtime']['mode'] }

export function makeId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}

export function advisorRequestErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AdvisorTimeoutError') return 'Harness turn reached its bounded timeout.'
    if (error.name === 'AdvisorRuntimeUnavailableError') return 'No verified Harness model runtime is configured.'
    if (error.name === 'AdvisorToolContractError') return 'The request could not be completed within the bounded Metrora Tools contract.'
  }
  return 'Harness could not complete this request. No action was executed.'
}

export function providerLabel(provider: string): string {
  if (provider === 'all') return 'All providers'
  return provider.split(/[-\s]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export function contextualScopeLabel(scope: AdvisorScope, mode: AdvisorContextualScopeMode | null): string {
  if (mode === 'capacity') return 'Provider-reported current capacity · All providers'
  if (mode === 'compare') return `Compare page scope · ${periodLabel(scope)} · ${providerLabel(scope.provider)}`
  return scopeLabel(scope)
}

export function answerForMessage(messages: AdvisorMessage[], id: string | null): AdvisorAnswer | null {
  if (id) {
    const selected = messages.find(message => message.id === id)
    if (selected?.answer) return selected.answer
  }
  return [...messages].reverse().find(message => message.answer)?.answer ?? null
}

export function answerFromSwarmResult(result: SwarmRunResultV1, scope: AdvisorScope, runtime: AdvisorModelRuntimeLike): AdvisorAnswer {
  const workerRefs = result.workers.flatMap(worker => worker.evidenceRefs.slice(0, 4).map(ref => ({ id: ref.id, label: ref.label, source: 'overview' as const })))
  const evidence = workerRefs.filter((ref, index, refs) => refs.findIndex(candidate => candidate.id === ref.id) === index).slice(0, 16)
  const coverage = result.status === 'completed'
    ? { level: 'high' as const, label: 'High coverage', detail: 'All bounded Swarm workers completed.' }
    : result.status === 'partial'
      ? { level: 'partial' as const, label: 'Partial coverage', detail: 'Some bounded Swarm workers did not complete.' }
      : { level: 'unavailable' as const, label: 'Swarm unavailable', detail: result.status === 'cancelled' ? 'The Swarm run was cancelled.' : 'No complete Swarm synthesis was available.' }
  const workerDetails = result.workers.map(worker => sanitizeAdvisorDisplayText(worker.role, 64) + ': ' + sanitizeAdvisorDisplayText(worker.status, 32)).slice(0, 6)
  const errors = result.workers.flatMap(worker => worker.errors).concat(result.synthesis?.errors ?? []).slice(0, 8).map(error => sanitizeAdvisorDisplayText(error, 240))
  const synthesisAnswer = result.synthesis?.answer ? sanitizeAdvisorModelOutput(result.synthesis.answer, 8 * 1024) : ''
  const synthesisSummary = result.synthesis?.evidenceSummary ? sanitizeAdvisorDisplayText(result.synthesis.evidenceSummary, 1 * 1024) : ''
  return {
    conclusion: synthesisAnswer || (result.status === 'cancelled' ? 'Swarm was cancelled; completed worker results remain inspectable.' : 'No final Swarm synthesis was available; worker status and evidence remain inspectable.'),
    scopeLabel: scopeLabel(scope),
    periodLabel: periodLabel(scope),
    evidence,
    coverage,
    assumptions: ['Manual Swarm uses fixed transparent roles and bounded read-only Tools.'],
    unknown: errors.length ? errors : result.status === 'completed' ? [] : ['The final Swarm synthesis is unavailable.'],
    nextInvestigations: [],
    details: workerDetails,
    why: synthesisSummary ? [synthesisSummary] : [],
    runtime: { id: runtime.id, label: runtime.label, mode: runtime.mode },
    generatedByModel: result.synthesis?.status === 'completed' && Boolean(result.synthesis.answer),
    streamed: false,
  }
}
