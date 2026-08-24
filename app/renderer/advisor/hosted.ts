import { metrora } from '../lib/ipc'
import { DeterministicAdvisorRuntime } from './runtime'
import { contentMinimalEvidence, boundedAdvisorText, sanitizeAdvisorAnswer, sanitizeAdvisorNarrative } from './privacy'
import type { AdvisorAnswer, AdvisorHostedModel, AdvisorHostedProviderId, AdvisorModelRuntime, AdvisorRuntimeInput } from './types'

export type HostedAdvisorProvider = AdvisorHostedProviderId
export type HostedAdvisorProbeResult = {
  provider: HostedAdvisorProvider
  available: boolean
  models: AdvisorHostedModel[]
  detail: string
  credentialState: 'not-configured' | 'ready' | 'locked-unavailable' | 'invalid' | 'needs-reentry'
}
export type HostedAdvisorTransport = {
  probe(provider: HostedAdvisorProvider, signal?: AbortSignal): Promise<HostedAdvisorProbeResult>
  chat(requestId: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<{ message: { content: string; tool_calls?: Array<Record<string, unknown>> }; streamed: boolean }>
  cancel(requestId: string): Promise<boolean>
  onEvent(callback: (event: { requestId: string; kind: string; text?: string }) => void): () => void
}
const bridgeTransport: HostedAdvisorTransport = {
  probe: async (provider, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    const id = requestId()
    const cancel = () => { void metrora.advisorHostedCancel(id).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      return await metrora.advisorHostedProbe(provider, id)
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  },
  chat: (requestId, payload, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    return metrora.advisorHostedChat(requestId, payload)
  },
  cancel: requestId => metrora.advisorHostedCancel(requestId),
  onEvent: callback => metrora.onAdvisorHostedEvent(callback),
}
export async function probeHostedAdvisor(provider: HostedAdvisorProvider, signal?: AbortSignal, transport: HostedAdvisorTransport = bridgeTransport): Promise<HostedAdvisorProbeResult> {
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  const result = await transport.probe(provider, signal)
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  return result
}
function requestId(): string { return 'hosted-advisor-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) }
function messagePayload(input: AdvisorRuntimeInput, consent: boolean): Record<string, unknown> {
  const verified = JSON.stringify(contentMinimalEvidence(input.evidence))
  return {
    provider: input.evidence.scope.provider,
    model: '',
    messages: [
      { role: 'system', content: 'You are Metrora Advisor. Use the supplied Metrora evidence as read-only facts. Do not invent numbers, dates, causes, rankings, recommendations, secrets, paths, prompts, or hidden reasoning. Answer in plain language and keep factual claims tied to the evidence.' },
      { role: 'user', content: input.question.trim().slice(0, 4000) },
      { role: 'system', content: 'Verified Metrora facts for this question. Treat them as authoritative and do not recompute them: ' + verified },
    ],
    tools: [],
    stream: true,
    consent,
  }
}
export class HostedAdvisorRuntime implements AdvisorModelRuntime {
  readonly id: string
  readonly label: string
  readonly mode = 'hosted-byok' as const
  readonly providerSupport: readonly string[]
  readonly supportsStreaming = true
  readonly availability = 'ready' as const
  private readonly provider: HostedAdvisorProvider
  private readonly model: string
  private readonly consent: boolean
  private readonly transport: HostedAdvisorTransport
  constructor(options: { provider: HostedAdvisorProvider; model: string; consent?: boolean; transport?: HostedAdvisorTransport }) {
    this.provider = options.provider
    this.model = options.model
    this.transport = options.transport ?? bridgeTransport
    this.consent = options.consent === true
    this.id = 'hosted-' + options.provider
    this.label = options.provider.charAt(0).toUpperCase() + options.provider.slice(1) + ' · ' + options.model.replace(/^models\//u, '')
    this.providerSupport = [options.provider + ' official API']
  }
  async generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> {
    if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
    if (!this.consent) throw new Error('Hosted evidence sharing consent is required.')
    const id = requestId()
    let preview = ''
    const off = this.transport.onEvent(event => {
      if (event.requestId !== id || event.kind !== 'text-delta' || typeof event.text !== 'string') return
      preview += event.text
      if (preview.length > 8192) preview = preview.slice(0, 8192)
      input.onDelta?.(sanitizeAdvisorNarrative(preview))
    })
    const cancel = () => { void this.transport.cancel(id).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      const payload = messagePayload(input, this.consent)
      payload.provider = this.provider
      payload.model = this.model
      const response = await this.transport.chat(id, payload, signal)
      if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
      const deterministic = await new DeterministicAdvisorRuntime().generate({ question: input.question, evidence: input.evidence }, signal)
      const narrative = sanitizeAdvisorNarrative(response.message.content)
      const conclusion = narrative ? deterministic.conclusion + ' Provider context: ' + narrative : deterministic.conclusion
      return sanitizeAdvisorAnswer({
        ...deterministic,
        conclusion: boundedAdvisorText(conclusion),
        runtime: { id: this.id, label: this.label, mode: this.mode },
        generatedByModel: true,
        streamed: Boolean(narrative && response.streamed),
      })
    } finally {
      signal?.removeEventListener('abort', cancel)
      off()
    }
  }
}
