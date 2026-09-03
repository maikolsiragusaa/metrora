import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  HarnessHostedProvider,
  HarnessMode,
  HarnessReasoningEffort,
  HarnessRuntimeChoice,
  HarnessRuntimeId,
  HarnessRuntimeProfileV1,
} from './harness-runtime-types.js'
import { reasoningProfileKey } from './harness-runtime-types.js'
import { parseHarnessMcpServers, validateHarnessMcpServers } from './harness-mcp.mjs'

export const HARNESS_PROFILE_VERSION = 1 as const
export const DEFAULT_LLAMA_SERVER_PORT = 8080
export const HARNESS_PROFILE_FILENAME = 'profile.json'

const RUNTIMES: readonly HarnessRuntimeId[] = ['ollama', 'lmstudio', 'llama-server']
const PROVIDERS: readonly HarnessHostedProvider[] = ['openai', 'anthropic', 'gemini', 'openrouter', 'opencode-zen']
const MODES: readonly HarnessMode[] = ['ask', 'plan', 'edit', 'build']
const EFFORTS: readonly HarnessReasoningEffort[] = ['min', 'low', 'medium', 'high', 'max']
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u

export function validLlamaServerPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 65_535
}

export function normalizeLlamaServerPort(value: unknown): number {
  return validLlamaServerPort(value) ? value : DEFAULT_LLAMA_SERVER_PORT
}

function validModel(value: unknown): value is string {
  return typeof value === 'string' && MODEL_PATTERN.test(value)
}

function validReasoningKey(key: string): boolean {
  // Accept the pre-route model-only key only as a bounded migration reader;
  // newly written preferences always use the exact JSON route tuple below.
  if (validModel(key)) return true
  try {
    const tuple = JSON.parse(key) as unknown
    if (!Array.isArray(tuple) || tuple.length !== 3) return false
    const [runtime, provider, model] = tuple
    const validRuntime = runtime === 'hosted' || RUNTIMES.includes(runtime as HarnessRuntimeId)
    const validProvider = provider === null || PROVIDERS.includes(provider as HarnessHostedProvider)
    return validRuntime && validProvider && validModel(model)
  } catch {
    return false
  }
}

function boundedModelMap(value: unknown): Record<string, HarnessReasoningEffort> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, HarnessReasoningEffort> = {}
  for (const [model, effort] of Object.entries(value)) {
    if (Object.keys(result).length >= 128) break
    if (validReasoningKey(model) && typeof effort === 'string' && (EFFORTS as readonly string[]).includes(effort)) {
      result[model] = effort as HarnessReasoningEffort
    }
  }
  return result
}

function boundedRuntimeMap(value: unknown): Partial<Record<HarnessRuntimeId, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Partial<Record<HarnessRuntimeId, string>> = {}
  for (const runtime of RUNTIMES) {
    const model = (value as Record<string, unknown>)[runtime]
    if (validModel(model)) result[runtime] = model
  }
  return result
}

function boundedProviderMap(value: unknown): Partial<Record<HarnessHostedProvider, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Partial<Record<HarnessHostedProvider, string>> = {}
  for (const provider of PROVIDERS) {
    const model = (value as Record<string, unknown>)[provider]
    if (validModel(model)) result[provider] = model
  }
  return result
}

export function defaultHarnessRuntimeProfile(): HarnessRuntimeProfileV1 {
  return {
    version: HARNESS_PROFILE_VERSION,
    runtime: 'ollama',
    lastLocalRuntime: 'ollama',
    lastLocalModelByRuntime: {},
    lastHostedModelByProvider: {},
    llamaServerPort: DEFAULT_LLAMA_SERVER_PORT,
    reasoningByModel: {},
    hostedConsentByProvider: {},
    lastUsable: null,
    mcpServers: [],
    ui: { showReasoning: true, compactProcess: true, density: 'comfortable' },
  }
}

export function parseHarnessRuntimeProfile(value: unknown): HarnessRuntimeProfileV1 {
  const fallback = defaultHarnessRuntimeProfile()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const row = value as Record<string, unknown>
  const runtime = row.runtime === 'hosted' || RUNTIMES.includes(row.runtime as HarnessRuntimeId) ? row.runtime as HarnessRuntimeChoice : fallback.runtime
  const lastLocalRuntime = RUNTIMES.includes(row.lastLocalRuntime as HarnessRuntimeId) ? row.lastLocalRuntime as HarnessRuntimeId : fallback.lastLocalRuntime
  const consent: HarnessRuntimeProfileV1['hostedConsentByProvider'] = {}
  if (row.hostedConsentByProvider && typeof row.hostedConsentByProvider === 'object' && !Array.isArray(row.hostedConsentByProvider)) {
    for (const provider of PROVIDERS) {
      const state = (row.hostedConsentByProvider as Record<string, unknown>)[provider]
      if (state === 'unknown' || state === 'accepted' || state === 'declined') consent[provider] = state
    }
  }
  const lastUsable = row.lastUsable && typeof row.lastUsable === 'object' && !Array.isArray(row.lastUsable) ? row.lastUsable as Record<string, unknown> : null
  const usable = lastUsable && (lastUsable.runtime === 'hosted' || RUNTIMES.includes(lastUsable.runtime as HarnessRuntimeId)) && validModel(lastUsable.model)
    ? {
        runtime: lastUsable.runtime as HarnessRuntimeChoice,
        provider: PROVIDERS.includes(lastUsable.provider as HarnessHostedProvider) ? lastUsable.provider as HarnessHostedProvider : null,
        model: lastUsable.model,
      }
    : null
  const ui = row.ui && typeof row.ui === 'object' && !Array.isArray(row.ui) ? row.ui as Record<string, unknown> : {}
  return {
    version: HARNESS_PROFILE_VERSION,
    runtime,
    lastLocalRuntime,
    lastLocalModelByRuntime: boundedRuntimeMap(row.lastLocalModelByRuntime),
    lastHostedModelByProvider: boundedProviderMap(row.lastHostedModelByProvider),
    llamaServerPort: normalizeLlamaServerPort(row.llamaServerPort),
    reasoningByModel: boundedModelMap(row.reasoningByModel),
    hostedConsentByProvider: consent,
    lastUsable: usable,
    mcpServers: parseHarnessMcpServers(row.mcpServers),
    ui: {
      showReasoning: typeof ui.showReasoning === 'boolean' ? ui.showReasoning : fallback.ui.showReasoning,
      compactProcess: typeof ui.compactProcess === 'boolean' ? ui.compactProcess : fallback.ui.compactProcess,
      density: ui.density === 'compact' ? 'compact' : 'comfortable',
    },
  }
}

export type HarnessRuntimeProfilePatch = Partial<Omit<HarnessRuntimeProfileV1, 'version'>>

function profilePath(root: string): string {
  return path.join(path.resolve(root), HARNESS_PROFILE_FILENAME)
}

/** Versioned non-secret preference storage. Raw prompts, responses and secrets
 * are intentionally not representable in this profile type. */
export class HarnessRuntimeProfileStore {
  private readonly file: string
  private current: HarnessRuntimeProfileV1 = defaultHarnessRuntimeProfile()
  private writeChain: Promise<void> = Promise.resolve()

  constructor(root: string) {
    this.file = profilePath(root)
  }

  get path(): string { return this.file }

  async load(): Promise<HarnessRuntimeProfileV1> {
    try {
      this.current = parseHarnessRuntimeProfile(JSON.parse(await readFile(this.file, 'utf8')) as unknown)
    } catch {
      this.current = defaultHarnessRuntimeProfile()
    }
    return structuredClone(this.current)
  }

  read(): HarnessRuntimeProfileV1 { return structuredClone(this.current) }

  async update(patch: HarnessRuntimeProfilePatch): Promise<HarnessRuntimeProfileV1> {
    let result: HarnessRuntimeProfileV1 | undefined
    const operation = this.writeChain.then(async () => {
      const next = parseHarnessRuntimeProfile({ ...this.current, ...patch, version: HARNESS_PROFILE_VERSION })
      this.current = next
      await mkdir(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.file)
      result = structuredClone(next)
    })
    this.writeChain = operation.catch(() => undefined)
    await operation
    return result!
  }

  async setRuntime(runtime: HarnessRuntimeChoice): Promise<HarnessRuntimeProfileV1> {
    return this.update({ runtime, ...(runtime !== 'hosted' ? { lastLocalRuntime: runtime } : {}) })
  }

  async setLocalModel(runtime: HarnessRuntimeId, model: string): Promise<HarnessRuntimeProfileV1> {
    if (!validModel(model)) throw new Error('Harness model is invalid.')
    return this.update({ lastLocalModelByRuntime: { ...this.current.lastLocalModelByRuntime, [runtime]: model }, lastUsable: { runtime, provider: null, model } })
  }

  async setHostedModel(provider: HarnessHostedProvider, model: string): Promise<HarnessRuntimeProfileV1> {
    if (!validModel(model)) throw new Error('Harness model is invalid.')
    return this.update({ lastHostedModelByProvider: { ...this.current.lastHostedModelByProvider, [provider]: model }, lastUsable: { runtime: 'hosted', provider, model } })
  }

  async setReasoning(runtime: HarnessRuntimeChoice, provider: HarnessHostedProvider | null, model: string, effort: HarnessReasoningEffort): Promise<HarnessRuntimeProfileV1> {
    if (!validModel(model) || !EFFORTS.includes(effort)) throw new Error('Harness reasoning preference is invalid.')
    return this.update({ reasoningByModel: { ...this.current.reasoningByModel, [reasoningProfileKey(runtime, provider, model)]: effort } })
  }

  async setPort(port: number): Promise<HarnessRuntimeProfileV1> {
    if (!validLlamaServerPort(port)) throw new Error('llama.cpp port must be between 1 and 65535.')
    return this.update({ llamaServerPort: port })
  }

  async setMcpServers(servers: unknown): Promise<HarnessRuntimeProfileV1> {
    return this.update({ mcpServers: validateHarnessMcpServers(servers) })
  }
}
