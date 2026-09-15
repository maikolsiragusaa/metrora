import type { CachedTurn, ProviderSection, SessionCache } from './session-cache.js'
import {
  flushCopilotChatJournalInvalidations,
  recordCopilotChatJournalSourceChange,
  recordCopilotChatJournalSourceEviction,
  recordCopilotChatJournalSourceFailure,
} from './copilot-chat-journal-reconciliation.js'
import {
  flushOpenCodeDailyInvalidations,
  recordOpenCodeSourceChange,
  recordOpenCodeSourceEviction,
  recordOpenCodeSourceFailure,
} from './opencode-daily-invalidation.js'
import { COPILOT_CHAT_JOURNAL_PROVIDER } from './provider-parse-authorities.js'

type TimestampedTurn = Pick<CachedTurn, 'timestamp'>

export function recordProviderSourceChange(providerName: string, sourcePath: string, previousTurns: Iterable<TimestampedTurn>, turns: Iterable<TimestampedTurn>): void {
  recordCopilotChatJournalSourceChange(providerName, sourcePath, turns)
  recordOpenCodeSourceChange(providerName, previousTurns, turns)
}

export function recordProviderSourceBusyFailure(providerName: string, previousTurns: Iterable<TimestampedTurn>): void {
  recordOpenCodeSourceFailure(providerName, previousTurns)
}

export function recordProviderSourceFailure(providerName: string, sourcePath: string, previousTurns: Iterable<TimestampedTurn>): void {
  recordCopilotChatJournalSourceFailure(providerName, sourcePath)
  recordOpenCodeSourceFailure(providerName, previousTurns)
}

export async function flushProviderSourceReconciliations(readOnly: boolean, discoveryComplete: boolean): Promise<void> {
  if (!readOnly) await flushOpenCodeDailyInvalidations()
  if (!readOnly && discoveryComplete) await flushCopilotChatJournalInvalidations()
}

export function shouldReconcileMissingProviderSources(providerName: string, sourceCount: number, discoveryComplete?: boolean): boolean {
  return discoveryComplete === true || (discoveryComplete === undefined && (sourceCount > 0 || providerName === COPILOT_CHAT_JOURNAL_PROVIDER))
}

/** Remove source files that disappeared from discovery and notify source-specific authorities. */
export function reconcileMissingProviderSources(
  providerName: string,
  section: ProviderSection,
  discoveredPaths: ReadonlySet<string>,
  diskCache: SessionCache,
): void {
  for (const cachedPath of Object.keys(section.files)) {
    if (discoveredPaths.has(cachedPath)) continue
    const turns = section.files[cachedPath]!.turns
    recordCopilotChatJournalSourceEviction(providerName, cachedPath, turns)
    recordOpenCodeSourceEviction(providerName, turns)
    delete section.files[cachedPath]
    ;(diskCache as SessionCache & { _dirty?: boolean })._dirty = true
  }
}
