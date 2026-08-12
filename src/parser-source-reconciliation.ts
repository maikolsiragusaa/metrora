import type { ProviderSection, SessionCache } from './session-cache.js'
import { recordCopilotChatJournalSourceEviction } from './copilot-chat-journal-reconciliation.js'
import { COPILOT_CHAT_JOURNAL_PROVIDER } from './provider-parse-authorities.js'

export function shouldReconcileMissingProviderSources(providerName: string, sourceCount: number): boolean {
  return sourceCount > 0 || providerName === COPILOT_CHAT_JOURNAL_PROVIDER
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
    recordCopilotChatJournalSourceEviction(providerName, cachedPath, section.files[cachedPath]!.turns)
    delete section.files[cachedPath]
    ;(diskCache as SessionCache & { _dirty?: boolean })._dirty = true
  }
}
