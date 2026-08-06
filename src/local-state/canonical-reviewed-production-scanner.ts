import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import * as z from 'zod/v4'

import { collectorProvenanceProfileForCall } from '../contracts/v1/collector-provenance.js'
import { OpaqueIdSchema, TimestampSchema } from '../contracts/v1/common.js'
import { loadDailyCache } from '../daily-cache.js'
import { normalizeExplicitModelProvider } from '../model-provider.js'
import { cachedCallToApiCall, clearSessionCache, parseAllSessions } from '../parser.js'
import { readCodexSessionModelProvider } from '../providers/codex-model-provider.js'
import { getProvider } from '../providers/index.js'
import {
  isCacheComplete,
  loadCache,
  type CachedCall,
  type CachedFile,
  type SessionCache,
} from '../session-cache.js'
import type { ParsedApiCall } from '../types.js'
import type {
  CanonicalReviewedProductionCandidateV1,
  CanonicalReviewedProductionScanV1,
} from './reviewed-production-orchestrator.js'

const AdapterVersionSchema = z.string().trim().min(1).max(64)

export type CanonicalReviewedProductionScannerOptionsV1 = {
  endpointId: string
  adapterVersion: string
  notBefore: string
}

export type CanonicalReviewedProductionScannerDependenciesV1 = {
  refreshCanonicalCache(): Promise<void>
  loadCanonicalCache(): Promise<SessionCache>
  sourceExists(path: string): boolean
  providerDisplayName(provider: string): Promise<string | undefined>
  codexModelProvider?(path: string): Promise<string | undefined>
  observeCanonicalHistoryParity?(input: {
    endpointId: string
    sessionCache: SessionCache
  }): Promise<void>
  reportCanonicalHistoryParityFailure?(error: unknown): void
}

export class CanonicalReviewedProductionScannerIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalReviewedProductionScannerIntegrityError'
  }
}

/**
 * Public, path-free fingerprint for one canonical source record.
 *
 * The endpoint id scopes the fingerprint so identical local source records on
 * different endpoints do not become a new cross-device correlation handle.
 * The private deduplication key is hashed and never leaves this trusted scanner
 * boundary. Provider parsers already enforce this identity globally within a
 * provider, so no local path is needed in the public digest.
 */
export function canonicalSourceRecordFingerprintSha256V1(input: {
  endpointId: string
  provider: string
  privateDeduplicationKey: string
}): string {
  if (input.privateDeduplicationKey.length === 0) {
    throw new CanonicalReviewedProductionScannerIntegrityError(
      'canonical cached call has an empty private deduplication key',
    )
  }
  return createHash('sha256')
    .update('metrora-canonical-source-record-v1\0')
    .update(input.endpointId)
    .update('\0')
    .update(input.provider)
    .update('\0')
    .update(input.privateDeduplicationKey)
    .digest('hex')
}

function inScopeCalls(file: CachedFile, notBeforeMs: number): CachedCall[] {
  const calls: CachedCall[] = []
  for (const turn of file.turns) {
    for (const call of turn.calls) {
      const timestamp = TimestampSchema.safeParse(call.timestamp)
      if (!timestamp.success) {
        throw new CanonicalReviewedProductionScannerIntegrityError(
          'canonical cached call has an invalid timestamp',
        )
      }
      if (Date.parse(timestamp.data) >= notBeforeMs) calls.push(call)
    }
  }
  return calls
}

function canonicalApiCall(cachedCall: CachedCall): ParsedApiCall {
  try {
    return cachedCallToApiCall(cachedCall)
  } catch {
    throw new CanonicalReviewedProductionScannerIntegrityError(
      'canonical cached call could not be validated',
    )
  }
}

function reportParityFailure(error: unknown): void {
  void error
  process.stderr.write(
    'metrora: canonical history parity observation failed; current analytics remain authoritative.\n',
  )
}

function defaultDependencies(): CanonicalReviewedProductionScannerDependenciesV1 {
  return {
    refreshCanonicalCache: async () => {
      // Clear only the process-local TTL view. parseAllSessions remains the
      // canonical discovery/reconcile/parse/save path and owns its existing
      // cold-hydration and warm-refresh locks.
      clearSessionCache()
      await parseAllSessions()
    },
    loadCanonicalCache: loadCache,
    sourceExists: existsSync,
    providerDisplayName: async provider => (await getProvider(provider))?.displayName,
    codexModelProvider: readCodexSessionModelProvider,
    observeCanonicalHistoryParity: async ({ endpointId, sessionCache }) => {
      const dailyCache = await loadDailyCache()
      // The parity observer is diagnostic and must never mint authority from an
      // incomplete or unstamped daily history. A later trusted refresh will run
      // it automatically through this same path.
      if (dailyCache.complete !== true || dailyCache.watermarkTrusted !== true) return
      const { observeCanonicalHistoryParityV1 } = await import('./canonical-history-parity-observer.js')
      await observeCanonicalHistoryParityV1({ endpointId, sessionCache, dailyCache }, {
        sourceFingerprint: canonicalSourceRecordFingerprintSha256V1,
      })
    },
    reportCanonicalHistoryParityFailure: reportParityFailure,
  }
}

async function observeParityWithoutChangingProduction(
  input: { endpointId: string; sessionCache: SessionCache },
  dependencies: CanonicalReviewedProductionScannerDependenciesV1,
): Promise<void> {
  if (!dependencies.observeCanonicalHistoryParity) return
  try {
    await dependencies.observeCanonicalHistoryParity(input)
  } catch (error) {
    try {
      dependencies.reportCanonicalHistoryParityFailure?.(error)
    } catch {
      // Diagnostics are not allowed to become a second production gate.
    }
  }
}

/**
 * Refresh and inspect the canonical per-source cache without accepting paths,
 * calls, providers, costs, fingerprints, disclosure choices, or time bounds
 * from Electron's renderer. Only source-present calls recorded at or after the
 * trusted Workspace creation timestamp can become candidates.
 *
 * Pre-Workspace history remains canonical analytics history but is not silently
 * converted into evidence by the normal Produce action. A future historical
 * backfill must be a separate bounded workflow with progress and cancellation.
 */
export async function scanCanonicalReviewedProductionCandidatesV1(
  input: CanonicalReviewedProductionScannerOptionsV1,
  dependencies: CanonicalReviewedProductionScannerDependenciesV1 = defaultDependencies(),
): Promise<CanonicalReviewedProductionScanV1> {
  const endpointId = OpaqueIdSchema.parse(input.endpointId)
  const adapterVersion = AdapterVersionSchema.parse(input.adapterVersion)
  const notBefore = TimestampSchema.parse(input.notBefore)
  const notBeforeMs = Date.parse(notBefore)
  const readCodexProvider = dependencies.codexModelProvider ?? readCodexSessionModelProvider

  await dependencies.refreshCanonicalCache()
  const cache = await dependencies.loadCanonicalCache()
  if (!isCacheComplete(cache)) {
    throw new CanonicalReviewedProductionScannerIntegrityError(
      'canonical session cache is incomplete after explicit refresh',
    )
  }

  await observeParityWithoutChangingProduction({ endpointId, sessionCache: cache }, dependencies)

  const candidates: CanonicalReviewedProductionCandidateV1[] = []
  let withheldCount = 0
  let failedCount = 0

  for (const [sectionProvider, section] of Object.entries(cache.providers).sort(([a], [b]) => a.localeCompare(b))) {
    let displayName: string | undefined

    for (const [sourcePath, file] of Object.entries(section.files).sort(([a], [b]) => a.localeCompare(b))) {
      if (file.failed) {
        failedCount += 1
        continue
      }

      const scopedCalls = inScopeCalls(file, notBeforeMs)
      if (scopedCalls.length === 0) continue

      if (!dependencies.sourceExists(sourcePath)) {
        // Durable/source-less history remains valid for analytics but cannot be
        // promoted into fresh endpoint evidence after its source disappeared.
        withheldCount += scopedCalls.length
        continue
      }

      const codexSourceProvider = sectionProvider === 'codex'
        ? normalizeExplicitModelProvider(await readCodexProvider(sourcePath))
        : undefined
      if (sectionProvider === 'codex' && !codexSourceProvider) {
        withheldCount += scopedCalls.length
        continue
      }

      displayName ??= await dependencies.providerDisplayName(sectionProvider)

      for (const cachedCall of scopedCalls) {
        if (cachedCall.provider !== sectionProvider) {
          throw new CanonicalReviewedProductionScannerIntegrityError(
            'canonical cached call provider disagrees with its provider section',
          )
        }
        if (!cachedCall.deduplicationKey) {
          throw new CanonicalReviewedProductionScannerIntegrityError(
            'canonical cached call has an empty private deduplication key',
          )
        }

        let call = canonicalApiCall(cachedCall)
        let explicitProvider = normalizeExplicitModelProvider(call.modelProvider)

        if (sectionProvider === 'codex' && codexSourceProvider) {
          if (explicitProvider && explicitProvider !== codexSourceProvider) {
            throw new CanonicalReviewedProductionScannerIntegrityError(
              'canonical Codex call provider disagrees with source metadata',
            )
          }
          if (!call.modelProvider) {
            call = { ...call, modelProvider: codexSourceProvider }
            explicitProvider = codexSourceProvider
          }
        }

        const profile = collectorProvenanceProfileForCall(call)
        if (!displayName || !explicitProvider || explicitProvider !== call.modelProvider || !profile) {
          withheldCount += 1
          continue
        }

        candidates.push({
          call,
          context: {
            session: { mode: 'omit' },
            tool: { name: displayName },
            collector: {
              adapterVersion,
              sourceFingerprintSha256: canonicalSourceRecordFingerprintSha256V1({
                endpointId,
                provider: sectionProvider,
                privateDeduplicationKey: cachedCall.deduplicationKey,
              }),
            },
            genAi: {
              operationName: 'other',
              providerName: explicitProvider,
            },
          },
        })
      }
    }
  }

  return { candidates, withheldCount, failedCount }
}
