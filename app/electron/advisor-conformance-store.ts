import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  AdvisorHostedCapabilityState,
  AdvisorHostedProtocol,
  AdvisorHostedProviderId,
  AdvisorReasoningEffort,
} from './advisor-provider-contract'

/** Increment when the meaning of a hosted conformance check changes. */
export const ADVISOR_RUNTIME_CONTRACT_VERSION = 'harness-runtime-provider-v2'
export const ADVISOR_CONFORMANCE_SCHEMA_VERSION = 1 as const

export type AdvisorConformanceCapabilities = {
  conversational: 'available' | 'unavailable' | 'unknown'
  streaming: 'supported' | 'unsupported' | 'unknown'
  toolCall: AdvisorHostedCapabilityState
  reasoningEfforts: readonly AdvisorReasoningEffort[]
}

export type AdvisorConformanceFingerprintInput = {
  provider: AdvisorHostedProviderId
  model: string
  protocol: AdvisorHostedProtocol
  capabilities: AdvisorConformanceCapabilities
  adapter?: string
  runtimeContractVersion?: string
}

export type AdvisorConformanceRecord = {
  state: 'verified' | 'failed-conformance'
  toolCall: AdvisorHostedCapabilityState
  protocol: AdvisorHostedProtocol
  fingerprint: string
  verifiedAt: string
}

export type AdvisorConformanceEntry = readonly [string, AdvisorConformanceRecord]

export type AdvisorConformanceStore = {
  load: () => Promise<AdvisorConformanceEntry[]>
  save: (entries: readonly AdvisorConformanceEntry[]) => Promise<void>
}

const EFFORTS = new Set<AdvisorReasoningEffort>(['default', 'low', 'medium', 'high', 'max'])
const CAPABILITY_STATES = new Set<AdvisorHostedCapabilityState>(['supported', 'unsupported', 'unknown', 'failed-conformance'])
const PROTOCOLS = new Set<AdvisorHostedProtocol>(['openai-responses', 'openai-chat', 'anthropic-messages', 'gemini-content'])
const MAX_FILE_BYTES = 512 * 1024
const MAX_ENTRIES = 256

function uniqueEfforts(value: readonly AdvisorReasoningEffort[]): AdvisorReasoningEffort[] {
  const efforts = value.filter(effort => EFFORTS.has(effort))
  return Array.from(new Set(efforts.includes('default') ? efforts : ['default', ...efforts]))
}

/**
 * Stable, inspectable identity for the exact adapter/capability contract that
 * was checked. This deliberately excludes credentials and response content.
 */
export function advisorConformanceFingerprint(input: AdvisorConformanceFingerprintInput): string {
  return JSON.stringify({
    provider: input.provider,
    model: input.model,
    adapter: input.adapter ?? 'metrora-hosted-provider-v1',
    protocol: input.protocol,
    capabilities: {
      conversational: input.capabilities.conversational,
      streaming: input.capabilities.streaming,
      toolCall: input.capabilities.toolCall,
      reasoningEfforts: uniqueEfforts(input.capabilities.reasoningEfforts),
    },
    runtimeContractVersion: input.runtimeContractVersion ?? ADVISOR_RUNTIME_CONTRACT_VERSION,
  })
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 64 && Number.isFinite(Date.parse(value))
}

function validRecord(value: unknown): value is AdvisorConformanceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (item.state === 'verified' || item.state === 'failed-conformance')
    && typeof item.toolCall === 'string' && CAPABILITY_STATES.has(item.toolCall as AdvisorHostedCapabilityState)
    && typeof item.protocol === 'string' && PROTOCOLS.has(item.protocol as AdvisorHostedProtocol)
    && typeof item.fingerprint === 'string' && item.fingerprint.length >= 2 && item.fingerprint.length <= 2_000
    && validDate(item.verifiedAt)
}

function safeEntries(value: unknown): AdvisorConformanceEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const item = value as Record<string, unknown>
  if (item.schemaVersion !== ADVISOR_CONFORMANCE_SCHEMA_VERSION) return []
  const records = item.records
  if (!records || typeof records !== 'object' || Array.isArray(records)) return []
  return Object.entries(records)
    .filter(([key, record]) => key.length <= 600 && validRecord(record))
    .slice(0, MAX_ENTRIES)
    .map(([key, record]) => [key, record as AdvisorConformanceRecord] as const)
}

export function createFileAdvisorConformanceStore(filePath: string): AdvisorConformanceStore {
  let pendingWrite = Promise.resolve()
  return {
    async load() {
      try {
        const raw = await readFile(filePath)
        if (raw.byteLength > MAX_FILE_BYTES) return []
        const value: unknown = JSON.parse(raw.toString('utf8'))
        return safeEntries(value)
      } catch {
        return []
      }
    },
    save(entries) {
      const normalized = entries.slice(0, MAX_ENTRIES).filter(([key, record]) => key.length <= 600 && validRecord(record))
      const body = JSON.stringify({ schemaVersion: ADVISOR_CONFORMANCE_SCHEMA_VERSION, records: Object.fromEntries(normalized) })
      pendingWrite = pendingWrite.then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true })
        const temporaryPath = filePath + '.tmp'
        await writeFile(temporaryPath, body, { encoding: 'utf8', mode: 0o600 })
        await rename(temporaryPath, filePath)
      }).catch(() => {})
      return pendingWrite
    },
  }
}

export function createMemoryAdvisorConformanceStore(initial: readonly AdvisorConformanceEntry[] = []): AdvisorConformanceStore {
  let entries = [...initial]
  return {
    async load() { return entries.map(([key, value]) => [key, { ...value }] as const) },
    async save(next) { entries = next.map(([key, value]) => [key, { ...value }] as const) },
  }
}
