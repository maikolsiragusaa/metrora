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
import type { HarnessMode, HarnessScopeInput } from './harness-runtime-types.js'

export type MetroraHarnessToolScope = HarnessScopeInput
export type MetroraHarnessToolName = string
export type { MetroraHarnessToolRegistry, MetroraHarnessToolSource }

type Binding = { scope: MetroraHarnessToolScope; workspaceRoot: string | null; mode: HarnessMode }

function resultText(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { content?: unknown }).content === 'string') return (value as { content: string }).content
  throw new Error('Canonical Metrora Tool registry returned no bounded content.')
}

/** Direct first-party Tool registration. It intentionally does not use MCP:
 * canonical schemas, scope, authority, freshness and evidence remain owned by
 * the root Metrora registry while DSH supplies normal Tool lifecycle events. */
export class MetroraToolBridge {
  private readonly source: MetroraHarnessToolSource
  private readonly registry: MetroraHarnessToolRegistry
  private readonly bindings = new Map<string, Binding>()
  private readonly registrations: Array<() => void> = []

  constructor(source: MetroraHarnessToolSource, registry: MetroraHarnessToolRegistry) { this.source = source; this.registry = registry }

  setScope(sessionId: string, scope: MetroraHarnessToolScope): void { this.setContext(sessionId, scope, null, 'ask') }
  setContext(sessionId: string, scope: MetroraHarnessToolScope, workspaceRoot: string | null, mode: HarnessMode): void {
    if (!sessionId) throw new Error('Metrora Harness scope requires a Session identity.')
    this.bindings.set(sessionId, { scope, workspaceRoot, mode })
  }
  contextForAgent(agent: Pick<Agent, 'id'> | undefined): Binding {
    const id = agent?.id ? String(agent.id) : ''
    const value = this.bindings.get(id)
    if (!value) throw new Error('Metrora Harness scope is not bound to this Agent/Session.')
    return value
  }
  scopeForAgent(agent: Pick<Agent, 'id'> | undefined): MetroraHarnessToolScope { return this.contextForAgent(agent).scope }

  register(ctx: Context): void {
    const tools = ctx.tools
    if (!tools) throw new Error('DSH ToolRuntime is unavailable.')
    this.registrations.push(ctx.on('agent/created', ({ agent }) => {
      const parent = agent.session.header.parentSession
      if (parent === undefined) return
      const binding = this.bindings.get(String(parent))
      if (binding) this.bindings.set(String(agent.id), binding)
    }))
    for (const definition of this.registry.definitions) {
      const name = definition.function.name
      const dshDefinition: ToolDefinition = {
        name,
        description: definition.function.description,
        parameters: definition.function.parameters,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: resultText(value) }],
        },
        isConcurrencySafe: () => name !== 'get_quota_snapshot',
        execute: (args: unknown, execution: ToolRunContext) => this.execute(name, args, execution),
      }
      this.registrations.push(tools.register(dshDefinition))
    }
  }
  dispose(): void { while (this.registrations.length) this.registrations.pop()?.(); this.bindings.clear() }
  executeForAgent(name: string, value: unknown, agent: Pick<Agent, 'id'> | undefined, signal?: AbortSignal): Promise<MetroraHarnessToolResult> {
    return this.registry.create(this.source, this.scopeForAgent(agent)).execute(name, value, signal)
  }
  private execute(name: string, value: unknown, execution: ToolRunContext): Promise<MetroraHarnessToolResult> { return this.executeForAgent(name, value, execution.agent, execution.signal) }
}

export function metroraToolNames(registry: MetroraHarnessToolRegistry): readonly string[] { return registry.definitions.map(definition => definition.function.name) }
export function metroraToolDefinitions(registry: MetroraHarnessToolRegistry): ReadonlyArray<MetroraHarnessToolDefinition> {
  return registry.definitions.map(definition => ({ type: definition.type, function: { name: definition.function.name, description: definition.function.description, parameters: definition.function.parameters } }))
}
