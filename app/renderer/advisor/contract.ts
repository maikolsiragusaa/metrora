/**
 * Compatibility adapter for the original Advisor imports.
 *
 * Factual tool validation and envelope construction live in src/tools. This
 * file keeps stable Advisor identifiers for existing renderer callers while
 * preventing a second registry/contract implementation from emerging.
 */
import {
  MetroraToolContractError,
  METRORA_TOOL_ARGUMENT_MAX_BYTES,
  METRORA_TOOL_CONTRACT,
  METRORA_TOOL_CONTRACT_VERSION,
  METRORA_TOOL_DEFINITIONS,
  METRORA_TOOL_MODEL_FILTER_MAX_LENGTH,
  METRORA_TOOL_OUTPUT_MAX_BYTES,
  METRORA_TOOL_SCHEMA_VERSION,
  assertMetroraToolName,
  assertStrictBoundedMetroraToolContent,
  boundedMetroraToolJson,
  createMetroraToolResultEnvelope,
  normalizeMetroraToolCall,
  parseMetroraToolArguments,
  snapshotMetroraToolScope,
  validateMetroraToolArguments,
} from '../../../src/tools/contract'
import { contentMinimalMetroraToolEvidence } from '../../../src/tools/privacy'
import { contentMinimalMetroraToolScope } from '../../../src/tools/privacy'
import type {
  AdvisorEvidence,
  AdvisorJsonObject,
  AdvisorScope,
  AdvisorToolContract,
  AdvisorToolDefinition,
  AdvisorToolName,
  AdvisorToolResultEnvelope,
} from './types'

export const ADVISOR_TOOL_CONTRACT_VERSION = METRORA_TOOL_CONTRACT_VERSION
export const ADVISOR_TOOL_SCHEMA_VERSION = METRORA_TOOL_SCHEMA_VERSION
export const ADVISOR_TOOL_ARGUMENT_MAX_BYTES = METRORA_TOOL_ARGUMENT_MAX_BYTES
export const ADVISOR_TOOL_OUTPUT_MAX_BYTES = METRORA_TOOL_OUTPUT_MAX_BYTES
export const ADVISOR_TOOL_MODEL_FILTER_MAX_LENGTH = METRORA_TOOL_MODEL_FILTER_MAX_LENGTH
export const ADVISOR_TOOL_CONTRACT = METRORA_TOOL_CONTRACT as unknown as AdvisorToolContract
export const ADVISOR_TOOL_DEFINITIONS = METRORA_TOOL_DEFINITIONS as unknown as readonly AdvisorToolDefinition[]
export { MetroraToolContractError as AdvisorToolContractError }

export function boundedAdvisorJson(value: unknown, maxBytes = ADVISOR_TOOL_OUTPUT_MAX_BYTES): string {
  return boundedMetroraToolJson(value, maxBytes)
}
export function parseAdvisorToolArguments(value: unknown): Record<string, unknown> {
  return parseMetroraToolArguments(value)
}
export function validateAdvisorToolArguments(name: unknown, value: unknown): AdvisorJsonObject {
  return validateMetroraToolArguments(name, value) as unknown as AdvisorJsonObject
}
export function normalizeAdvisorToolCall(name: unknown, value: unknown): { name: AdvisorToolName; arguments: AdvisorJsonObject } {
  const normalized = normalizeMetroraToolCall(name, value)
  return { name: normalized.name as AdvisorToolName, arguments: normalized.arguments as unknown as AdvisorJsonObject }
}
export function normalizeAdvisorRuntimeToolCall(name: unknown, value: unknown, suppliedDefinitions: readonly AdvisorToolDefinition[] = []): { name: AdvisorToolName; arguments: AdvisorJsonObject } {
  const tool = assertMetroraToolName(name)
  const definition = suppliedDefinitions.find(item => item.function.name === tool)
  if (definition?.function.parameters && (definition.function.parameters as { additionalProperties?: unknown }).additionalProperties === false) return normalizeAdvisorToolCall(tool, value)
  const args = parseAdvisorToolArguments(value)
  const normalized: AdvisorJsonObject = {}
  for (const key of Object.keys(args)) {
    if (!['model', 'period', 'provider'].includes(key)) throw new MetroraToolContractError('additional-argument', 'Additional Metrora tool argument is not allowed: ' + key)
    const validated = validateAdvisorToolArguments(tool, { [key]: args[key] })
    normalized[key] = validated[key]
  }
  return { name: tool as AdvisorToolName, arguments: normalized }
}
export function assertBoundedAdvisorToolContent(value: unknown): string {
  return assertStrictBoundedMetroraToolContent(value)
}
export function assertStrictBoundedAdvisorToolContent(value: unknown): string {
  return assertStrictBoundedMetroraToolContent(value)
}
export function snapshotAdvisorScope(scope: AdvisorScope): AdvisorScope {
  return snapshotMetroraToolScope(scope as unknown as import('../../../src/tools/types').MetroraToolScope) as unknown as AdvisorScope
}
export function createAdvisorToolResultEnvelope(name: AdvisorToolName, scope: AdvisorScope, args: AdvisorJsonObject, evidence: AdvisorEvidence, output: AdvisorJsonObject): AdvisorToolResultEnvelope {
  return createMetroraToolResultEnvelope(
    name as unknown as import('../../../src/tools/types').MetroraToolName,
    scope as unknown as import('../../../src/tools/types').MetroraToolScope,
    args as unknown as import('../../../src/tools/types').MetroraToolJsonObject,
    evidence as unknown as import('../../../src/tools/types').MetroraToolEvidence,
    output as unknown as import('../../../src/tools/types').MetroraToolJsonObject,
  ) as unknown as AdvisorToolResultEnvelope
}
export function createContentMinimalAdvisorToolResultEnvelope(name: AdvisorToolName, scope: AdvisorScope, args: AdvisorJsonObject, evidence: AdvisorEvidence, output: AdvisorJsonObject): AdvisorToolResultEnvelope {
  return createAdvisorToolResultEnvelope(name, scope, args, evidence, output)
}
export function contentMinimalAdvisorEvidence(evidence: AdvisorEvidence): AdvisorJsonObject {
  return contentMinimalMetroraToolEvidence(evidence as unknown as import('../../../src/tools/types').MetroraToolEvidence) as unknown as AdvisorJsonObject
}
export function contentMinimalAdvisorScope(scope: AdvisorScope): AdvisorScope {
  return contentMinimalMetroraToolScope(scope as unknown as import('../../../src/tools/types').MetroraToolScope) as unknown as AdvisorScope
}
