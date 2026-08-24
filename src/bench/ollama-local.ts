import {
  BENCH_RUNNER_ID,
  FIXED_GENERATION_PARAMETERS,
  type BenchFailureCode,
  type RuntimeReportedMetricsV1,
} from './contract-v1.js'
import { SYNTHETIC_FIXTURE_PACK } from './fixture-v1.js'
import { sha256Text } from './serialization.js'

export const OLLAMA_LOCAL_BASE_URL = 'http://127.0.0.1:11434' as const
export const OLLAMA_GENERATE_URL = `${OLLAMA_LOCAL_BASE_URL}/api/generate` as const
export const OLLAMA_VERSION_URL = `${OLLAMA_LOCAL_BASE_URL}/api/version` as const

export const DEFAULT_OLLAMA_TIMEOUT_MS = 30_000
export const MAX_RESPONSE_BYTES = 1_048_576
export const MAX_OUTPUT_BYTES = 32_768
export const MAX_NDJSON_LINE_BYTES = 262_144
export const MAX_STREAM_CHUNKS = 4_096
export const MAX_STREAM_EVENTS = 4_096
export const MAX_MODEL_ID_LENGTH = 200

export type BenchFetch = typeof fetch

export class BenchOllamaError extends Error {
  constructor(
    public readonly code: BenchFailureCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message)
    this.name = 'BenchOllamaError'
  }
}

export type OllamaGenerateEvidence = {
  reportedModel: string | null
  observed: {
    requestLatencyMs: number
    timeToFirstContentMs: number | null
    responseBytes: number
    streamChunks: number
    streamEvents: number
    outputChars: number
    outputDigest: string
  }
  runtimeReported: RuntimeReportedMetricsV1
}

type MonotonicClock = () => number

type RequestBoundaryOptions = {
  signal?: AbortSignal
  timeoutMs: number
}

class RequestBoundary {
  readonly controller = new AbortController()
  private timeoutHandle: ReturnType<typeof setTimeout> | undefined
  private readonly removeExternalListener: (() => void) | undefined
  private readonly timeoutPromise: Promise<never>
  private readonly cancelPromise: Promise<never> | undefined
  private timedOut = false
  private cancelled = false

  constructor({ signal, timeoutMs }: RequestBoundaryOptions) {
    this.timeoutPromise = new Promise<never>((_, reject) => {
      this.timeoutHandle = setTimeout(() => {
        this.timedOut = true
        this.controller.abort()
        reject(new BenchOllamaError('timeout', `Ollama ${BENCH_RUNNER_ID} request timed out.`))
      }, timeoutMs)
    })

    if (signal) {
      const onAbort = () => {
        this.cancelled = true
        this.controller.abort(signal.reason)
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
      this.removeExternalListener = () => signal.removeEventListener('abort', onAbort)
      this.cancelPromise = new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new BenchOllamaError('cancelled', 'BenchRunV1 cancellation requested.'))
        else signal.addEventListener('abort', () => reject(new BenchOllamaError('cancelled', 'BenchRunV1 cancellation requested.')), { once: true })
      })
    }
  }

  async race<T>(promise: Promise<T>): Promise<T> {
    const contenders: Promise<unknown>[] = [promise, this.timeoutPromise]
    if (this.cancelPromise) contenders.push(this.cancelPromise)
    return await Promise.race(contenders) as T
  }

  wasTimedOut(): boolean {
    return this.timedOut
  }

  wasCancelled(): boolean {
    return this.cancelled
  }

  dispose(): void {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle)
    this.removeExternalListener?.()
  }
}

export function validateOllamaModelId(model: string): string {
  const normalized = model.trim()
  if (!normalized || normalized !== model) {
    throw new Error('model must be a non-empty Ollama model name without surrounding whitespace')
  }
  if (normalized.length > MAX_MODEL_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`model must be at most ${MAX_MODEL_ID_LENGTH} characters and contain no control characters`)
  }
  return normalized
}

function normalizeBoundaryError(error: unknown, boundary: RequestBoundary): BenchOllamaError {
  if (error instanceof BenchOllamaError) return error
  if (boundary.wasTimedOut()) return new BenchOllamaError('timeout', `Ollama ${BENCH_RUNNER_ID} request timed out.`)
  if (boundary.wasCancelled()) return new BenchOllamaError('cancelled', 'BenchRunV1 cancellation requested.')
  return new BenchOllamaError('transport-error', 'Ollama local runtime request failed.')
}

function getFetch(fetchImpl?: BenchFetch): BenchFetch {
  const request = fetchImpl ?? globalThis.fetch
  if (typeof request !== 'function') {
    throw new BenchOllamaError('runtime-unavailable', 'Ollama local runtime is unavailable: fetch is not available.')
  }
  return request
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BenchOllamaError('malformed-response', 'Ollama returned malformed JSON data.')
  }
  return value as Record<string, unknown>
}

function optionalModel(record: Record<string, unknown>): string | null {
  if (!Object.hasOwn(record, 'model') || record.model === null) return null
  if (typeof record.model !== 'string' || !record.model || record.model.length > MAX_MODEL_ID_LENGTH) {
    throw new BenchOllamaError('malformed-response', 'Ollama returned an invalid model identity.')
  }
  return record.model
}

function optionalRuntimeMetric(record: Record<string, unknown>, key: string): number | null {
  if (!Object.hasOwn(record, key) || record[key] === null) return null
  const value = record[key]
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new BenchOllamaError('malformed-response', `Ollama returned an invalid ${key} metric.`)
  }
  return value as number
}

function runtimeMetricsFrom(record: Record<string, unknown>): RuntimeReportedMetricsV1 {
  return {
    totalDurationNs: optionalRuntimeMetric(record, 'total_duration'),
    loadDurationNs: optionalRuntimeMetric(record, 'load_duration'),
    promptEvalCount: optionalRuntimeMetric(record, 'prompt_eval_count'),
    promptEvalDurationNs: optionalRuntimeMetric(record, 'prompt_eval_duration'),
    evalCount: optionalRuntimeMetric(record, 'eval_count'),
    evalDurationNs: optionalRuntimeMetric(record, 'eval_duration'),
  }
}

function appendOutput(current: string, value: unknown): string {
  if (value === undefined) return current
  if (typeof value !== 'string') {
    throw new BenchOllamaError('malformed-response', 'Ollama returned a non-text response chunk.')
  }
  const next = current + value
  if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) {
    throw new BenchOllamaError('response-limit', `Ollama response exceeded the ${MAX_OUTPUT_BYTES}-byte output limit.`)
  }
  return next
}

function parseNdjsonEvent(
  line: string,
  state: {
    doneSeen: boolean
    reportedModel: string | null
    output: string
    runtimeReported: RuntimeReportedMetricsV1
    streamEvents: number
    firstContentAt: number | null
  },
  monotonicNow: MonotonicClock,
  startedAt: number,
): void {
  const trimmed = line.trim()
  if (!trimmed) return
  if (state.doneSeen) {
    throw new BenchOllamaError('malformed-response', 'Ollama returned data after the final stream event.')
  }
  state.streamEvents += 1
  if (state.streamEvents > MAX_STREAM_EVENTS) {
    throw new BenchOllamaError('response-limit', `Ollama response exceeded the ${MAX_STREAM_EVENTS}-event limit.`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new BenchOllamaError('malformed-response', 'Ollama returned malformed NDJSON.')
  }
  const record = objectValue(parsed)
  if (typeof record.done !== 'boolean') {
    throw new BenchOllamaError('malformed-response', 'Ollama stream event omitted its done flag.')
  }
  if (Object.hasOwn(record, 'error') && record.error !== null && record.error !== undefined) {
    throw new BenchOllamaError('runtime-error', 'Ollama reported a generation failure.')
  }

  const model = optionalModel(record)
  if (model !== null) {
    if (state.reportedModel !== null && state.reportedModel !== model) {
      throw new BenchOllamaError('malformed-response', 'Ollama changed model identity during a run.')
    }
    state.reportedModel = model
  }

  if (Object.hasOwn(record, 'response')) {
    const before = state.output
    state.output = appendOutput(state.output, record.response)
    if (before.length !== state.output.length && state.firstContentAt === null) {
      state.firstContentAt = Math.max(0, monotonicNow() - startedAt)
    }
  }

  if (record.done) {
    state.runtimeReported = runtimeMetricsFrom(record)
    state.doneSeen = true
  }
}

async function readResponseText(
  response: Response,
  boundary: RequestBoundary,
  maxBytes: number,
): Promise<string> {
  if (!response.body) throw new BenchOllamaError('malformed-response', 'Ollama returned an empty response body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const next = await boundary.race(reader.read())
      if (next.done) break
      if (!next.value) throw new BenchOllamaError('malformed-response', 'Ollama returned an empty response chunk.')
      bytes += next.value.byteLength
      if (bytes > maxBytes) throw new BenchOllamaError('response-limit', 'Ollama response exceeded its byte limit.')
      try {
        text += decoder.decode(next.value, { stream: true })
      } catch {
        throw new BenchOllamaError('malformed-response', 'Ollama returned invalid UTF-8 data.')
      }
    }
    try {
      text += decoder.decode()
    } catch {
      throw new BenchOllamaError('malformed-response', 'Ollama returned incomplete UTF-8 data.')
    }
    return text
  } finally {
    reader.releaseLock()
  }
}

export async function fetchOllamaVersion(options: {
  fetchImpl?: BenchFetch
  signal?: AbortSignal
  timeoutMs?: number
} = {}): Promise<string | null> {
  const request = getFetch(options.fetchImpl)
  const boundary = new RequestBoundary({
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS,
  })
  try {
    const response = await boundary.race(request(OLLAMA_VERSION_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: boundary.controller.signal,
    }))
    if (!response.ok) return null
    const text = await readResponseText(response, boundary, 16_384)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return null
    }
    const record = objectValue(parsed)
    if (typeof record.version !== 'string' || !record.version || record.version.length > 128) return null
    return record.version
  } catch (error) {
    const normalized = normalizeBoundaryError(error, boundary)
    if (normalized.code === 'timeout' || normalized.code === 'cancelled') throw normalized
    return null
  } finally {
    boundary.dispose()
  }
}

export async function runOllamaGenerate(options: {
  model: string
  fetchImpl?: BenchFetch
  signal?: AbortSignal
  timeoutMs?: number
  monotonicNow?: MonotonicClock
}): Promise<OllamaGenerateEvidence> {
  const model = validateOllamaModelId(options.model)
  const request = getFetch(options.fetchImpl)
  const monotonicNow = options.monotonicNow ?? (() => performance.now())
  const boundary = new RequestBoundary({
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS,
  })
  const startedAt = monotonicNow()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let responseBytes = 0
  let streamChunks = 0
  const state = {
    doneSeen: false,
    reportedModel: null as string | null,
    output: '',
    runtimeReported: {
      totalDurationNs: null,
      loadDurationNs: null,
      promptEvalCount: null,
      promptEvalDurationNs: null,
      evalCount: null,
      evalDurationNs: null,
    } satisfies RuntimeReportedMetricsV1,
    streamEvents: 0,
    firstContentAt: null as number | null,
  }

  try {
    const response = await boundary.race(request(OLLAMA_GENERATE_URL, {
      method: 'POST',
      headers: { accept: 'application/x-ndjson', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: SYNTHETIC_FIXTURE_PACK.prompt,
        stream: true,
        keep_alive: '5m',
        options: {
          temperature: FIXED_GENERATION_PARAMETERS.temperature,
          seed: FIXED_GENERATION_PARAMETERS.seed,
          num_predict: FIXED_GENERATION_PARAMETERS.numPredict,
        },
      }),
      signal: boundary.controller.signal,
    }))

    if (!response.ok) {
      const code: BenchFailureCode = response.status === 404 ? 'model-not-found' : 'http-error'
      throw new BenchOllamaError(code, response.status === 404
        ? 'Ollama could not find the selected model.'
        : `Ollama returned HTTP status ${response.status}.`, response.status)
    }
    if (!response.body) throw new BenchOllamaError('malformed-response', 'Ollama returned an empty response body.')
    reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let pendingLine = ''
    while (true) {
      const next = await boundary.race(reader.read())
      if (next.done) break
      if (!next.value) throw new BenchOllamaError('malformed-response', 'Ollama returned an empty response chunk.')
      streamChunks += 1
      if (streamChunks > MAX_STREAM_CHUNKS) {
        throw new BenchOllamaError('response-limit', `Ollama response exceeded the ${MAX_STREAM_CHUNKS}-chunk limit.`)
      }
      responseBytes += next.value.byteLength
      if (responseBytes > MAX_RESPONSE_BYTES) {
        throw new BenchOllamaError('response-limit', `Ollama response exceeded the ${MAX_RESPONSE_BYTES}-byte limit.`)
      }
      let decoded: string
      try {
        decoded = decoder.decode(next.value, { stream: true })
      } catch {
        throw new BenchOllamaError('malformed-response', 'Ollama returned invalid UTF-8 data.')
      }
      pendingLine += decoded
      if (Buffer.byteLength(pendingLine, 'utf8') > MAX_NDJSON_LINE_BYTES) {
        throw new BenchOllamaError('response-limit', `Ollama returned an NDJSON line over the ${MAX_NDJSON_LINE_BYTES}-byte limit.`)
      }
      let newline = pendingLine.indexOf('\n')
      while (newline >= 0) {
        const line = pendingLine.slice(0, newline)
        pendingLine = pendingLine.slice(newline + 1)
        parseNdjsonEvent(line, state, monotonicNow, startedAt)
        newline = pendingLine.indexOf('\n')
      }
    }
    try {
      pendingLine += decoder.decode()
    } catch {
      throw new BenchOllamaError('malformed-response', 'Ollama returned incomplete UTF-8 data.')
    }
    if (Buffer.byteLength(pendingLine, 'utf8') > MAX_NDJSON_LINE_BYTES) {
      throw new BenchOllamaError('response-limit', `Ollama returned an NDJSON line over the ${MAX_NDJSON_LINE_BYTES}-byte limit.`)
    }
    parseNdjsonEvent(pendingLine, state, monotonicNow, startedAt)
    if (!state.doneSeen) throw new BenchOllamaError('malformed-response', 'Ollama stream ended before a final event.')

    const outputDigest = sha256Text(state.output)
    return {
      reportedModel: state.reportedModel,
      observed: {
        requestLatencyMs: Math.max(0, monotonicNow() - startedAt),
        timeToFirstContentMs: state.firstContentAt === null ? null : Math.max(0, state.firstContentAt),
        responseBytes,
        streamChunks,
        streamEvents: state.streamEvents,
        outputChars: Array.from(state.output).length,
        outputDigest,
      },
      runtimeReported: state.runtimeReported,
    }
  } catch (error) {
    await reader?.cancel().catch(() => undefined)
    throw normalizeBoundaryError(error, boundary)
  } finally {
    reader?.releaseLock()
    boundary.dispose()
  }
}
