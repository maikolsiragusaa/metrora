import type { ToolCall } from './types.js'
import type { ParsedProviderCall } from './providers/types.js'

/**
 * Materialize a string without changing its JavaScript UTF-16 contents.
 *
 * A bounded slice of a large source string can keep that source's backing
 * storage alive in V8. structuredClone creates an independent string while
 * preserving lone-surrogate code units; a UTF-8 round-trip does not.
 */
export function flattenString(value: string): string {
  return structuredClone(value)
}

/** Take an exact JS-string prefix, then detach it from the source string. */
export function flattenStringPrefix(value: string, limit: number): string {
  return flattenString(value.slice(0, limit))
}

export function flattenStringArray(values: readonly string[]): string[] {
  return values.map(flattenString)
}

export function flattenToolSequence(
  sequence: readonly (readonly ToolCall[])[] | undefined,
): ToolCall[][] | undefined {
  if (sequence === undefined) return undefined
  return sequence.map(calls => calls.map(call => ({
    tool: flattenString(call.tool),
    ...(call.file !== undefined ? { file: flattenString(call.file) } : {}),
    ...(call.command !== undefined ? { command: flattenString(call.command) } : {}),
  })))
}

/**
 * Detach the string-bearing fields at a provider-local result-cache boundary.
 * Serialized values remain identical; only V8's backing-storage relationship
 * is changed.
 */
export function flattenParsedProviderCall(call: ParsedProviderCall): ParsedProviderCall {
  return {
    ...call,
    provider: flattenString(call.provider),
    model: flattenString(call.model),
    ...(call.modelProvider ? { modelProvider: flattenString(call.modelProvider) } : {}),
    ...(call.pricingContext ? { pricingContext: structuredClone(call.pricingContext) } : {}),
    timestamp: flattenString(call.timestamp),
    deduplicationKey: flattenString(call.deduplicationKey),
    sessionId: flattenString(call.sessionId),
    ...(call.project !== undefined ? { project: flattenString(call.project) } : {}),
    ...(call.projectPath !== undefined ? { projectPath: flattenString(call.projectPath) } : {}),
    ...(call.workingDirectory !== undefined ? { workingDirectory: flattenString(call.workingDirectory) } : {}),
    userMessage: flattenString(call.userMessage),
    tools: flattenStringArray(call.tools),
    bashCommands: flattenStringArray(call.bashCommands),
    ...(call.skills ? { skills: flattenStringArray(call.skills) } : {}),
    ...(call.subagentTypes ? { subagentTypes: flattenStringArray(call.subagentTypes) } : {}),
    ...(call.toolSequence ? { toolSequence: flattenToolSequence(call.toolSequence) } : {}),
  }
}

export function flattenParsedProviderCalls(calls: readonly ParsedProviderCall[]): ParsedProviderCall[] {
  return calls.map(flattenParsedProviderCall)
}
