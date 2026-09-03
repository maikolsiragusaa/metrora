import type {
  ContentBlock,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  Message,
  ResolvedRetryPolicy,
  StreamChunk,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'

import { exactReasoningEfforts, type HarnessHostedModel, type HarnessHostedProbe, type HarnessHostedProvider, type HarnessReasoningEffort } from './harness-runtime-types.js'

type FetchLike = typeof fetch
type SecretReader = (provider: HarnessHostedProvider) => Promise<string | null>
type TextDelta = (event: { sessionId?: string; text: string }) => void
type ReasoningDelta = (event: { sessionId?: string; text: string }) => void
type RecordValue = Record<string, unknown>

const ROUTES: Record<HarnessHostedProvider, string> = {
  openai: 'metrora-hosted-openai',
  anthropic: 'metrora-hosted-anthropic',
  gemini: 'metrora-hosted-gemini',
  openrouter: 'metrora-hosted-openrouter',
  'opencode-zen': 'metrora-hosted-opencode-zen',
}
const ORIGINS: Record<HarnessHostedProvider, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai',
  'opencode-zen': 'https://opencode.ai',
}
const RETRY_POLICY: ResolvedRetryPolicy = { mode: 'normal', maxRetries: 2, retryableCodes: Object.freeze(['RATE_LIMIT', 'SERVER']), initialDelayMs: 400, maxDelayMs: 3_000, jitterRatio: 0.1 }
const MAX_BYTES = 2 * 1024 * 1024
const MAX_CALLS = 16
const PROBE_TIMEOUT_MS = 5_000
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u
const ANTHROPIC_REASONING_BUDGETS: Readonly<Record<string, number>> = Object.freeze({ min: 1_024, minimal: 1_024, low: 2_048, medium: 4_096, high: 8_192, xhigh: 16_384, max: 32_768 })
const GEMINI_REASONING_BUDGETS: Readonly<Record<string, number>> = Object.freeze({ min: 512, minimal: 512, low: 1_024, medium: 2_048, high: 4_096, xhigh: 8_192, max: 8_192 })

function isRecord(value: unknown): value is RecordValue { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
function textBlocks(blocks: readonly ContentBlock[]): string { return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('') }
function resultBlocks(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => {
    if (block.type === 'text') return [block.text]
    if (block.type === 'tool-result') return resultBlocks(block.content)
    return [JSON.stringify(block)]
  }).join('')
}
function id(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  if (value.length > 512) throw new Error('Hosted provider returned an oversized Tool call id.')
  return value
}
function args(value: unknown): string {
  const result = typeof value === 'string' ? value : JSON.stringify(value ?? {})
  return boundedText(result, 'Hosted provider returned oversized Tool arguments.')
}
function toolCalls(value: unknown): Array<{ id: string; name: string; arguments: string }> {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_CALLS).flatMap((item, index) => {
    if (!isRecord(item)) return []
    const fn = isRecord(item.function) ? item.function : item
    if (typeof fn.name !== 'string' || !fn.name.trim()) return []
    return [{ id: id(item.id, `hosted-adapter-call-${index + 1}`), name: fn.name, arguments: args(fn.arguments) }]
  })
}
function toolSchemas(tools: readonly ToolSchema[] | undefined): Array<Record<string, unknown>> {
  return (tools ?? []).slice(0, 32).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
}
function providerMessages(options: GenerateOptions): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = []
  for (const message of options.messages) {
    const content = textBlocks(message.content)
    if (message.role === 'system') { messages.push({ role: 'system', content }); continue }
    if (message.source.kind === 'tool') { messages.push({ role: 'tool', content: resultBlocks(message.content), tool_call_id: message.source.callId }); continue }
    if (message.role === 'assistant') {
      const calls = message.content.flatMap((block, index) => block.type === 'tool-call' ? [{ id: block.id || `hosted-adapter-call-${index + 1}`, type: 'function', function: { name: block.name, arguments: block.arguments } }] : [])
      messages.push({ role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) })
    } else messages.push({ role: 'user', content })
  }
  if (options.system && !messages.some(message => message.role === 'system')) messages.unshift({ role: 'system', content: options.system })
  return messages
}
function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : { value: parsed }
  } catch {
    return { value }
  }
}
function geminiContents(options: GenerateOptions): Array<Record<string, unknown>> {
  const contents: Array<Record<string, unknown>> = []
  const toolNames = new Map<string, string>()
  for (const message of options.messages) {
    if (message.role === 'system') continue
    if (message.source.kind === 'tool') {
      const callId = String(message.source.callId)
      const name = toolNames.get(callId) ?? 'tool_result'
      const output = resultBlocks(message.content)
      contents.push({ role: 'user', parts: [{ functionResponse: { name, response: { output }, id: callId } }] })
      continue
    }
    if (message.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = []
      const text = textBlocks(message.content)
      if (text) parts.push({ text })
      for (const block of message.content) {
        if (block.type !== 'tool-call') continue
        const callId = String(block.id)
        toolNames.set(callId, block.name)
        parts.push({ functionCall: { name: block.name, args: jsonObject(block.arguments), id: callId } })
      }
      if (parts.length) contents.push({ role: 'model', parts })
      continue
    }
    contents.push({ role: 'user', parts: [{ text: textBlocks(message.content) }] })
  }
  return contents
}
function usage(value: unknown): { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null {
  if (!isRecord(value)) return null
  const input = typeof value.prompt_tokens === 'number' ? value.prompt_tokens : typeof value.input_tokens === 'number' ? value.input_tokens : typeof value.inputTokenCount === 'number' ? value.inputTokenCount : null
  const output = typeof value.completion_tokens === 'number' ? value.completion_tokens : typeof value.output_tokens === 'number' ? value.output_tokens : typeof value.outputTokenCount === 'number' ? value.outputTokenCount : null
  const total = typeof value.total_tokens === 'number' ? value.total_tokens : input !== null && output !== null ? input + output : null
  return input !== null || output !== null || total !== null ? { inputTokens: input, outputTokens: output, totalTokens: total } : null
}
function boundedText(value: string, label: string): string { if (new TextEncoder().encode(value).byteLength > MAX_BYTES) throw new Error(label); return value }
function abortError(): Error { const error = new Error('Hosted Harness request cancelled.'); error.name = 'AbortError'; return error }
function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  const forward = () => controller.abort()
  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', forward, { once: true })
  return { signal: controller.signal, timedOut: () => timedOut, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', forward) } }
}
async function boundedResponseText(response: Response, label: string): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return boundedText(await response.text(), label)
  const decoder = new TextDecoder()
  let output = ''
  let bytes = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > MAX_BYTES) throw new Error(label)
    output += decoder.decode(part.value, { stream: true })
  }
  return output + decoder.decode()
}
function providerError(error: unknown): unknown {
  if (error instanceof Error && error.name === 'AbortError') return error
  const status = error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : undefined
  if (status === 429) return new LlmError('The selected hosted provider rate-limited the request.', 'RATE_LIMIT')
  if (status !== undefined && status >= 500) return new LlmError('The selected hosted provider returned a temporary server error.', 'SERVER')
  return error
}
function errorStatus(status: number): Error { const error = new Error('Hosted provider returned HTTP ' + status + '.'); (error as Error & { status?: number }).status = status; return error }

function numericReasoningBudget(effort: string): number | null {
  const match = /(?:budget|thinking[-_:./]?budget|tokens?)[^0-9]*(\d{2,6})$/iu.exec(effort) ?? /^(\d{2,6})$/u.exec(effort)
  if (!match) return null
  const budget = Number(match[1])
  return Number.isSafeInteger(budget) && budget >= 256 && budget <= 1_000_000 ? budget : null
}

/** Translate one opaque DSH effort id at the provider boundary. OpenAI
 * compatible routes preserve the id verbatim; Anthropic and Gemini expose a
 * token budget instead, so only provider-declared budget ids or explicit
 * provider adapter aliases are accepted. Unknown ids fail closed rather than
 * silently becoming a different level of reasoning. */
export function hostedReasoningConfig(provider: HarnessHostedProvider, effort: string | null | undefined): Record<string, unknown> | undefined {
  if (!effort) return undefined
  if (provider === 'openai' || provider === 'openrouter' || provider === 'opencode-zen') return { reasoning_effort: effort }
  if (effort.toLowerCase() === 'none') return provider === 'gemini' ? { thinkingConfig: { thinkingBudget: 0 } } : undefined
  const aliases = provider === 'anthropic' ? ANTHROPIC_REASONING_BUDGETS : GEMINI_REASONING_BUDGETS
  const budget = numericReasoningBudget(effort) ?? aliases[effort.toLowerCase()]
  if (budget === undefined) throw new Error(`The selected ${provider} reasoning capability "${effort}" has no supported provider wire translation.`)
  return provider === 'anthropic'
    ? { thinking: { type: 'enabled', budget_tokens: budget } }
    : { thinkingConfig: { thinkingBudget: budget } }
}

export function hostedProviderRoute(provider: HarnessHostedProvider): string { return ROUTES[provider] }
export function hostedProviderFromRoute(route: string): HarnessHostedProvider | null { return (Object.keys(ROUTES) as HarnessHostedProvider[]).find(provider => ROUTES[provider] === route) ?? null }

export async function probeHostedProvider(
  provider: HarnessHostedProvider,
  readCredential: SecretReader,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<HarnessHostedProbe> {
  const secret = await readCredential(provider)
  if (!secret) return { provider, available: false, models: [], detail: 'Configure this provider in Harness settings before discovering models.', credentialState: 'not-configured' }
  const url = provider === 'openrouter'
    ? `${ORIGINS[provider]}/api/v1/models`
    : provider === 'opencode-zen'
      ? `${ORIGINS[provider]}/zen/v1/models`
      : provider === 'gemini'
        ? `${ORIGINS[provider]}/v1beta/models`
        : `${ORIGINS[provider]}/v1/models`
  const timed = timeoutSignal(signal, PROBE_TIMEOUT_MS)
  try {
    if (signal?.aborted) throw abortError()
    const response = await fetchImpl(url, { method: 'GET', headers: provider === 'anthropic' ? { 'x-api-key': secret, 'anthropic-version': '2023-06-01' } : provider === 'gemini' ? { 'x-goog-api-key': secret } : { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: timed.signal })
    if (timed.signal.aborted) throw timed.timedOut() ? new Error('Hosted Harness discovery timed out.') : abortError()
    if (!response.ok) throw errorStatus(response.status)
    const payload = JSON.parse(await boundedResponseText(response, 'Hosted Harness provider response exceeded the safety limit.')) as unknown
    const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : isRecord(payload) && Array.isArray(payload.models) ? payload.models : []
    const models: HarnessHostedModel[] = rows.slice(0, 128).flatMap(row => {
      if (!isRecord(row)) return []
      const raw = typeof row.id === 'string' ? row.id : typeof row.name === 'string' ? row.name : typeof row.key === 'string' ? row.key : ''
      const model = raw.replace(/^models\//u, '')
      if (!MODEL_PATTERN.test(model)) return []
      const reasoningEfforts = exactReasoningEfforts(row)
      return [{ id: model, label: model, state: 'discovered', limitation: 'Exact Tool and reasoning conformance is checked on first use.', capabilities: { conversational: 'available', streaming: 'supported', toolCall: 'unknown' }, ...(reasoningEfforts ? { reasoningEfforts } : {}) }]
    })
    return { provider, available: true, models, detail: `${provider} is reachable.`, credentialState: 'ready' }
  } catch (error) {
    if (signal?.aborted) {
      const cancelled = new Error('Hosted Harness discovery was cancelled.')
      cancelled.name = 'AbortError'
      throw cancelled
    }
    if (timed.timedOut()) return { provider, available: false, models: [], detail: 'Hosted provider discovery timed out.', credentialState: 'ready' }
    const message = error instanceof Error && (error as Error & { status?: number }).status === 401 ? 'The saved provider credential was rejected.' : 'The selected provider is unavailable.'
    return { provider, available: false, models: [], detail: message, credentialState: 'ready' }
  } finally { timed.dispose() }
}

export type HarnessHostedAdapterOptions = { fetchImpl?: FetchLike; readCredential: SecretReader; onTextDelta?: TextDelta; onReasoningDelta?: ReasoningDelta }

/**
 * One DSH adapter for hosted routes. Credential access is injected from the
 * protected Electron main-process store; the renderer and the DSH Session see
 * only provider/model metadata and normal DSH message blocks.
 */
export class MetroraHostedLlmAdapter extends LlmAdapter {
  private readonly fetchImpl: FetchLike
  private readonly readCredential: SecretReader
  private readonly onTextDelta?: TextDelta
  private readonly onReasoningDelta?: ReasoningDelta

  constructor(options: HarnessHostedAdapterOptions) { super(); this.fetchImpl = options.fetchImpl ?? fetch; this.readCredential = options.readCredential; this.onTextDelta = options.onTextDelta; this.onReasoningDelta = options.onReasoningDelta }
  providerInfo(provider: string): LlmProviderInfo { const resolved = hostedProviderFromRoute(provider); if (!resolved) throw new Error('Unknown hosted Harness provider route.'); return { id: provider, name: resolved } }
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy { return RETRY_POLICY }
  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> { return [] }
  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { if (!hostedProviderFromRoute(provider) || !MODEL_PATTERN.test(model)) throw new Error('Hosted Harness model is invalid.'); return { provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: 128_000 } } }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const provider = hostedProviderFromRoute(options.provider)
    if (!provider) throw new Error('Unknown hosted Harness provider route.')
    const secret = await this.readCredential(provider)
    if (!secret) throw new LlmError('Configure the selected hosted provider in Harness settings before sending.', 'AUTH')
    try {
      const result = provider === 'anthropic'
        ? await this.anthropic(secret, options)
        : provider === 'gemini'
          ? await this.gemini(secret, options)
          : await this.openAiCompatible(secret, provider, options)
      yield* this.chunks(result, options)
    } catch (error) { throw providerError(error) }
  }

  private async openAiCompatible(secret: string, provider: HarnessHostedProvider, options: GenerateOptions): Promise<ParsedHostedResult> {
    const endpoint = provider === 'openrouter' ? `${ORIGINS[provider]}/api/v1/chat/completions` : provider === 'opencode-zen' ? `${ORIGINS[provider]}/zen/v1/chat/completions` : `${ORIGINS[provider]}/v1/chat/completions`
    const body = JSON.stringify({ model: options.model, messages: providerMessages(options), ...(options.tools?.length ? { tools: toolSchemas(options.tools) } : {}), stream: true, ...hostedReasoningConfig(provider, options.reasoningEffort ? String(options.reasoningEffort) : undefined) })
    boundedText(body, 'Hosted Harness request exceeded the safety limit.')
    const response = await this.fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body, redirect: 'error', signal: options.signal })
    if (!response.ok) throw errorStatus(response.status)
    return parseOpenAiStream(await boundedResponseText(response, 'Hosted Harness provider response exceeded the safety limit.'), options, this.onTextDelta, this.onReasoningDelta)
  }

  private async anthropic(secret: string, options: GenerateOptions): Promise<ParsedHostedResult> {
    const messages = providerMessages(options).filter(message => message.role !== 'system').map(message => {
      if (message.role === 'tool') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content }] }
      if (message.role === 'assistant' && Array.isArray(message.tool_calls)) return { role: 'assistant', content: [...(typeof message.content === 'string' && message.content ? [{ type: 'text', text: message.content }] : []), ...message.tool_calls.map(call => ({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(String(call.function.arguments || '{}')) }))] }
      return { role: message.role, content: message.content }
    })
    const system = providerMessages(options).find(message => message.role === 'system')?.content
    const body = JSON.stringify({ model: options.model, max_tokens: options.maxTokens ?? 4096, ...(system ? { system } : {}), messages, ...(options.tools?.length ? { tools: (options.tools ?? []).slice(0, 32).map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}), stream: true, ...hostedReasoningConfig('anthropic', options.reasoningEffort ? String(options.reasoningEffort) : undefined) })
    boundedText(body, 'Hosted Harness request exceeded the safety limit.')
    const response = await this.fetchImpl(`${ORIGINS.anthropic}/v1/messages`, { method: 'POST', headers: { 'x-api-key': secret, 'anthropic-version': '2023-06-01', Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body, redirect: 'error', signal: options.signal })
    if (!response.ok) throw errorStatus(response.status)
    return parseAnthropicStream(await boundedResponseText(response, 'Hosted Harness provider response exceeded the safety limit.'), options, this.onTextDelta, this.onReasoningDelta)
  }

  private async gemini(secret: string, options: GenerateOptions): Promise<ParsedHostedResult> {
    const converted = providerMessages(options)
    const system = converted.find(message => message.role === 'system')?.content
    const contents = geminiContents(options)
    const reasoning = hostedReasoningConfig('gemini', options.reasoningEffort ? String(options.reasoningEffort) : undefined)
    const body = JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, ...(options.tools?.length ? { tools: [{ functionDeclarations: (options.tools ?? []).slice(0, 32).map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }] } : {}), ...(reasoning ? { generationConfig: reasoning } : {}) })
    boundedText(body, 'Hosted Harness request exceeded the safety limit.')
    const response = await this.fetchImpl(`${ORIGINS.gemini}/v1beta/models/${encodeURIComponent(options.model.replace(/^models\//u, ''))}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'x-goog-api-key': secret, Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body, redirect: 'error', signal: options.signal })
    if (!response.ok) throw errorStatus(response.status)
    return parseGeminiStream(await boundedResponseText(response, 'Hosted Harness provider response exceeded the safety limit.'), options, this.onTextDelta, this.onReasoningDelta)
  }

  private *chunks(result: ParsedHostedResult, options: GenerateOptions): Generator<StreamChunk> {
    let index = 0
    if (result.reasoning) { yield { type: 'block-start', index, blockType: 'reasoning' }; yield { type: 'reasoning-delta', index, text: result.reasoning }; yield { type: 'block-end', index, block: { type: 'reasoning', text: result.reasoning } }; index += 1 }
    if (result.content) { yield { type: 'block-start', index, blockType: 'text' }; yield { type: 'text-delta', index, text: result.content }; yield { type: 'block-end', index, block: { type: 'text', text: result.content } }; index += 1 }
    for (const [callIndex, call] of result.calls.entries()) { yield { type: 'block-start', index, blockType: 'tool-call' }; yield { type: 'tool-call-delta', index, id: call.id as never, name: call.name, argumentsDelta: call.arguments }; yield { type: 'block-end', index, block: { type: 'tool-call', id: call.id as never, name: call.name, arguments: call.arguments } }; index += 1; void callIndex }
    if (result.usage) yield { type: 'usage', usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0, totalTokens: result.usage.totalTokens ?? 0 } }
    yield { type: 'finish', reason: result.calls.length ? { kind: 'tool-calls' } : { kind: 'stop' } }
    void options
  }
}

type ParsedHostedResult = { content: string; reasoning: string; calls: Array<{ id: string; name: string; arguments: string }>; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null }

async function parseOpenAiStream(value: string, options: GenerateOptions, onText?: TextDelta, onReasoning?: ReasoningDelta): Promise<ParsedHostedResult> {
  let content = ''; let reasoning = ''; const calls: Array<RecordValue> = []; let lastUsage: ParsedHostedResult['usage'] = null
  for (const line of value.split(/\r?\n/gu)) {
    if (!line.startsWith('data:')) continue
    const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') continue
    let payload: unknown; try { payload = JSON.parse(raw) } catch { continue }
    if (!isRecord(payload)) continue
    lastUsage = usage(payload.usage) ?? lastUsage
    const choice = Array.isArray(payload.choices) && isRecord(payload.choices[0]) ? payload.choices[0] : null
    const delta = choice && isRecord(choice.delta) ? choice.delta : null; if (!delta) continue
    if (typeof delta.content === 'string') { content += delta.content; onText?.({ sessionId: options.sessionId, text: delta.content }) }
    const part = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : ''
    if (part) { reasoning += part; onReasoning?.({ sessionId: options.sessionId, text: part }) }
    if (Array.isArray(delta.tool_calls)) for (const call of delta.tool_calls) if (isRecord(call) && typeof call.index === 'number') {
      const index = Math.max(0, Math.min(MAX_CALLS - 1, Math.floor(call.index))); const current = calls[index] ?? { id: '', function: { name: '', arguments: '' } }; const fn = isRecord(call.function) ? call.function : {}; const currentFn = isRecord(current.function) ? current.function : {}
      if (typeof call.id === 'string' && call.id) current.id = call.id
      current.function = { ...currentFn, ...(typeof fn.name === 'string' ? { name: fn.name } : {}), ...(typeof fn.arguments === 'string' ? { arguments: String(currentFn.arguments ?? '') + fn.arguments } : {}) }; calls[index] = current
    }
  }
  return { content, reasoning, calls: toolCalls(calls.filter(Boolean)), usage: lastUsage }
}
async function parseAnthropicStream(value: string, options: GenerateOptions, onText?: TextDelta, onReasoning?: ReasoningDelta): Promise<ParsedHostedResult> {
  let content = ''; let reasoning = ''; const calls: Array<{ id: string; name: string; arguments: string }> = []; let active: { id: string; name: string; args: string } | null = null; let lastUsage: ParsedHostedResult['usage'] = null
  for (const line of value.split(/\r?\n/gu)) {
    if (!line.startsWith('data:')) continue
    let payload: unknown; try { payload = JSON.parse(line.slice(5).trim()) } catch { continue }
    if (!isRecord(payload)) continue
    if (payload.type === 'message_start' && isRecord(payload.message)) lastUsage = usage(payload.message.usage) ?? lastUsage
    if (payload.type === 'message_delta') lastUsage = usage(payload.usage) ?? lastUsage
    if (payload.type === 'content_block_start' && isRecord(payload.content_block) && payload.content_block.type === 'tool_use') active = { id: id(payload.content_block.id, `hosted-adapter-call-${calls.length + 1}`), name: typeof payload.content_block.name === 'string' ? payload.content_block.name : 'unknown_tool', args: '' }
    if (payload.type === 'content_block_delta' && isRecord(payload.delta)) {
      const delta = payload.delta
      if (delta.type === 'text_delta' && typeof delta.text === 'string') { content += delta.text; onText?.({ sessionId: options.sessionId, text: delta.text }) }
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') { reasoning += delta.thinking; onReasoning?.({ sessionId: options.sessionId, text: delta.thinking }) }
      if (delta.type === 'input_json_delta' && active && typeof delta.partial_json === 'string') active.args += delta.partial_json
    }
    if (payload.type === 'content_block_stop' && active) { calls.push({ id: active.id, name: active.name, arguments: active.args || '{}' }); active = null }
  }
  return { content, reasoning, calls, usage: lastUsage }
}
async function parseGeminiStream(value: string, options: GenerateOptions, onText?: TextDelta, onReasoning?: ReasoningDelta): Promise<ParsedHostedResult> {
  let content = ''; let reasoning = ''; const calls: Array<{ id: string; name: string; arguments: string }> = []; let lastUsage: ParsedHostedResult['usage'] = null
  for (const line of value.split(/\r?\n/gu)) {
    if (!line.startsWith('data:')) continue
    let payload: unknown; try { payload = JSON.parse(line.slice(5).trim()) } catch { continue }
    if (!isRecord(payload)) continue
    lastUsage = usage(payload.usageMetadata) ?? lastUsage
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
    const parts = candidates[0] && isRecord(candidates[0]) && isRecord(candidates[0].content) && Array.isArray(candidates[0].content.parts) ? candidates[0].content.parts : []
    for (const part of parts) if (isRecord(part)) {
      if (typeof part.text === 'string') { if (part.thought === true) { reasoning += part.text; onReasoning?.({ sessionId: options.sessionId, text: part.text }) } else { content += part.text; onText?.({ sessionId: options.sessionId, text: part.text }) } }
      if (isRecord(part.functionCall) && typeof part.functionCall.name === 'string') calls.push({ id: id(part.functionCall.id, `hosted-adapter-call-${calls.length + 1}`), name: part.functionCall.name, arguments: args(part.functionCall.args) })
    }
  }
  return { content, reasoning, calls, usage: lastUsage }
}
