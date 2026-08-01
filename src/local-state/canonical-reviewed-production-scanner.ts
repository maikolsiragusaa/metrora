import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import * as z from 'zod/v4'

import { collectorProvenanceProfileForCall } from '../contracts/v1/collector-provenance.js'
import { OpaqueIdSchema } from '../contracts/v1/common.js'
import { normalizeExplicitModelProvider } from '../model-provider.js'
import { cachedCallToApiCall, clearSessionCache, parseAllSessions } from '../parser.js'
import { getProvider } from '../providers/index.js'
import {
  isCacheComplete,
  loadCache,
  type CachedFile,
  type SessionCache,
} from '../session-cache.js'
import type {
  CanonicalReviewedProductionCandidateV1,
  CanonicalReviewedProductionScanV1,
} from './reviewed-production-orchestrator.js'

const AdapterVersionSchema = z.string().trim().min(1).max(64)

export type CanonicalReviewedProductionScannerOptionsV1 = {
  endpointId: string
  adapterVersion: string
}

export type CanonicalReviewedProductionScannerDependenciesV1 = {
  refreshCanonicalCache(): Promise<void>
  loadCanonicalCache(): Promise<SessionCache>
  sourceExists(path: string): boolean
  providerDisplayName(provider: string): Promise<string | undefined>
}

export class CanonicalReviewedProductionScannerIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalReviewedProductionScannerIntegrityError'
  }
}

function normalizedPrivatePath(path: string): string {
  const absolute = resolve(path).replaceAll('\\', '/')
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/**
 * Public, path-free fingerprint for one canonical source record.
 *
 * The endpoint id scopes the fingerprint so identical local source records on
 * different endpoints do not become a new cross-device correlation handle.
 * The raw path and private deduplication key are hashed and never leave this
 * trusted scanner boundary.
 */
export function canonicalSourceRecordFingerprintSha256V1(input: {
  endpointId: string
  provider: string
  sourcePath: string
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
    .update(normalizedPrivatePath(input.sourcePath))
    .update('\0')
    .update(input.privateDeduplicationKey)
    .digest('hex')
}

function callCount(file: CachedFile): number {
  return file.turns.reduce((sum, turn) => sum + turn.calls.length, 0)
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
  }
}

/**
 * Refresh and inspect the canonical per-source cache without accepting paths,
 * calls, providers, costs, fingerprints, or disclosure choices from Electron's
 * renderer. Only source-present, explicitly attributed, reviewed calls become
 * candidates for the protected production orchestrator.
 */
export async function scanCanonicalReviewedProductionCandidatesV1(
  input: CanonicalReviewedProductionScannerOptionsV1,
  dependencies: CanonicalReviewedProductionScannerDependenciesV1 = defaultDependencies(),
): Promise<CanonicalReviewedProductionScanV1> {
  const endpointId = OpaqueIdSchema.parse(input.endpointId)
  const adapterVersion = AdapterVersionSchema.parse(input.adapterVersion)

  await dependencies.refreshCanonicalCache()
  const cache = await dependencies.loadCanonicalCache()
  if (!isCacheComplete(cache)) {
    throw new CanonicalReviewedProductionScannerIntegrityError(
      'canonical session cache is incomplete after explicit refresh',
    )
  }

  const candidates: CanonicalReviewedProductionCandidateV1[] = []
  let withheldCount = 0
  let failedCount = 0

  for (const [sectionProvider, section] of Object.entries(cache.providers).sort(([a], [b]) => a.localeCompare(b))) {
    const displayName = await dependencies.providerDisplayName(sectionProvider)

    for (const [sourcePath, file] of Object.entries(section.files).sort(([a], [b]) => a.localeCompare(b))) {
      if (file.failed) {
        failedCount += 1
        continue
      }

      if (!dependencies.sourceExists(sourcePath)) {
        // Durable/source-less history remains valid for analytics but cannot be
        // promoted into fresh endpoint evidence after its source disappeared.
        withheldCount += callCount(file)
        continue
      }

      for (const turn of file.turns) {
        for (const cachedCall of turn.calls) {
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

          const call = cachedCallToApiCall(cachedCall)
          const explicitProvider = normalizeExplicitModelProvider(call.modelProvider)
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
                  sourcePath,
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
  }

  return { candidates, withheldCount, failedCount }
}
