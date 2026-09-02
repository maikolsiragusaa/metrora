import type { MetroraAgentLoopEvent, MetroraAgentLoopEventType } from './contracts'

export function emitMetroraAgentEvent(
  emit: ((event: MetroraAgentLoopEvent) => void) | undefined,
  type: MetroraAgentLoopEventType,
  turnId: string,
  now: () => string,
  fields: Omit<MetroraAgentLoopEvent, 'type' | 'turnId' | 'at'> = {},
): void {
  emit?.({ type, turnId, at: now(), ...fields })
}

export function safeAgentEventText(value: unknown, max = 160): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim()
  return normalized ? normalized.slice(0, max) : undefined
}
