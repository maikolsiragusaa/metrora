/**
 * Legacy Advisor import boundary.
 *
 * The factual registry is owned by src/tools. Keeping this adapter lets the
 * existing investigation kernel and older integrations migrate incrementally
 * without creating a second implementation.
 */
import { createMetroraToolRegistry } from '../../../src/tools/registry'
import { metroraToolScopeFingerprint } from '../../../src/tools/types'
import { advisorHarnessContext } from './types'
import type { MetroraOverviewSnapshot, MetroraToolDataSource, MetroraToolScope } from '../../../src/tools/types'
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

export type AdvisorOverviewSnapshot = { scopeFingerprint: string; payload: MenubarPayload }

export function createAdvisorOverviewSnapshot(scope: AdvisorScope, payload: MenubarPayload): AdvisorOverviewSnapshot {
  const scoped = scope as unknown as MetroraToolScope
  return {
    scopeFingerprint: metroraToolScopeFingerprint(scoped),
    payload,
  }
}

export function createAdvisorToolRegistry(source: AdvisorDataSource, scope: AdvisorScope, suppliedOverview: MenubarPayload | AdvisorOverviewSnapshot | null, options: { allowedPeriods?: readonly AdvisorPeriodFilter[] } = {}): AdvisorToolRegistry {
  const canonicalOverview = suppliedOverview && 'scopeFingerprint' in suppliedOverview
    ? suppliedOverview as MetroraOverviewSnapshot
    : suppliedOverview as MenubarPayload | null
  const registry = createMetroraToolRegistry(
    source as unknown as MetroraToolDataSource,
    scope as unknown as MetroraToolScope,
    canonicalOverview as unknown as import('../../../src/tools/types').MetroraOverview | MetroraOverviewSnapshot | null,
    options as unknown as import('../../../src/tools/types').MetroraToolScopeOptions,
  )
  const context = advisorHarnessContext(scope)
  const immutableScope = Object.freeze({ ...(registry.scope as unknown as AdvisorScope), harnessContext: context })
  return {
    contract: registry.contract as unknown as AdvisorToolContract,
    definitions: registry.definitions as unknown as readonly AdvisorToolDefinition[],
    scope: immutableScope,
    execute: (async (name: string, args: Record<string, unknown>, signal?: AbortSignal) => {
      const execution = await registry.execute(name, args, signal)
      return {
        ...execution,
        evidence: { ...execution.evidence, scope: Object.freeze({ ...execution.evidence.scope, harnessContext: context }) },
        ...(execution.envelope ? { envelope: { ...execution.envelope, scope: Object.freeze({ ...execution.envelope.scope, harnessContext: context }) } } : {}),
      }
    }) as unknown as AdvisorToolExecutor,
  }
}
