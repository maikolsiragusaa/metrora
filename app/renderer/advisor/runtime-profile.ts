import { readStorage, storageKey, writeStorage } from '../lib/storage'
import type { AdvisorHostedProviderId, AdvisorLocalRuntimeId, AdvisorReasoningEffort } from './types'

export const HARNESS_RUNTIME_PROFILE_STORAGE_SUFFIX = 'harness.runtime-profile.v1'
export const HARNESS_RUNTIME_PROFILE_STORAGE_KEY = storageKey(HARNESS_RUNTIME_PROFILE_STORAGE_SUFFIX)

export type HarnessRuntimeChoice = AdvisorLocalRuntimeId | 'hosted'

export type HarnessRuntimeProfile = {
  schemaVersion: 1
  runtimeChoice: HarnessRuntimeChoice
  localRuntime: AdvisorLocalRuntimeId
  hostedProvider: AdvisorHostedProviderId
  hostedModels: Partial<Record<AdvisorHostedProviderId, string>>
  localModels: Partial<Record<AdvisorLocalRuntimeId, string>>
  llamaServerPort: number
  reasoningEfforts: Record<string, AdvisorReasoningEffort>
  hostedConsent: Record<string, boolean>
}

type StorageSurface = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const PROVIDERS = new Set<AdvisorHostedProviderId>(['openai', 'anthropic', 'gemini', 'openrouter', 'opencode-zen'])
const LOCAL_RUNTIMES = new Set<AdvisorLocalRuntimeId>(['ollama', 'lmstudio', 'llama-server'])
const REASONING_EFFORTS = new Set<AdvisorReasoningEffort>(['default', 'low', 'medium', 'high', 'max'])
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u
const DEFAULT_PORT = 8080

function defaultProfile(): HarnessRuntimeProfile {
  return {
    schemaVersion: 1,
    runtimeChoice: 'ollama',
    localRuntime: 'ollama',
    hostedProvider: 'openai',
    hostedModels: {},
    localModels: {},
    llamaServerPort: DEFAULT_PORT,
    reasoningEfforts: {},
    hostedConsent: {},
  }
}

function validModel(value: unknown): value is string { return typeof value === 'string' && MODEL_PATTERN.test(value) }
function validPort(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 65_535 }
function validProvider(value: unknown): value is AdvisorHostedProviderId { return typeof value === 'string' && PROVIDERS.has(value as AdvisorHostedProviderId) }
function validLocalRuntime(value: unknown): value is AdvisorLocalRuntimeId { return typeof value === 'string' && LOCAL_RUNTIMES.has(value as AdvisorLocalRuntimeId) }
function validRuntimeChoice(value: unknown): value is HarnessRuntimeChoice { return value === 'hosted' || validLocalRuntime(value) }

function modelMap(value: unknown, allowed: ReadonlySet<string>): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([key, model]) => allowed.has(key) && validModel(model))
    .slice(0, 8))
}

function reasoningMap(value: unknown): Record<string, AdvisorReasoningEffort> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([key, effort]) => /^[A-Za-z][A-Za-z0-9:_./-]{0,220}$/u.test(key) && typeof effort === 'string' && REASONING_EFFORTS.has(effort as AdvisorReasoningEffort))
    .slice(0, 32)) as Record<string, AdvisorReasoningEffort>
}

function consentMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([key, consent]) => /^[a-z][a-z0-9-]{0,32}:[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u.test(key) && typeof consent === 'boolean')
    .slice(0, 32))
}

export function hostedConsentKey(provider: AdvisorHostedProviderId, model: string): string {
  return provider + ':' + model
}

export function runtimeReasoningKey(runtime: HarnessRuntimeChoice, provider: AdvisorHostedProviderId, hostedModel: string | null, localRuntime: AdvisorLocalRuntimeId, localModel: string | null): string {
  return runtime === 'hosted'
    ? 'hosted:' + provider + ':' + (hostedModel ?? 'default')
    : 'local:' + localRuntime + ':' + (localModel ?? 'default')
}

export function loadHarnessRuntimeProfile(storage?: StorageSurface): HarnessRuntimeProfile {
  const fallback = defaultProfile()
  let raw: string | null = null
  try {
    raw = readStorage(HARNESS_RUNTIME_PROFILE_STORAGE_SUFFIX, storage)
  } catch { return fallback }
  if (!raw) {
    try {
      const legacyPort = Number(readStorage('llama-server.port', storage))
      if (validPort(legacyPort)) fallback.llamaServerPort = legacyPort
    } catch { /* use the default */ }
    return fallback
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
    const item = value as Record<string, unknown>
    if (item.schemaVersion !== 1) return fallback
    return {
      schemaVersion: 1,
      runtimeChoice: validRuntimeChoice(item.runtimeChoice) ? item.runtimeChoice : fallback.runtimeChoice,
      localRuntime: validLocalRuntime(item.localRuntime) ? item.localRuntime : fallback.localRuntime,
      hostedProvider: validProvider(item.hostedProvider) ? item.hostedProvider : fallback.hostedProvider,
      hostedModels: modelMap(item.hostedModels, PROVIDERS),
      localModels: modelMap(item.localModels, LOCAL_RUNTIMES),
      llamaServerPort: validPort(item.llamaServerPort) ? item.llamaServerPort : fallback.llamaServerPort,
      reasoningEfforts: reasoningMap(item.reasoningEfforts),
      hostedConsent: consentMap(item.hostedConsent),
    }
  } catch { return fallback }
}

export function saveHarnessRuntimeProfile(profile: HarnessRuntimeProfile, storage?: StorageSurface): void {
  const sanitized: HarnessRuntimeProfile = {
    schemaVersion: 1,
    runtimeChoice: validRuntimeChoice(profile.runtimeChoice) ? profile.runtimeChoice : 'ollama',
    localRuntime: validLocalRuntime(profile.localRuntime) ? profile.localRuntime : 'ollama',
    hostedProvider: validProvider(profile.hostedProvider) ? profile.hostedProvider : 'openai',
    hostedModels: modelMap(profile.hostedModels, PROVIDERS),
    localModels: modelMap(profile.localModels, LOCAL_RUNTIMES),
    llamaServerPort: validPort(profile.llamaServerPort) ? profile.llamaServerPort : DEFAULT_PORT,
    reasoningEfforts: reasoningMap(profile.reasoningEfforts),
    hostedConsent: consentMap(profile.hostedConsent),
  }
  try { writeStorage(HARNESS_RUNTIME_PROFILE_STORAGE_SUFFIX, JSON.stringify(sanitized), storage) } catch { /* restricted renderer storage is non-fatal */ }
}
