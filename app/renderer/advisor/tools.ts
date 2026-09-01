/**
 * Legacy Advisor import boundary.
 *
 * The factual registry is owned by src/tools. Keeping this adapter lets the
 * existing investigation kernel and older integrations migrate incrementally
 * without creating a second implementation.
 */
import { createMetroraToolRegistry } from '../../../src/tools/registry'
import type { MetroraToolDataSource, MetroraToolScope } from '../../../src/tools/types'
import type { MenubarPayload } from '../lib/types'
import type {
  AdvisorDataSource,
  AdvisorScope,
  AdvisorToolContract,
  AdvisorToolDefinition,
  AdvisorToolExecution,
  AdvisorToolExecutor,
  AdvisorPeriodFilter,
} from './types'
import { ADVISOR_TOOL_CONTRACT, ADVISOR_TOOL_DEFINITIONS } from './contract'

export { ADVISOR_TOOL_CONTRACT, ADVISOR_TOOL_DEFINITIONS }

export type AdvisorToolRegistry = {
  contract: AdvisorToolContract
  definitions: readonly AdvisorToolDefinition[]
  scope: AdvisorScope
  execute: AdvisorToolExecutor
}

export function createAdvisorToolRegistry(source: AdvisorDataSource, scope: AdvisorScope, suppliedOverview: MenubarPayload | null, options: { allowedPeriods?: readonly AdvisorPeriodFilter[] } = {}): AdvisorToolRegistry {
  const registry = createMetroraToolRegistry(
    source as unknown as MetroraToolDataSource,
    scope as unknown as MetroraToolScope,
    suppliedOverview as unknown as import('../../../src/tools/types').MetroraOverview | null,
    options as unknown as import('../../../src/tools/types').MetroraToolScopeOptions,
  )
  return {
    contract: registry.contract as unknown as AdvisorToolContract,
    definitions: registry.definitions as unknown as readonly AdvisorToolDefinition[],
    scope: registry.scope as unknown as AdvisorScope,
    execute: (async (name: string, args: Record<string, unknown>, signal?: AbortSignal) => registry.execute(name, args, signal)) as unknown as AdvisorToolExecutor,
  }
}
