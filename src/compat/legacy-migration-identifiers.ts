import type { ApiUsageIteration } from '../types.js'

/**
 * The only reader for identifiers emitted by the retired Metrora surface and
 * by the external Claude Code escalation wire format. This module deliberately
 * has no Harness/runtime imports: it can translate old persisted records, but
 * it cannot make them runtime authority or expose them in product UI.
 */

const LEGACY_TOOL_CONTRACT_VERSION = 'advisor-tool-v1'
const LEGACY_ESCALATION_MESSAGE_TYPE = 'advisor_message'
const LEGACY_ESCALATION_DEDUP_MARKER = ':advisor:'
const LEGACY_ESCALATION_PARSER_VERSION = 'advisor-usage-v1-skills-rich-capture-v1-cross-provider-pr-v1-native-id-reconciliation-v1'

export function legacyExternalEscalationMessageType(): string {
  return LEGACY_ESCALATION_MESSAGE_TYPE
}

export function readLegacyMetroraToolContractVersion(value: unknown): 'metrora-factual-tool-v1' | undefined {
  return value === LEGACY_TOOL_CONTRACT_VERSION ? 'metrora-factual-tool-v1' : undefined
}

export function isLegacyExternalEscalationIteration(value: unknown): value is ApiUsageIteration {
  return !!value
    && typeof value === 'object'
    && (value as { type?: unknown }).type === LEGACY_ESCALATION_MESSAGE_TYPE
}

export function legacyExternalEscalationIterations(value: unknown): ApiUsageIteration[] {
  if (!Array.isArray(value)) return []
  return value.filter(isLegacyExternalEscalationIteration)
}

export function legacyExternalEscalationDeduplicationKey(base: string, ordinal: number): string {
  return `${base}${LEGACY_ESCALATION_DEDUP_MARKER}${ordinal}`
}

export function isLegacyExternalEscalationDeduplicationKey(value: string): boolean {
  return value.includes(LEGACY_ESCALATION_DEDUP_MARKER)
}

export function legacyClaudeParserVersion(): string {
  return LEGACY_ESCALATION_PARSER_VERSION
}
