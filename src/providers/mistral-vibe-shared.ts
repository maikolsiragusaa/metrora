import { stat } from 'fs/promises'
import { basename, dirname } from 'path'

import { readSessionFile } from '../fs-utils.js'

export const METADATA_FILENAME = 'meta.json'
export const MESSAGES_FILENAME = 'messages.jsonl'
/** Vibe's unified session store, written by current Vibe releases and Vibe Desktop. */
export const UNIFIED_DIRNAME = 'unified'
export const JOURNAL_DIRNAME = 'journal'
export const JOURNAL_EXTENSION = '.jsonl'
export const DEFAULT_MODEL = 'mistral-medium-3.5'

export const toolNameMap: Record<string, string> = {
  bash: 'Bash',
  read_file: 'Read',
  write_file: 'Write',
  search_replace: 'Edit',
  grep: 'Grep',
  task: 'Agent',
  todo: 'TodoWrite',
  skill: 'Skill',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  ask_user_question: 'AskUser',
  exit_plan_mode: 'ExitPlanMode',
}

export type VibeStats = {
  session_prompt_tokens?: number
  session_completion_tokens?: number
  session_cost?: number
  input_price_per_million?: number
  output_price_per_million?: number
  tokens_per_second?: number
}

export type VibeModelConfig = {
  name?: string
  alias?: string
  provider?: string
  input_price?: number
  output_price?: number
}

export type VibeMetadata = {
  session_id?: string
  start_time?: string
  end_time?: string | null
  environment?: {
    working_directory?: string | null
  }
  stats?: VibeStats
  config?: {
    active_model?: string
    model_name?: string
    models?: VibeModelConfig[]
  }
  title?: string | null
}

export type VibeToolCall = {
  function?: {
    name?: string
    arguments?: string | Record<string, unknown> | null
  }
}

export type VibeMessage = {
  role?: string
  content?: unknown
  message_id?: string
  timestamp?: string
  tool_calls?: VibeToolCall[] | null
}

export type VibeUnifiedUsage = {
  input_tokens?: number
  output_tokens?: number
  cached_input_tokens?: number
  cache_write_tokens?: number
  reasoning_tokens?: number
  total_tokens?: number
}

export type VibeUnifiedCompletionPart = {
  type?: string
  name?: string
  arguments_json?: string | Record<string, unknown> | null
}

export type VibeUnifiedCompletion = {
  finish_reason?: string
  parts?: VibeUnifiedCompletionPart[]
  usage?: VibeUnifiedUsage
}

export type VibeTurnEntry = {
  role?: string
  content?: unknown
}

export type VibeJournalRecord = {
  type?: string
  sequence?: number
  payload?: {
    action_id?: string
    method?: string
    params?: { entries?: VibeTurnEntry[] }
    type?: string
    result?: {
      type?: string
      result?: VibeUnifiedCompletion
    }
  }
}

export async function isFile(path: string): Promise<boolean> {
  const s = await stat(path).catch(() => null)
  return Boolean(s?.isFile())
}

export async function isDirectory(path: string): Promise<boolean> {
  const s = await stat(path).catch(() => null)
  return Boolean(s?.isDirectory())
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  const raw = await readSessionFile(path)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as T : null
  } catch {
    return null
  }
}

export function activeModelConfig(metadata: VibeMetadata): VibeModelConfig | null {
  const activeModel = metadata.config?.active_model
  const models = metadata.config?.models
  if (!activeModel || !Array.isArray(models)) return null
  return models.find(m => m.alias === activeModel || m.name === activeModel) ?? null
}

export function resolveModel(metadata: VibeMetadata): string {
  const activeModel = metadata.config?.active_model
  if (activeModel) return activeModel
  const configured = activeModelConfig(metadata)
  return configured?.alias ?? configured?.name ?? DEFAULT_MODEL
}

/**
 * The unified store records one active model per session, not one per call, so
 * calls inherit the session model exactly like the legacy meta.json path.
 * Vibe's concrete model slug is preferred over the UI alias because pricing
 * lookup keys on the slug.
 */
export function resolveUnifiedModel(metadata: VibeMetadata): string {
  const modelName = metadata.config?.model_name?.trim()
  if (modelName) return modelName
  const activeModel = metadata.config?.active_model?.trim()
  return activeModel || DEFAULT_MODEL
}

export function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text
        return ''
      })
      .filter(Boolean)
      .join(' ')
  }
  return ''
}

export function parseToolArguments(raw: string | Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/**
 * A unified journal segment lives at
 * <session-root>/unified/<session-id>/journal/<sequence>.jsonl, so the segment
 * directory's parent is the session id and its grandparent is `unified`.
 */
export function isUnifiedJournalSource(path: string): boolean {
  if (!path.endsWith(JOURNAL_EXTENSION)) return false
  const journalDir = dirname(path)
  if (basename(journalDir) !== JOURNAL_DIRNAME) return false
  // <unified>/<session>/journal/<segment>.jsonl -> dirname(dirname(dirname(file))) = <unified>
  return basename(dirname(unifiedSessionDir(path))) === UNIFIED_DIRNAME
}

/** <session-root>/unified/<session-id>/ for a segment inside that session. */
export function unifiedSessionDir(journalPath: string): string {
  return dirname(dirname(journalPath))
}

/**
 * The unified store records no per-call timestamp: journal records carry only a
 * sequence and integrity hashes. The rotating segment file is the finest
 * durable time signal available, so its mtime dates the calls in that segment
 * instead of collapsing a multi-day session onto its final metadata timestamp.
 */
export async function journalSegmentTimestamp(journalPath: string, fallback: string): Promise<string> {
  const stats = await stat(journalPath).catch(() => null)
  const mtime = stats?.mtime
  if (mtime instanceof Date && !Number.isNaN(mtime.getTime())) return mtime.toISOString()
  return fallback
}
