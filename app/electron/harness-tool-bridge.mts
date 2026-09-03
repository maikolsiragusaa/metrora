import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import type {
  MetroraHarnessToolDefinition,
  MetroraHarnessToolRegistry,
  MetroraHarnessToolResult,
  MetroraHarnessToolSource,
} from './canonical-metrora-tools.mjs'
import type { HarnessScopeInput } from './harness-runtime-types.js'

export type MetroraHarnessToolScope = HarnessScopeInput
export type MetroraHarnessToolName = string
export type { MetroraHarnessToolRegistry, MetroraHarnessToolSource }

function resultText(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { content?: unknown }).content === 'string') {
    return (value as { content: string }).content
  }
  throw new Error('Canonical Metrora Tool registry returned no bounded content.')
}

/**
 * DSH's native ToolDefinition/execute surface is only an adapter over the
 * canonical Metrora registry. Definitions, validation, scope narrowing,
 * evidence, privacy projection and result envelopes all come from the root
 * registry loaded by the host.
 */
export class MetroraToolBridge {
  private readonly source: MetroraHarnessToolSource
  private readonly registry: MetroraHarnessToolRegistry
  private readonly scopes = new Map<string, MetroraHarnessToolScope>()
  private readonly registrations: Array<() => void> = []

  constructor(source: MetroraHarnessToolSource, registry: MetroraHarnessToolRegistry) {
    this.source = source
    this.registry = registry
  }

  setScope(sessionId: string, scope: MetroraHarnessToolScope): void {
    if (!sessionId) throw new Error('Metrora Harness scope requires a session identity.')
    // The canonical registry snapshots and validates the scope at execution.
    // This map is only the explicit Agent/Session association; it is never a
    // substitute scope and has no global default.
    this.scopes.set(sessionId, scope)
  }

  register(ctx: Context): void {
    const tools = ctx.tools
    if (!tools) throw new Error('DSH ToolRuntime is unavailable.')
    this.registrations.push(ctx.on('agent/created', ({ agent }) => {
      const parentSession = agent.session.header.parentSession
      if (parentSession === undefined) return
      const scope = this.scopes.get(String(parentSession))
      if (scope !== undefined) this.scopes.set(String(agent.id), scope)
    }))

    for (const definition of this.registry.definitions) {
      const name = definition.function.name
      const dshDefinition: ToolDefinition = {
        name,
        description: definition.function.description,
        parameters: definition.function.parameters,
        output: {
          // The canonical registry owns the result schema and all semantic
          // validation. DSH only needs a lossless object envelope to carry the
          // adapter result into its native renderer/logging pipeline.
          schema: { type: 'object', additionalProperties: true },
          render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: resultText(value) }],
        },
        isConcurrencySafe: () => name !== 'get_quota_snapshot',
        execute: (args: unknown, execution: ToolRunContext) => this.execute(name, args, execution),
      }
      this.registrations.push(tools.register(dshDefinition))
    }
  }

  dispose(): void {
    while (this.registrations.length) this.registrations.pop()?.()
  }

  /** The explicit scope gate used by every native DSH execution. */
  scopeForAgent(agent: Pick<Agent, 'id'> | undefined): MetroraHarnessToolScope {
    const id = agent?.id ? String(agent.id) : ''
    const scope = this.scopes.get(id)
    if (scope === undefined) throw new Error('Metrora Harness scope is not bound to this Agent/Session.')
    return scope
  }

  /** Testable adapter seam; production DSH calls the same method below. */
  executeForAgent(name: string, value: unknown, agent: Pick<Agent, 'id'> | undefined, signal?: AbortSignal): Promise<MetroraHarnessToolResult> {
    return this.registry.create(this.source, this.scopeForAgent(agent)).execute(name, value, signal)
  }

  private execute(name: string, value: unknown, execution: ToolRunContext): Promise<MetroraHarnessToolResult> {
    return this.executeForAgent(name, value, execution.agent, execution.signal)
  }
}

export function metroraToolNames(registry: MetroraHarnessToolRegistry): readonly string[] {
  return registry.definitions.map(definition => definition.function.name)
}

/** Contract-shaped projection used by conformance diagnostics and tests. */
export function metroraToolDefinitions(registry: MetroraHarnessToolRegistry): ReadonlyArray<MetroraHarnessToolDefinition> {
  return registry.definitions.map(definition => ({
    type: definition.type,
    function: {
      name: definition.function.name,
      description: definition.function.description,
      parameters: definition.function.parameters,
    },
  }))
}
