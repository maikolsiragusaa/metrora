import { resolve } from 'node:path'

import type { DateRange, ProjectSummary } from './types.js'
import { parseAllSessions, clearSessionCache } from './parser.js'
import { COPILOT_CHAT_JOURNAL_PROVIDER } from './provider-parse-authorities.js'
import { loadCache as loadSessionCache } from './session-cache.js'
import { DURABLE_HISTORY_AUTHORITY, emptyCache, ensureCacheHydrated, type DailyCache, type DailyEntry } from './daily-cache.js'
import {
  beginCopilotChatJournalIdentityBoundary,
  clearCopilotChatJournalInvalidations,
  endCopilotChatJournalIdentityBoundary,
  getCopilotChatJournalFingerprints,
  readCopilotChatJournalInvalidatedDays,
} from './copilot-chat-journal-reconciliation.js'

async function copilotChatJournalChanged(): Promise<boolean> {
  const current = await getCopilotChatJournalFingerprints()
  const sessionCache = await loadSessionCache()
  const cached = sessionCache.providers[COPILOT_CHAT_JOURNAL_PROVIDER]?.files ?? {}
  if (current.length !== Object.keys(cached).length) return current.length > 0 || Object.keys(cached).length > 0

  const byPath = new Map(current.map(fingerprint => [fingerprint.path, fingerprint]))
  for (const [path, file] of Object.entries(cached)) {
    const fingerprint = byPath.get(path)
    if (!fingerprint) return true
    if (
      file.fingerprint.dev !== fingerprint.dev
      || file.fingerprint.ino !== fingerprint.ino
      || file.fingerprint.mtimeMs !== fingerprint.mtimeMs
      || file.fingerprint.sizeBytes !== fingerprint.sizeBytes
    ) return true
  }
  return false
}

async function copilotChatJournalRootChanged(): Promise<boolean> {
  const configuredRoot = process.env['METRORA_COPILOT_WS_STORAGE_DIR']
  if (!configuredRoot) return false
  const sessionCache = await loadSessionCache()
  const files = sessionCache.providers[COPILOT_CHAT_JOURNAL_PROVIDER]?.files ?? {}
  if (Object.keys(files).length === 0) return false
  const canonical = (value: string): string => {
    const slashes = value.replaceAll('\\', '/')
    const compared = process.platform === 'win32' ? slashes.toLowerCase() : slashes
    return compared.replace(/\/+$/, '')
  }
  const normalizedRoot = canonical(resolve(configuredRoot))
  const normalizedPrefix = `${normalizedRoot}/`
  return Object.keys(files).some(path => {
    const normalizedPath = canonical(resolve(path))
    return normalizedPath !== normalizedRoot && !normalizedPath.startsWith(normalizedPrefix)
  })
}

/** Prepare only the journal reconciliation work required by this hydration. */
export async function prepareCopilotChatJournalReconciliation(): Promise<string[]> {
  if (await copilotChatJournalRootChanged()) {
    // A root/profile/account switch is identity-ambiguous. Reparse the new
    // root for current output, but keep the old daily ledger separate.
    await clearCopilotChatJournalInvalidations()
    clearSessionCache()
    beginCopilotChatJournalIdentityBoundary()
    try {
      await parseAllSessions(undefined, 'all')
    } finally {
      endCopilotChatJournalIdentityBoundary()
    }
    await clearCopilotChatJournalInvalidations()
    return []
  }

  let days = await readCopilotChatJournalInvalidatedDays()
  if (await copilotChatJournalChanged()) {
    clearSessionCache()
    await parseAllSessions(undefined, 'all')
    days = await readCopilotChatJournalInvalidatedDays()
  }
  return days
}

export async function hydrateCopilotDailyCache(
  parseSessions: (range: DateRange) => Promise<ProjectSummary[]>,
  aggregateDays: (projects: ProjectSummary[]) => DailyEntry[],
  savingsConfigHash: string,
  sessionComplete: () => boolean,
): Promise<DailyCache> {
  try {
    const copilotJournalDays = await prepareCopilotChatJournalReconciliation()
    const cache = await ensureCacheHydrated(
      parseSessions,
      aggregateDays,
      savingsConfigHash,
      sessionComplete,
      undefined,
      {
        durableHistoryAuthority: DURABLE_HISTORY_AUTHORITY,
        ...(copilotJournalDays.length > 0 ? { reconcileProviderDays: { copilot: copilotJournalDays } } : {}),
      },
    )
    if (copilotJournalDays.length > 0 && cache.complete === true) {
      await clearCopilotChatJournalInvalidations()
    }
    return cache
  } catch (err) {
    process.stderr.write(
      `metrora: daily history backfill failed; the trend chart may be incomplete. ` +
      `${err instanceof Error ? err.message : String(err)}\n`
    )
    return emptyCache()
  }
}
