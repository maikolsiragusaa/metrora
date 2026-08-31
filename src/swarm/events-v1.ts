import type {
  SwarmEventV1,
  SwarmWorkerEventStatusV1,
  SwarmWorkerResultStatusV1,
} from './contract-v1'

export const SWARM_EVENT_STATUSES = [
  'proposed',
  'preparing',
  'started',
  'completed',
  'failed',
  'cancelled',
  'queued',
  'tool-started',
  'tool-completed',
  'unavailable',
  'synthesis-started',
  'synthesis-completed',
] as const

export function isTerminalWorkerResult(status: SwarmWorkerResultStatusV1): boolean {
  return status === 'completed'
    || status === 'partial'
    || status === 'unavailable'
    || status === 'failed'
    || status === 'timeout'
    || status === 'cancelled'
}

export function workerEventStatusForResult(status: SwarmWorkerResultStatusV1): Extract<SwarmWorkerEventStatusV1, 'completed' | 'unavailable' | 'failed' | 'cancelled'> {
  if (status === 'completed' || status === 'partial') return 'completed'
  if (status === 'unavailable') return 'unavailable'
  if (status === 'cancelled') return 'cancelled'
  return 'failed'
}

function scrub(value: string, maxBytes = 240): string {
  const safe = value
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|workspace|Volumes)\/)[^\s"']+/giu, '[path]')
    .replace(/(?:api[_-]?key|token|password|secret|credential)\s*[:=]\s*\S+/giu, '[redacted]')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/giu, '[redacted]')
  const bytes = new TextEncoder().encode(safe)
  return bytes.byteLength <= maxBytes ? safe : new TextDecoder().decode(bytes.slice(0, maxBytes)) + '...'
}

export function safeSwarmEvent(event: SwarmEventV1): SwarmEventV1 {
  return {
    ...event,
    ...(event.detail ? { detail: scrub(event.detail) } : {}),
    ...('toolName' in event && event.toolName ? { toolName: scrub(event.toolName, 96) } : {}),
  } as SwarmEventV1
}
