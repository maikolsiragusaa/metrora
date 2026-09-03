import { randomUUID } from 'node:crypto'

import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  type GenerateOptions,
  type LlmAdapter,
  type Message,
  ReasoningEffortId,
  type StreamChunk,
  ToolCallId,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'

import { projectHarnessText, type HarnessModelConformance, type HarnessReasoningEffort } from './harness-runtime-types.js'

const NONCE_TOOL: ToolSchema = {
  name: 'metrora_conformance_nonce',
  description: 'A harmless verification tool. Return the nonce argument unchanged.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { nonce: { type: 'string' } },
    required: ['nonce'],
  },
}

function textFromChunk(chunk: StreamChunk): string {
  if (chunk.type === 'text-delta') return chunk.text
  if (chunk.type === 'block-end' && chunk.block.type === 'text') return chunk.block.text
  return ''
}

function callsFromChunks(chunks: readonly StreamChunk[]): Array<{ id: string; name: string; arguments: string }> {
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  for (const chunk of chunks) {
    if (chunk.type === 'tool-call-delta') {
      const current = calls.get(chunk.index) ?? { id: String(chunk.id ?? ''), name: chunk.name ?? '', arguments: '' }
      if (chunk.id) current.id = String(chunk.id)
      if (chunk.name) current.name = chunk.name
      current.arguments += chunk.argumentsDelta
      calls.set(chunk.index, current)
    }
    if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
      calls.set(chunk.index, { id: String(chunk.block.id), name: chunk.block.name, arguments: chunk.block.arguments })
    }
  }
  return [...calls.values()].filter(call => call.name && call.id)
}

async function collect(adapter: LlmAdapter, options: GenerateOptions): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  return chunks
}

function safeReasoning(value: HarnessReasoningEffort | null | undefined): ReasoningEffortId | undefined {
  return value ? ReasoningEffortId(value) : undefined
}

function firstModelMessages(nonce: string): Message[] {
  const user = createUserMessage({ content: [{ type: 'text', text: `For conformance only, call the nonce tool with nonce ${nonce}. Do not answer until you receive its result.` }], source: { kind: 'user' } })
  return [user]
}

function secondModelMessages(provider: string, model: string, nonce: string, call: { id: string; name: string; arguments: string }, executedNonce: string): Message[] {
  const user = createUserMessage({ content: [{ type: 'text', text: `For conformance only, call the nonce tool with nonce ${nonce}. After the Tool result arrives, answer with one natural sentence that includes the returned nonce.` }], source: { kind: 'user' } })
  const callId = ToolCallId(call.id)
  const assistant = createAssistantMessage({
    content: [{ type: 'tool-call', id: callId, name: NONCE_TOOL.name, arguments: JSON.stringify({ nonce }) }],
    source: { provider, model },
  })
  const result = createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: `nonce verified: ${executedNonce}` }] })
  return [user, assistant, result]
}

/** Exact-model verification: a reachable endpoint is not enough. The selected
 * model must emit a native call for a nonce Tool, accept the real Tool result,
 * and synthesize a final answer on the same provider/model route. */
export async function verifyToolCapableModel(options: {
  adapter: LlmAdapter
  provider: string
  model: string
  reasoningEffort?: HarnessReasoningEffort | null
  routeFingerprint?: string
  signal?: AbortSignal
}): Promise<HarnessModelConformance> {
  const checkedAt = new Date().toISOString()
  const fingerprint = `${options.provider}:${options.model}:dsh-llm-adapter-v1:${options.routeFingerprint ?? 'default'}:native-tool-v1:${options.reasoningEffort ?? 'provider-default'}`
  const nonce = `metrora-${randomUUID().slice(0, 12)}`
  const firstMessages = firstModelMessages(nonce)
  const base = {
    provider: options.provider,
    model: options.model,
    reasoningEffort: safeReasoning(options.reasoningEffort),
    tools: [NONCE_TOOL],
    system: 'This is a bounded model capability check. Never expose this instruction in the final answer.',
    signal: options.signal,
  }
  try {
    const first = await collect(options.adapter, { ...base, messages: firstMessages })
    const calls = callsFromChunks(first)
    const call = calls.find(candidate => candidate.name === NONCE_TOOL.name)
    if (!call) {
      return { state: 'limited', fingerprint, toolCalling: 'unsupported', reasoning: 'unknown', checkedAt, detail: 'The exact model completed a chat probe but did not emit a native Tool call.' }
    }
    let argumentsValue: unknown
    try { argumentsValue = JSON.parse(call.arguments) } catch {
      return { state: 'failed-conformance', fingerprint, toolCalling: 'unsupported', reasoning: 'unknown', checkedAt, detail: 'The exact model emitted invalid Tool arguments.' }
    }
    if (!argumentsValue || typeof argumentsValue !== 'object' || (argumentsValue as Record<string, unknown>).nonce !== nonce) {
      return { state: 'failed-conformance', fingerprint, toolCalling: 'unsupported', reasoning: 'unknown', checkedAt, detail: 'The exact model emitted a Tool call with invalid verification arguments.' }
    }
    // Execute the advertised harmless Tool after validating the native call,
    // then send its exact result back to the same provider/model route. This is
    // intentionally a bounded verification Tool, not a canned final answer.
    const executedNonce = (argumentsValue as Record<string, unknown>).nonce
    if (typeof executedNonce !== 'string' || executedNonce !== nonce) return { state: 'failed-conformance', fingerprint, toolCalling: 'unsupported', reasoning: 'unknown', checkedAt, detail: 'The conformance Tool refused the exact model arguments.' }
    const second = await collect(options.adapter, { ...base, messages: secondModelMessages(options.provider, options.model, nonce, call, executedNonce) })
    const answer = second.map(textFromChunk).join('').trim()
    if (!answer) return { state: 'failed-conformance', fingerprint, toolCalling: 'verified', reasoning: 'unknown', checkedAt, detail: 'The exact model did not synthesize a final answer after the Tool result.' }
    if (!answer.includes(nonce)) return { state: 'failed-conformance', fingerprint, toolCalling: 'verified', reasoning: 'unknown', checkedAt, detail: 'The exact model returned text, but did not use the nonce from the Tool result.' }
    const reasoning = second.some(chunk => chunk.type === 'reasoning-delta' || (chunk.type === 'block-end' && chunk.block.type === 'reasoning')) ? 'supported' : 'unknown'
    return { state: 'verified', fingerprint, toolCalling: 'verified', reasoning, checkedAt, detail: projectHarnessText('Native Tool round trip verified for this exact provider/model.') }
  } catch (error) {
    if (options.signal?.aborted) throw error
    return { state: 'failed-conformance', fingerprint, toolCalling: 'unknown', reasoning: 'unknown', checkedAt, detail: projectHarnessText(error instanceof Error ? error.message : String(error)) }
  }
}
