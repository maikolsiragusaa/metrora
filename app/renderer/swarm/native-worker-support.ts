import type {
  AdvisorAnswer,
  AdvisorRuntimeInput,
  AdvisorToolEvent,
} from '../advisor/types'
import {
  boundedSwarmText,
  sanitizeSwarmIdentity,
  sanitizeSwarmText,
} from '../../../src/swarm/evidence-v1'
import type {
  SwarmToolActivityV1,
  SwarmWorkerRequestV1,
} from '../../../src/swarm/contract-v1'

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Swarm worker cancelled', 'AbortError')
}

export function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && /abort|cancel/i.test(error.message))
}

export function safeToolName(value: string): string {
  return sanitizeSwarmText(value, 96)
}

export function safeRefs(refs: readonly { id: string; label: string }[]): Array<{ id: string; label: string }> {
  return refs.slice(0, 16).map(ref => ({
    id: sanitizeSwarmText(ref.id, 120),
    label: sanitizeSwarmText(ref.label, 240),
  }))
}

export function toolActivityFromEvents(events: readonly AdvisorToolEvent[]): SwarmToolActivityV1[] {
  const latest = new Map<string, SwarmToolActivityV1>()
  for (const event of events) {
    const status = event.status === 'queued' || event.status === 'started'
      ? 'started'
      : event.status === 'completed'
        ? 'completed'
        : event.status === 'unavailable'
          ? 'unavailable'
          : event.status === 'cancelled'
            ? 'cancelled'
            : 'failed'
    latest.set(safeToolName(event.name), { name: safeToolName(event.name), status })
  }
  return [...latest.values()].slice(0, 16)
}

export function safeAnswer(answer: AdvisorAnswer, maxBytes = 8 * 1024): { answer: string; evidenceSummary: string; refs: Array<{ id: string; label: string }> } {
  const refs = safeRefs(answer.evidence)
  const evidenceSummary = boundedSwarmText([
    answer.coverage.label,
    answer.coverage.detail,
    refs.map(ref => ref.label).join('; '),
  ].filter(Boolean).join(' - '))
  return {
    answer: boundedSwarmText(sanitizeSwarmText(answer.conclusion), maxBytes),
    evidenceSummary,
    refs,
  }
}

function workerCloseoutPrefix(role: SwarmWorkerRequestV1['role']): string {
  if (role === 'investigator') return 'Investigator finding: '
  if (role === 'verifier') return 'Verifier check: '
  return 'Evidence review: '
}

export function prefixWorkerAnswer(role: SwarmWorkerRequestV1['role'], answer: string): string {
  const prefix = workerCloseoutPrefix(role)
  return answer.startsWith(prefix) ? answer : prefix + answer
}

export function workerContext(request: SwarmWorkerRequestV1): NonNullable<AdvisorRuntimeInput['workerContext']> {
  if (request.role === 'investigator') {
    return {
      role: request.role,
      profile: request.profile,
      responsibility: 'Identify the canonical evidence required for the original task, perform the required allowed Metrora reads, and report observed facts, limits, and evidence references. Request only additional bounded reads when necessary.',
      instruction: 'Treat canonical Metrora Tool output as factual authority. Do not fill gaps with general model knowledge or a social reply.',
    }
  }
  if (request.role === 'verifier') {
    return {
      role: request.role,
      profile: request.profile,
      responsibility: 'Independently validate the core factual claim with your own canonical Metrora reads. Do not treat Investigator prose as factual authority; report agreement, disagreement, or insufficient evidence and preserve evidence references.',
      instruction: 'Repeat the bounded canonical verification read even when another worker has already reported a result. Do not claim verification without your own usable evidence.',
    }
  }
  return {
    role: request.role,
    profile: request.profile,
    responsibility: 'Review the bounded canonical evidence relevant to the original task, identify provenance and gaps, and report only evidence-backed conclusions.',
    instruction: 'Keep the review read-only, bounded, and explicit about unavailable or partial evidence.',
  }
}
