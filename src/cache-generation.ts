import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import * as z from 'zod/v4'

import { atomicWritePrivateFile, readOptionalPrivateFile } from './local-state/atomic-file.js'
import { canonicalizeRfc8785 } from './vendor/rfc8785-canonicalize.js'
import type { DailyCache } from './daily-cache-types.js'
import type { CachedFile, FileFingerprint, SessionCache } from './session-cache.js'

export const CACHE_GENERATION_VERSION = 1 as const
export const SESSION_CACHE_GENERATION_KIND = 'metrora.session-cache-generation' as const
export const DAILY_CACHE_GENERATION_KIND = 'metrora.daily-cache-generation' as const

type FingerprintFields = {
  dev: number
  ino: number
  mtimeMs: number
  sizeBytes: number
  sqliteWal?: { mtimeMs: number; sizeBytes: number }
}

type CachePayloadEvidenceV1 = {
  payload: string
  payloadSha256: string
}

// The normal refresh lifecycle may hand publication a sanitized in-memory
// object whose property insertion order is not the same as the immutable
// bytes that were sealed by the cache save. Keep the exact completed payload
// process-local and bind it to the object through a WeakMap. This is evidence,
// not authority: publication still verifies the generation sidecar digest and
// that the object has not changed since the evidence was attached.
const sessionCachePayloadEvidence = new WeakMap<object, CachePayloadEvidenceV1>()
const dailyCachePayloadEvidence = new WeakMap<object, CachePayloadEvidenceV1>()

export type SessionSourceGenerationFileV1 = {
  pathSha256: string
  fingerprint: FingerprintFields
}

export type SessionSourceGenerationProviderV1 = {
  provider: string
  envFingerprint: string
  files: SessionSourceGenerationFileV1[]
}

export type SessionCacheGenerationV1 = {
  kind: typeof SESSION_CACHE_GENERATION_KIND
  version: typeof CACHE_GENERATION_VERSION
  cacheSchemaVersion: number
  payloadSha256: string
  fileIdentity?: CacheFileIdentityV1
  complete: boolean
  sourceManifestSha256: string
  providers: SessionSourceGenerationProviderV1[]
}

export type DailyCacheGenerationV1 = {
  kind: typeof DAILY_CACHE_GENERATION_KIND
  version: typeof CACHE_GENERATION_VERSION
  cacheSchemaVersion: number
  payloadSha256: string
  fileIdentity?: CacheFileIdentityV1
  complete: boolean
  watermarkTrusted: boolean
  timeZone?: string
}

export type CurrentCacheAuthorityGenerationV1 = {
  session: SessionCacheGenerationV1
  daily: DailyCacheGenerationV1
}

export type CacheFileIdentityV1 = {
  dev: number
  ino: number
  mtimeMs: number
  sizeBytes: number
}

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const FingerprintSchema = z.strictObject({
  dev: z.number().finite(),
  ino: z.number().finite(),
  mtimeMs: z.number().finite(),
  sizeBytes: z.number().finite(),
  sqliteWal: z.strictObject({
    mtimeMs: z.number().finite(),
    sizeBytes: z.number().finite(),
  }).optional(),
})
const SessionGenerationSchema = z.strictObject({
  kind: z.literal(SESSION_CACHE_GENERATION_KIND),
  version: z.literal(CACHE_GENERATION_VERSION),
  cacheSchemaVersion: z.number().int().positive(),
  payloadSha256: DigestSchema,
  fileIdentity: z.strictObject({
    dev: z.number().finite(),
    ino: z.number().finite(),
    mtimeMs: z.number().finite(),
    sizeBytes: z.number().finite(),
  }).optional(),
  complete: z.boolean(),
  sourceManifestSha256: DigestSchema,
  providers: z.array(z.strictObject({
    provider: z.string().min(1),
    envFingerprint: z.string(),
    files: z.array(z.strictObject({
      pathSha256: DigestSchema,
      fingerprint: FingerprintSchema,
    })),
  })),
})
const DailyGenerationSchema = z.strictObject({
  kind: z.literal(DAILY_CACHE_GENERATION_KIND),
  version: z.literal(CACHE_GENERATION_VERSION),
  cacheSchemaVersion: z.number().int().positive(),
  payloadSha256: DigestSchema,
  fileIdentity: z.strictObject({
    dev: z.number().finite(),
    ino: z.number().finite(),
    mtimeMs: z.number().finite(),
    sizeBytes: z.number().finite(),
  }).optional(),
  complete: z.boolean(),
  watermarkTrusted: z.boolean(),
  timeZone: z.string().optional(),
})

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function payloadText(payload: Uint8Array | string): string {
  return typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8')
}

export function rememberSessionCachePayloadEvidenceV1(
  cache: SessionCache,
  payload: Uint8Array | string,
): void {
  const text = payloadText(payload)
  sessionCachePayloadEvidence.set(cache, { payload: text, payloadSha256: sha256(text) })
}

export function rememberDailyCachePayloadEvidenceV1(
  cache: DailyCache,
  payload: Uint8Array | string,
): void {
  const text = payloadText(payload)
  dailyCachePayloadEvidence.set(cache, { payload: text, payloadSha256: sha256(text) })
}

export function sessionCachePayloadEvidenceV1(cache: SessionCache): CachePayloadEvidenceV1 | undefined {
  return sessionCachePayloadEvidence.get(cache)
}

export function dailyCachePayloadEvidenceV1(cache: DailyCache): CachePayloadEvidenceV1 | undefined {
  return dailyCachePayloadEvidence.get(cache)
}

export function cachePayloadMatchesValueV1(payload: Uint8Array | string, value: unknown): boolean {
  try {
    return canonicalizeRfc8785(JSON.parse(payloadText(payload))) === canonicalizeRfc8785(value)
  } catch {
    return false
  }
}

export function cachePayloadSha256V1(payload: Uint8Array | string): string {
  return sha256(payload)
}

function sourcePathSha256(provider: string, path: string): string {
  return sha256(`metrora-session-source-path-v1\0${provider}\0${path}`)
}

function fingerprint(value: FileFingerprint): FingerprintFields {
  return {
    dev: value.dev,
    ino: value.ino,
    mtimeMs: value.mtimeMs,
    sizeBytes: value.sizeBytes,
    ...(value.sqliteWal ? { sqliteWal: { ...value.sqliteWal } } : {}),
  }
}

function sourceFile(provider: string, path: string, file: CachedFile): SessionSourceGenerationFileV1 {
  return { pathSha256: sourcePathSha256(provider, path), fingerprint: fingerprint(file.fingerprint) }
}

function sourceProviders(cache: SessionCache): SessionSourceGenerationProviderV1[] {
  return Object.entries(cache.providers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, section]) => ({
      provider,
      envFingerprint: section.envFingerprint,
      files: Object.entries(section.files)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, file]) => sourceFile(provider, path, file)),
    }))
}

function sourceManifestSha256(providers: SessionSourceGenerationProviderV1[]): string {
  return sha256(`metrora-session-source-manifest-v1\0${canonicalizeRfc8785(providers)}`)
}

export function buildSessionCacheGenerationV1(
  cache: SessionCache,
  payload: Uint8Array | string,
  fileIdentity?: CacheFileIdentityV1,
): SessionCacheGenerationV1 {
  const providers = sourceProviders(cache)
  return {
    kind: SESSION_CACHE_GENERATION_KIND,
    version: CACHE_GENERATION_VERSION,
    cacheSchemaVersion: cache.version,
    payloadSha256: cachePayloadSha256V1(payload),
    ...(fileIdentity ? { fileIdentity } : {}),
    complete: cache.complete === true,
    sourceManifestSha256: sourceManifestSha256(providers),
    providers,
  }
}

export function buildDailyCacheGenerationV1(
  cache: DailyCache,
  payload: Uint8Array | string,
  fileIdentity?: CacheFileIdentityV1,
): DailyCacheGenerationV1 {
  const trusted = (cache as DailyCache & { watermarkTrusted?: boolean }).watermarkTrusted === true
  return {
    kind: DAILY_CACHE_GENERATION_KIND,
    version: CACHE_GENERATION_VERSION,
    cacheSchemaVersion: cache.version,
    payloadSha256: cachePayloadSha256V1(payload),
    ...(fileIdentity ? { fileIdentity } : {}),
    complete: cache.complete === true,
    watermarkTrusted: trusted,
    ...(cache.tzKey !== undefined ? { timeZone: cache.tzKey } : {}),
  }
}

function generationPath(cachePath: string): string {
  return `${cachePath}.generation.v1.json`
}

export async function writeSessionCacheGenerationV1(
  cachePath: string,
  generation: SessionCacheGenerationV1,
): Promise<void> {
  await atomicWritePrivateFile(generationPath(cachePath), JSON.stringify(generation))
}

export async function writeDailyCacheGenerationV1(
  cachePath: string,
  generation: DailyCacheGenerationV1,
): Promise<void> {
  await atomicWritePrivateFile(generationPath(cachePath), JSON.stringify(generation))
}

function statIdentity(value: { dev: number; ino: number; mtimeMs: number; size: number }): CacheFileIdentityV1 {
  return { dev: value.dev, ino: value.ino, mtimeMs: value.mtimeMs, sizeBytes: value.size }
}

export async function writeSessionCacheGenerationFromPayloadV1(
  cachePath: string,
  cache: SessionCache,
  payload: Uint8Array | string,
): Promise<void> {
  const generation = buildSessionCacheGenerationV1(cache, payload)
  const identity = await stat(cachePath).then(statIdentity).catch(() => undefined)
  if (!identity) return
  await writeSessionCacheGenerationV1(cachePath, { ...generation, fileIdentity: identity })
}

export async function writeDailyCacheGenerationFromPayloadV1(
  cachePath: string,
  cache: DailyCache,
  payload: Uint8Array | string,
): Promise<void> {
  const generation = buildDailyCacheGenerationV1(cache, payload)
  const identity = await stat(cachePath).then(statIdentity).catch(() => undefined)
  if (!identity) return
  await writeDailyCacheGenerationV1(cachePath, { ...generation, fileIdentity: identity })
}

async function readGeneration<T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const bytes = await readOptionalPrivateFile(path)
  if (!bytes) return undefined
  return schema.parse(JSON.parse(bytes.toString('utf8')))
}

export async function readSessionCacheGenerationV1(
  cachePath: string,
): Promise<SessionCacheGenerationV1 | undefined> {
  const generation = await readGeneration(generationPath(cachePath), SessionGenerationSchema)
  if (generation && sourceManifestSha256(generation.providers) !== generation.sourceManifestSha256) {
    throw new Error('session cache generation source manifest digest does not match')
  }
  return generation
}

export async function readDailyCacheGenerationV1(
  cachePath: string,
): Promise<DailyCacheGenerationV1 | undefined> {
  return readGeneration(generationPath(cachePath), DailyGenerationSchema)
}

export async function readCurrentSessionCacheGenerationV1(
  cachePath: string,
): Promise<SessionCacheGenerationV1 | undefined> {
  const generation = await readSessionCacheGenerationV1(cachePath)
  if (!generation) return undefined
  const identity = await stat(cachePath)
  if (generation.fileIdentity && generation.fileIdentity.dev !== 0 && generation.fileIdentity.ino !== 0) {
    if (!fileIdentityMatchesV1(generation.fileIdentity, identity)) return undefined
  }
  const bytes = await readFile(cachePath)
  if (cachePayloadSha256V1(bytes) !== generation.payloadSha256) return undefined
  return generation
}

export async function readCurrentDailyCacheGenerationV1(
  cachePath: string,
): Promise<DailyCacheGenerationV1 | undefined> {
  const generation = await readDailyCacheGenerationV1(cachePath)
  if (!generation) return undefined
  const identity = await stat(cachePath)
  if (generation.fileIdentity && generation.fileIdentity.dev !== 0 && generation.fileIdentity.ino !== 0) {
    if (!fileIdentityMatchesV1(generation.fileIdentity, identity)) return undefined
  }
  const bytes = await readFile(cachePath)
  if (cachePayloadSha256V1(bytes) !== generation.payloadSha256) return undefined
  return generation
}

export function sessionGenerationSourcePathSha256V1(provider: string, path: string): string {
  return sourcePathSha256(provider, path)
}

export function sessionGenerationHasSourceV1(
  generation: SessionCacheGenerationV1,
  provider: string,
  path: string,
): boolean {
  const section = generation.providers.find(value => value.provider === provider)
  return section?.files.some(file => file.pathSha256 === sourcePathSha256(provider, path)) === true
}

export function sessionGenerationFileV1(
  generation: SessionCacheGenerationV1,
  provider: string,
  path: string,
): SessionSourceGenerationFileV1 | undefined {
  const section = generation.providers.find(value => value.provider === provider)
  return section?.files.find(file => file.pathSha256 === sourcePathSha256(provider, path))
}

export function sessionGenerationProviderV1(
  generation: SessionCacheGenerationV1,
  provider: string,
): SessionSourceGenerationProviderV1 | undefined {
  return generation.providers.find(value => value.provider === provider)
}

export function sourceFingerprintMatchesV1(
  expected: FingerprintFields,
  current: FileFingerprint | null,
): boolean {
  if (!current) return false
  return expected.dev === current.dev
    && expected.ino === current.ino
    && expected.mtimeMs === current.mtimeMs
    && expected.sizeBytes === current.sizeBytes
    && (expected.sqliteWal === undefined && current.sqliteWal === undefined
      || expected.sqliteWal !== undefined && current.sqliteWal !== undefined
        && expected.sqliteWal.mtimeMs === current.sqliteWal.mtimeMs
        && expected.sqliteWal.sizeBytes === current.sqliteWal.sizeBytes)
}

export function fileIdentityMatchesV1(
  expected: CacheFileIdentityV1,
  current: { dev: number; ino: number; mtimeMs: number; size: number },
): boolean {
  return expected.dev === current.dev
    && expected.ino === current.ino
    && expected.mtimeMs === current.mtimeMs
    && expected.sizeBytes === current.size
}

export function authorityGenerationForSidecarV1(
  generation: CurrentCacheAuthorityGenerationV1,
): {
  sessionPayloadSha256: string
  dailyPayloadSha256: string
  sourceManifestSha256: string
} {
  return {
    sessionPayloadSha256: generation.session.payloadSha256,
    dailyPayloadSha256: generation.daily.payloadSha256,
    sourceManifestSha256: generation.session.sourceManifestSha256,
  }
}
