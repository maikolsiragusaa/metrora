import { pathToFileURL } from 'node:url'

import type { HarnessScopeInput } from './harness-runtime-types.js'

export type MetroraHarnessToolSource = {
  getOverview(scope: HarnessScopeInput, signal?: AbortSignal): Promise<unknown>
  getModels(scope: HarnessScopeInput, signal?: AbortSignal): Promise<unknown>
  getQuota(signal?: AbortSignal): Promise<unknown>
  getBenchEvidence?(scope: HarnessScopeInput, signal?: AbortSignal): Promise<unknown>
}

export type MetroraHarnessToolDefinition = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type MetroraHarnessToolEnvelope = {
  authority: 'metrora-canonical' | 'provider-reported' | 'mixed' | 'unknown'
  semantics: ReadonlyArray<{ source: string; authority: string; status: string }>
  unavailable: boolean
  scope: HarnessScopeInput
}

export type MetroraHarnessToolResult = {
  content: string
  evidence: unknown
  envelope?: MetroraHarnessToolEnvelope
}

export type MetroraHarnessToolRegistry = {
  definitions: readonly MetroraHarnessToolDefinition[]
  create(source: MetroraHarnessToolSource, scope: HarnessScopeInput): {
    execute(name: string, args: unknown, signal?: AbortSignal): Promise<MetroraHarnessToolResult>
  }
}

type CanonicalToolsModule = {
  METRORA_TOOL_DEFINITIONS: readonly MetroraHarnessToolDefinition[]
  createMetroraToolRegistry: (source: unknown, scope: unknown) => unknown
}

/**
 * Load the root-built canonical registry that is shared by every Metrora
 * transport. Electron's TypeScript project intentionally does not compile the
 * repository root into its main-process output; the root build entry is copied
 * into the staged CLI closure and is loaded from the exact dev/packaged path.
 */
export async function loadMetroraHarnessToolRegistry(modulePath: string): Promise<MetroraHarnessToolRegistry> {
  const module = await import(pathToFileURL(modulePath).href) as unknown as CanonicalToolsModule
  if (!Array.isArray(module.METRORA_TOOL_DEFINITIONS) || typeof module.createMetroraToolRegistry !== 'function') {
    throw new Error('Canonical Metrora Tool registry is unavailable.')
  }
  return {
    definitions: module.METRORA_TOOL_DEFINITIONS,
    create: module.createMetroraToolRegistry as unknown as MetroraHarnessToolRegistry['create'],
  }
}
