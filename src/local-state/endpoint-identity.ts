import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import * as z from 'zod/v4'

import {
  ContractVersionSchema,
  OpaqueIdSchema,
  PositiveIntegerSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from '../contracts/v1/common.js'
import { atomicWritePrivateFile, readOptionalPrivateFile } from './atomic-file.js'
import { withLocalStateLease } from './local-state-lease.js'
import type { SecretProtector } from './secret-protector.js'

export const LOCAL_ENDPOINT_IDENTITY_KIND = 'metrora.local-endpoint-identity' as const
export const LOCAL_ENDPOINT_IDENTITY_SECRET_KIND = 'metrora.local-endpoint-identity-secret' as const
const SECRET_CONTEXT = 'dev.metrora.local-endpoint-identity.v1'
const METADATA_FILE = 'endpoint-identity.v1.json'
const SECRET_FILE = 'endpoint-identity.v1.secret'

const CanonicalBase64Schema = z.string().min(1).max(16_384).refine(value => {
  try { return Buffer.from(value, 'base64').toString('base64') === value } catch { return false }
}, 'must be canonical base64')

export const LocalEndpointIdentityMetadataV1Schema = z.strictObject({
  kind: z.literal(LOCAL_ENDPOINT_IDENTITY_KIND),
  version: ContractVersionSchema,
  endpointId: OpaqueIdSchema,
  generation: PositiveIntegerSchema,
  keyAlgorithm: z.literal('ed25519'),
  publicKeySpkiBase64: CanonicalBase64Schema,
  publicKeyFingerprintSha256: Sha256DigestSchema,
  eventIdentityKeyVersion: PositiveIntegerSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  rotatedAt: TimestampSchema.optional(),
})

const LocalEndpointIdentitySecretV1Schema = z.strictObject({
  kind: z.literal(LOCAL_ENDPOINT_IDENTITY_SECRET_KIND),
  version: ContractVersionSchema,
  endpointId: OpaqueIdSchema,
  generation: PositiveIntegerSchema,
  privateKeyPkcs8Base64: CanonicalBase64Schema,
  publicKeySpkiBase64: CanonicalBase64Schema,
  eventIdentityKeyBase64: CanonicalBase64Schema,
  eventIdentityKeyVersion: PositiveIntegerSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  rotatedAt: TimestampSchema.optional(),
})

export type LocalEndpointIdentityMetadataV1 = z.infer<typeof LocalEndpointIdentityMetadataV1Schema>
type LocalEndpointIdentitySecretV1 = z.infer<typeof LocalEndpointIdentitySecretV1Schema>

export type LoadedLocalEndpointIdentityV1 = {
  metadata: LocalEndpointIdentityMetadataV1
  privateKeyPkcs8: Uint8Array
  eventIdentityKey: Uint8Array
}

export type LocalEndpointIdentityStoreOptions = {
  protector: SecretProtector
  dataDir?: string
  now?: () => Date
  randomUUID?: () => string
  randomBytes?: (size: number) => Buffer
  generateEd25519?: () => { publicKeySpki: Buffer; privateKeyPkcs8: Buffer }
}

export class EndpointIdentityRecoveryRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EndpointIdentityRecoveryRequiredError'
  }
}

export function defaultMetroraDataDir(): string {
  if (process.env['METRORA_DATA_DIR'] !== undefined) return process.env['METRORA_DATA_DIR']!

  const canonical = platform() === 'win32'
    ? join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Metrora')
    : platform() === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Metrora')
      : join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'metrora')
  return canonical
}

function identityPaths(dataDir: string): { directory: string; metadata: string; secret: string } {
  const directory = join(dataDir, 'identity')
  return {
    directory,
    metadata: join(directory, METADATA_FILE),
    secret: join(directory, SECRET_FILE),
  }
}

function defaultGenerateEd25519(): { publicKeySpki: Buffer; privateKeyPkcs8: Buffer } {
  const pair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  })
  return { publicKeySpki: pair.publicKey, privateKeyPkcs8: pair.privateKey }
}

function fingerprint(publicKeySpki: Uint8Array): string {
  return createHash('sha256').update(publicKeySpki).digest('hex')
}

function materialFromSecret(secret: LocalEndpointIdentitySecretV1): LoadedLocalEndpointIdentityV1 {
  const privateKeyPkcs8 = Buffer.from(secret.privateKeyPkcs8Base64, 'base64')
  const publicKeySpki = Buffer.from(secret.publicKeySpkiBase64, 'base64')
  const eventIdentityKey = Buffer.from(secret.eventIdentityKeyBase64, 'base64')
  if (eventIdentityKey.byteLength !== 32) {
    throw new EndpointIdentityRecoveryRequiredError('endpoint event identity key must contain exactly 32 bytes')
  }

  let derivedPublic: Buffer
  try {
    const privateKey = createPrivateKey({ key: privateKeyPkcs8, type: 'pkcs8', format: 'der' })
    derivedPublic = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }) as Buffer
  } catch {
    throw new EndpointIdentityRecoveryRequiredError('endpoint private signing key is invalid')
  }
  if (derivedPublic.byteLength !== publicKeySpki.byteLength || !timingSafeEqual(derivedPublic, publicKeySpki)) {
    throw new EndpointIdentityRecoveryRequiredError('endpoint signing key pair does not match')
  }

  const metadata = LocalEndpointIdentityMetadataV1Schema.parse({
    kind: LOCAL_ENDPOINT_IDENTITY_KIND,
    version: 1,
    endpointId: secret.endpointId,
    generation: secret.generation,
    keyAlgorithm: 'ed25519',
    publicKeySpkiBase64: secret.publicKeySpkiBase64,
    publicKeyFingerprintSha256: fingerprint(publicKeySpki),
    eventIdentityKeyVersion: secret.eventIdentityKeyVersion,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
    ...(secret.rotatedAt ? { rotatedAt: secret.rotatedAt } : {}),
  })
  return {
    metadata,
    privateKeyPkcs8: Buffer.from(privateKeyPkcs8),
    eventIdentityKey: Buffer.from(eventIdentityKey),
  }
}

function metadataIsInterruptedOlderPublication(
  stored: LocalEndpointIdentityMetadataV1,
  derived: LocalEndpointIdentityMetadataV1,
): boolean {
  return stored.endpointId === derived.endpointId
    && stored.createdAt === derived.createdAt
    && stored.generation < derived.generation
    && stored.eventIdentityKeyVersion < derived.eventIdentityKeyVersion
    && derived.rotatedAt !== undefined
}

function metadataMatchesExactly(
  stored: LocalEndpointIdentityMetadataV1,
  derived: LocalEndpointIdentityMetadataV1,
): boolean {
  return JSON.stringify(stored) === JSON.stringify(derived)
}

async function decodeSecret(protector: SecretProtector, sealed: Uint8Array): Promise<LocalEndpointIdentitySecretV1> {
  let plaintext: Uint8Array
  try {
    plaintext = await protector.open(sealed, SECRET_CONTEXT)
  } catch (error) {
    throw new EndpointIdentityRecoveryRequiredError(
      `endpoint identity secret could not be decrypted: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    return LocalEndpointIdentitySecretV1Schema.parse(JSON.parse(Buffer.from(plaintext).toString('utf-8')))
  } catch {
    throw new EndpointIdentityRecoveryRequiredError('endpoint identity secret payload is invalid')
  }
}

async function persistIdentity(
  paths: { metadata: string; secret: string },
  protector: SecretProtector,
  secret: LocalEndpointIdentitySecretV1,
): Promise<LoadedLocalEndpointIdentityV1> {
  const loaded = materialFromSecret(secret)
  const sealed = await protector.seal(Buffer.from(JSON.stringify(secret), 'utf-8'), SECRET_CONTEXT)
  // Secret first: a crash can repair public metadata from the protected source.
  // The reverse order would leave apparently valid metadata with no key material.
  await atomicWritePrivateFile(paths.secret, sealed)
  await atomicWritePrivateFile(paths.metadata, JSON.stringify(loaded.metadata))
  return loaded
}

function generateSecret(
  options: Required<Pick<LocalEndpointIdentityStoreOptions, 'now' | 'randomUUID' | 'randomBytes' | 'generateEd25519'>>,
  previous?: LocalEndpointIdentitySecretV1,
): LocalEndpointIdentitySecretV1 {
  const timestamp = options.now().toISOString()
  const pair = options.generateEd25519()
  const eventIdentityKey = options.randomBytes(32)
  if (eventIdentityKey.byteLength !== 32) throw new Error('endpoint event key source returned the wrong size')
  const endpointId = previous?.endpointId ?? `ep_${options.randomUUID()}`
  return LocalEndpointIdentitySecretV1Schema.parse({
    kind: LOCAL_ENDPOINT_IDENTITY_SECRET_KIND,
    version: 1,
    endpointId,
    generation: (previous?.generation ?? 0) + 1,
    privateKeyPkcs8Base64: pair.privateKeyPkcs8.toString('base64'),
    publicKeySpkiBase64: pair.publicKeySpki.toString('base64'),
    eventIdentityKeyBase64: eventIdentityKey.toString('base64'),
    eventIdentityKeyVersion: (previous?.eventIdentityKeyVersion ?? 0) + 1,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    ...(previous ? { rotatedAt: timestamp } : {}),
  })
}

function resolvedOptions(options: LocalEndpointIdentityStoreOptions) {
  return {
    protector: options.protector,
    dataDir: options.dataDir ?? defaultMetroraDataDir(),
    now: options.now ?? (() => new Date()),
    randomUUID: options.randomUUID ?? randomUUID,
    randomBytes: options.randomBytes ?? randomBytes,
    generateEd25519: options.generateEd25519 ?? defaultGenerateEd25519,
  }
}

async function loadOrCreateUnlocked(
  resolved: ReturnType<typeof resolvedOptions>,
  paths: ReturnType<typeof identityPaths>,
): Promise<LoadedLocalEndpointIdentityV1> {
  const [metadataBytes, sealedSecret] = await Promise.all([
    readOptionalPrivateFile(paths.metadata),
    readOptionalPrivateFile(paths.secret),
  ])

  if (!metadataBytes && !sealedSecret) {
    return persistIdentity(paths, resolved.protector, generateSecret(resolved))
  }
  if (metadataBytes && !sealedSecret) {
    throw new EndpointIdentityRecoveryRequiredError('endpoint identity metadata exists but the protected secret is missing')
  }
  if (!sealedSecret) throw new EndpointIdentityRecoveryRequiredError('endpoint identity secret is missing')

  const secret = await decodeSecret(resolved.protector, sealedSecret)
  const loaded = materialFromSecret(secret)
  if (!metadataBytes) {
    await atomicWritePrivateFile(paths.metadata, JSON.stringify(loaded.metadata))
    return loaded
  }

  let metadata: LocalEndpointIdentityMetadataV1
  try {
    metadata = LocalEndpointIdentityMetadataV1Schema.parse(JSON.parse(metadataBytes.toString('utf-8')))
  } catch {
    throw new EndpointIdentityRecoveryRequiredError('endpoint identity metadata is invalid')
  }
  if (metadataMatchesExactly(metadata, loaded.metadata)) return loaded
  if (metadataIsInterruptedOlderPublication(metadata, loaded.metadata)) {
    await atomicWritePrivateFile(paths.metadata, JSON.stringify(loaded.metadata))
    return loaded
  }
  throw new EndpointIdentityRecoveryRequiredError('endpoint identity metadata does not match the protected secret')
}

export async function loadOrCreateLocalEndpointIdentityV1(
  options: LocalEndpointIdentityStoreOptions,
): Promise<LoadedLocalEndpointIdentityV1> {
  const resolved = resolvedOptions(options)
  const paths = identityPaths(resolved.dataDir)
  return withLocalStateLease(paths.directory, () => loadOrCreateUnlocked(resolved, paths))
}

export async function rotateLocalEndpointIdentityV1(
  options: LocalEndpointIdentityStoreOptions,
): Promise<LoadedLocalEndpointIdentityV1> {
  const resolved = resolvedOptions(options)
  const paths = identityPaths(resolved.dataDir)
  return withLocalStateLease(paths.directory, async () => {
    // Validate and repair current state before deriving a successor generation.
    await loadOrCreateUnlocked(resolved, paths)
    const sealedSecret = await readOptionalPrivateFile(paths.secret)
    if (!sealedSecret) {
      throw new EndpointIdentityRecoveryRequiredError('cannot rotate an endpoint identity without its protected secret')
    }
    const previous = await decodeSecret(resolved.protector, sealedSecret)
    return persistIdentity(paths, resolved.protector, generateSecret(resolved, previous))
  })
}

export function signWithLocalEndpointIdentityV1(
  identity: LoadedLocalEndpointIdentityV1,
  payload: Uint8Array,
): Uint8Array {
  const privateKey = createPrivateKey({ key: Buffer.from(identity.privateKeyPkcs8), type: 'pkcs8', format: 'der' })
  return sign(null, Buffer.from(payload), privateKey)
}

export function verifyLocalEndpointIdentitySignatureV1(
  metadata: LocalEndpointIdentityMetadataV1,
  payload: Uint8Array,
  signature: Uint8Array,
): boolean {
  const publicKey = createPublicKey({
    key: Buffer.from(metadata.publicKeySpkiBase64, 'base64'),
    type: 'spki',
    format: 'der',
  })
  return verify(null, Buffer.from(payload), publicKey, Buffer.from(signature))
}
