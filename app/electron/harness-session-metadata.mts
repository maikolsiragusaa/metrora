import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  HarnessHostedProvider,
  HarnessModelConformance,
  HarnessMode,
  HarnessReasoningEffort,
  HarnessRuntimeChoice,
  HarnessWorkspace,
} from './harness-runtime-types.js'
import { isHarnessReasoningEffort } from './harness-runtime-types.js'

export const HARNESS_SESSION_METADATA_VERSION = 1 as const

export type HarnessSessionMetadata = {
  version: 1
  title: string
  runtime: HarnessRuntimeChoice
  provider: HarnessHostedProvider | null
  model: string
  mode: HarnessMode
  reasoningEffort: HarnessReasoningEffort | null
  workspace: HarnessWorkspace | null
  createdAt: string
  updatedAt: string
  conformance: HarnessModelConformance
}

type MetadataFile = { version: 1; sessions: Record<string, HarnessSessionMetadata> }

const RUNTIMES: readonly HarnessRuntimeChoice[] = ['ollama', 'lmstudio', 'llama-server', 'hosted']
const PROVIDERS: readonly HarnessHostedProvider[] = ['openai', 'anthropic', 'gemini', 'openrouter', 'opencode-zen']
const MODES: readonly HarnessMode[] = ['ask', 'plan', 'edit', 'build']
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const MAX_SESSIONS = 512

function defaultConformance(): HarnessModelConformance {
  return { state: 'unavailable', fingerprint: null, toolCalling: 'unknown', reasoning: 'unknown', checkedAt: null, detail: 'Run exact-model conformance before treating this route as verified.' }
}

function parseConformance(value: unknown): HarnessModelConformance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultConformance()
  const row = value as Record<string, unknown>
  const states = ['discovered', 'checking', 'verified', 'limited', 'failed-conformance', 'unavailable'] as const
  const toolCalling = ['verified', 'unsupported', 'unknown'] as const
  const reasoning = ['verified', 'supported', 'unsupported', 'unknown'] as const
  return {
    state: states.includes(row.state as typeof states[number]) ? row.state as typeof states[number] : 'unavailable',
    fingerprint: typeof row.fingerprint === 'string' && row.fingerprint.length <= 256 ? row.fingerprint : null,
    toolCalling: toolCalling.includes(row.toolCalling as typeof toolCalling[number]) ? row.toolCalling as typeof toolCalling[number] : 'unknown',
    reasoning: reasoning.includes(row.reasoning as typeof reasoning[number]) ? row.reasoning as typeof reasoning[number] : 'unknown',
    checkedAt: row.checkedAt === null ? null : validDate(row.checkedAt, '') || null,
    detail: typeof row.detail === 'string' && row.detail.length <= 512 ? row.detail : null,
  }
}

function validModel(value: unknown): value is string { return typeof value === 'string' && MODEL_PATTERN.test(value) }
function validId(value: string): boolean { return ID_PATTERN.test(value) }
function validDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback
}

function emptyFile(): MetadataFile { return { version: HARNESS_SESSION_METADATA_VERSION, sessions: {} } }

function parseWorkspace(value: unknown): HarnessWorkspace | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !/^workspace-[a-f0-9]{16}$/u.test(row.id) || row.relativeRoot !== '.' || typeof row.displayName !== 'string' || row.displayName.length > 256) return null
  return { id: row.id, displayName: row.displayName, relativeRoot: '.', available: row.available === true }
}

function parseEntry(id: string, value: unknown): HarnessSessionMetadata | null {
  if (!validId(id) || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!RUNTIMES.includes(row.runtime as HarnessRuntimeChoice) || !validModel(row.model)) return null
  const now = new Date(0).toISOString()
  return {
    version: 1,
    title: typeof row.title === 'string' && row.title.trim() ? row.title.slice(0, 120) : 'New chat',
    runtime: row.runtime as HarnessRuntimeChoice,
    provider: PROVIDERS.includes(row.provider as HarnessHostedProvider) ? row.provider as HarnessHostedProvider : null,
    model: row.model,
    mode: MODES.includes(row.mode as HarnessMode) ? row.mode as HarnessMode : 'ask',
    reasoningEffort: isHarnessReasoningEffort(row.reasoningEffort) ? row.reasoningEffort : null,
    workspace: parseWorkspace(row.workspace),
    createdAt: validDate(row.createdAt, now),
    updatedAt: validDate(row.updatedAt, now),
    conformance: parseConformance(row.conformance),
  }
}

function parseFile(value: unknown): MetadataFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyFile()
  const row = value as Record<string, unknown>
  if (row.version !== 1 || !row.sessions || typeof row.sessions !== 'object' || Array.isArray(row.sessions)) return emptyFile()
  const sessions: Record<string, HarnessSessionMetadata> = {}
  for (const [id, entry] of Object.entries(row.sessions)) {
    if (Object.keys(sessions).length >= MAX_SESSIONS) break
    const parsed = parseEntry(id, entry)
    if (parsed) sessions[id] = parsed
  }
  return { version: 1, sessions }
}

/** Durable, bounded Session presentation metadata. Conversation content stays
 * exclusively in the DSH Session JSONL log. */
export class HarnessSessionMetadataStore {
  private readonly file: string
  private current: MetadataFile = emptyFile()
  private writeChain: Promise<void> = Promise.resolve()

  constructor(root: string) { this.file = path.join(path.resolve(root), 'session-metadata.json') }
  get path(): string { return this.file }

  async load(): Promise<void> {
    try { this.current = parseFile(JSON.parse(await readFile(this.file, 'utf8')) as unknown) }
    catch { this.current = emptyFile() }
  }

  get(id: string): HarnessSessionMetadata | null { return this.current.sessions[id] ? structuredClone(this.current.sessions[id]) : null }
  list(): Array<{ id: string; metadata: HarnessSessionMetadata }> {
    return Object.entries(this.current.sessions).map(([id, metadata]) => ({ id, metadata: structuredClone(metadata) }))
  }

  async set(id: string, patch: Partial<Omit<HarnessSessionMetadata, 'version'>> & Pick<HarnessSessionMetadata, 'runtime' | 'model'>): Promise<HarnessSessionMetadata> {
    if (!validId(id) || !RUNTIMES.includes(patch.runtime) || !validModel(patch.model)) throw new Error('Harness Session metadata is invalid.')
    let result: HarnessSessionMetadata | undefined
    const operation = this.writeChain.then(async () => {
      const previous = this.current.sessions[id]
      const now = new Date().toISOString()
      const next: HarnessSessionMetadata = {
        version: 1,
        title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.slice(0, 120) : previous?.title ?? 'New chat',
        runtime: patch.runtime,
        provider: PROVIDERS.includes(patch.provider as HarnessHostedProvider) ? patch.provider as HarnessHostedProvider : patch.provider === null ? null : previous?.provider ?? null,
        model: patch.model,
        mode: MODES.includes(patch.mode as HarnessMode) ? patch.mode as HarnessMode : previous?.mode ?? 'ask',
        reasoningEffort: isHarnessReasoningEffort(patch.reasoningEffort) ? patch.reasoningEffort : patch.reasoningEffort === null ? null : previous?.reasoningEffort ?? null,
        workspace: patch.workspace === undefined ? previous?.workspace ?? null : patch.workspace,
        createdAt: previous?.createdAt ?? patch.createdAt ?? now,
        updatedAt: patch.updatedAt ?? now,
        conformance: patch.conformance ?? previous?.conformance ?? defaultConformance(),
      }
      this.current.sessions[id] = next
      const ids = Object.keys(this.current.sessions)
      if (ids.length > MAX_SESSIONS) delete this.current.sessions[ids[0] as string]
      await this.save()
      result = structuredClone(next)
    })
    this.writeChain = operation.catch(() => undefined)
    await operation
    return result!
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(this.current, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.file)
  }
}
