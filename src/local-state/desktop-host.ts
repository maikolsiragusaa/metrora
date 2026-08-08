import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import * as z from 'zod/v4'

import { TimestampSchema } from '../contracts/v1/common.js'
import {
  EndpointArchitectureSchema,
  EndpointCapabilitySchema,
  EndpointOsSchema,
  type EndpointCapabilityV1,
} from '../contracts/v1/endpoint.js'
import { atomicWritePrivateFile, readOptionalPrivateFile } from './atomic-file.js'
import {
  defaultMetroraDataDir,
  loadOrCreateLocalEndpointIdentityV1,
  type LoadedLocalEndpointIdentityV1,
  type LocalEndpointIdentityMetadataV1,
} from './endpoint-identity.js'
import { withLocalStateLease } from './local-state-lease.js'
import {
  attachDesktopReviewedProductionV1,
  type DesktopCanonicalReviewedScannerV1,
  type DesktopReviewedProductionRuntimeV1,
} from './desktop-reviewed-production-runtime.js'
import { Aes256GcmSecretProtector } from './secret-protector.js'
import { createDesktopWorkspaceRuntimeV1 } from './desktop-workspace-runtime.js'

export const DESKTOP_MASTER_KEY_KIND = 'metrora.desktop-master-key' as const
const MASTER_KEY_FILE = 'desktop-master-key.v1.json'

export const DesktopVaultBackendV1Schema = z.enum(['windows-dpapi', 'macos-keychain'])

const DesktopMasterKeyEnvelopeV1Schema = z.strictObject({
  kind: z.literal(DESKTOP_MASTER_KEY_KIND),
  version: z.literal(1),
  backend: DesktopVaultBackendV1Schema,
  ciphertextBase64: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type DesktopVaultBackendV1 = z.infer<typeof DesktopVaultBackendV1Schema>
export type DesktopMasterKeyStateV1 = 'created' | 'loaded' | 'rewrapped'

export interface DesktopSafeStorageProvider {
  isAvailable(): Promise<boolean>
  encryptString(plaintext: string): Promise<Uint8Array>
  decryptString(ciphertext: Uint8Array): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export type InitializeDesktopLocalStateV1Options = {
  safeStorage: DesktopSafeStorageProvider
  backend: DesktopVaultBackendV1
  dataDir?: string
  now?: () => Date
  randomBytes?: (size: number) => Buffer
}

export type InitializeDesktopWorkspaceRuntimeV1Options = InitializeDesktopLocalStateV1Options & {
  platform: {
    os: z.infer<typeof EndpointOsSchema>
    architecture: z.infer<typeof EndpointArchitectureSchema>
  }
  metroraVersion: string
  collectorVersion: string
  capabilities?: EndpointCapabilityV1[]
  openTelemetryGenAiVersion?: string
  scanCanonicalCandidates?: DesktopCanonicalReviewedScannerV1
}

export type InitializedDesktopLocalStateV1 = {
  endpoint: LocalEndpointIdentityMetadataV1
  masterKeyState: DesktopMasterKeyStateV1
  backend: DesktopVaultBackendV1
}

export type InitializedDesktopWorkspaceRuntimeV1 = InitializedDesktopLocalStateV1 & {
  runtime: DesktopReviewedProductionRuntimeV1
}

export class DesktopVaultUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesktopVaultUnavailableError'
  }
}

function decodeMasterKey(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.byteLength !== 32 || decoded.toString('base64') !== value) {
    throw new DesktopVaultUnavailableError('desktop vault returned an invalid master key')
  }
  return decoded
}

function parseEnvelope(bytes: Uint8Array): z.infer<typeof DesktopMasterKeyEnvelopeV1Schema> {
  try {
    const envelope = DesktopMasterKeyEnvelopeV1Schema.parse(JSON.parse(Buffer.from(bytes).toString('utf-8')))
    const ciphertext = Buffer.from(envelope.ciphertextBase64, 'base64')
    if (ciphertext.byteLength === 0 || ciphertext.toString('base64') !== envelope.ciphertextBase64) {
      throw new Error('ciphertext is not canonical base64')
    }
    return envelope
  } catch (error) {
    throw new DesktopVaultUnavailableError(
      `desktop master-key envelope is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function requireVault(provider: DesktopSafeStorageProvider): Promise<void> {
  let available = false
  try { available = await provider.isAvailable() } catch { /* normalized below */ }
  if (!available) throw new DesktopVaultUnavailableError('OS-backed desktop encryption is unavailable')
}

async function loadOrCreateMasterKey(
  options: Required<Pick<InitializeDesktopLocalStateV1Options, 'safeStorage' | 'backend' | 'now' | 'randomBytes'>> & { dataDir: string },
): Promise<{ key: Buffer; state: DesktopMasterKeyStateV1 }> {
  const hostDir = join(options.dataDir, 'host-secrets')
  const keyPath = join(hostDir, MASTER_KEY_FILE)

  return withLocalStateLease(hostDir, async () => {
    await requireVault(options.safeStorage)
    const existingBytes = await readOptionalPrivateFile(keyPath)
    if (!existingBytes) {
      const key = options.randomBytes(32)
      if (key.byteLength !== 32) throw new Error('desktop master-key source returned the wrong size')
      const plaintext = key.toString('base64')
      const ciphertext = Buffer.from(await options.safeStorage.encryptString(plaintext))
      if (ciphertext.byteLength === 0) throw new DesktopVaultUnavailableError('OS vault returned empty ciphertext')
      const timestamp = options.now().toISOString()
      const envelope = DesktopMasterKeyEnvelopeV1Schema.parse({
        kind: DESKTOP_MASTER_KEY_KIND,
        version: 1,
        backend: options.backend,
        ciphertextBase64: ciphertext.toString('base64'),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      await atomicWritePrivateFile(keyPath, JSON.stringify(envelope))
      return { key: Buffer.from(key), state: 'created' as const }
    }

    const envelope = parseEnvelope(existingBytes)
    if (envelope.backend !== options.backend) {
      throw new DesktopVaultUnavailableError(
        `desktop master key belongs to ${envelope.backend}, not ${options.backend}`,
      )
    }

    const ciphertext = Buffer.from(envelope.ciphertextBase64, 'base64')
    let decrypted: { result: string; shouldReEncrypt: boolean }
    try {
      decrypted = await options.safeStorage.decryptString(ciphertext)
    } catch (error) {
      throw new DesktopVaultUnavailableError(
        `desktop master key could not be decrypted: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const key = decodeMasterKey(decrypted.result)
    if (!decrypted.shouldReEncrypt) return { key, state: 'loaded' as const }

    const rewrapped = Buffer.from(await options.safeStorage.encryptString(decrypted.result))
    if (rewrapped.byteLength === 0) throw new DesktopVaultUnavailableError('OS vault returned empty rewrapped ciphertext')
    const updated = DesktopMasterKeyEnvelopeV1Schema.parse({
      ...envelope,
      ciphertextBase64: rewrapped.toString('base64'),
      updatedAt: options.now().toISOString(),
    })
    await atomicWritePrivateFile(keyPath, JSON.stringify(updated))
    return { key, state: 'rewrapped' as const }
  })
}

function normalizeBaseOptions(input: InitializeDesktopLocalStateV1Options) {
  return {
    safeStorage: input.safeStorage,
    backend: DesktopVaultBackendV1Schema.parse(input.backend),
    dataDir: input.dataDir ?? defaultMetroraDataDir(),
    now: input.now ?? (() => new Date()),
    randomBytes: input.randomBytes ?? randomBytes,
  }
}

function disposeLoadedIdentity(identity: LoadedLocalEndpointIdentityV1 | undefined): void {
  identity?.privateKeyPkcs8.fill(0)
  identity?.eventIdentityKey.fill(0)
}

export async function initializeDesktopLocalStateV1(
  input: InitializeDesktopLocalStateV1Options,
): Promise<InitializedDesktopLocalStateV1> {
  const options = normalizeBaseOptions(input)
  const master = await loadOrCreateMasterKey(options)
  let identity: LoadedLocalEndpointIdentityV1 | undefined
  try {
    identity = await loadOrCreateLocalEndpointIdentityV1({
      dataDir: options.dataDir,
      protector: new Aes256GcmSecretProtector(master.key),
      now: options.now,
    })
    return {
      endpoint: identity.metadata,
      masterKeyState: master.state,
      backend: options.backend,
    }
  } finally {
    master.key.fill(0)
    disposeLoadedIdentity(identity)
  }
}

export async function initializeDesktopWorkspaceRuntimeV1(
  input: InitializeDesktopWorkspaceRuntimeV1Options,
): Promise<InitializedDesktopWorkspaceRuntimeV1> {
  const options = normalizeBaseOptions(input)
  const platform = z.strictObject({
    os: EndpointOsSchema,
    architecture: EndpointArchitectureSchema,
  }).parse(input.platform)
  const capabilities = z.array(EndpointCapabilitySchema).min(1).max(8).parse(
    input.capabilities ?? ['collect', 'normalize', 'aggregate', 'serve-local-api'],
  )
  const metroraVersion = z.string().trim().min(1).max(64).parse(input.metroraVersion)
  const collectorVersion = z.string().trim().min(1).max(64).parse(input.collectorVersion)
  const master = await loadOrCreateMasterKey(options)
  let identity: LoadedLocalEndpointIdentityV1 | undefined
  try {
    identity = await loadOrCreateLocalEndpointIdentityV1({
      dataDir: options.dataDir,
      protector: new Aes256GcmSecretProtector(master.key),
      now: options.now,
    })
    const endpoint = identity.metadata
    const workspaceRuntime = createDesktopWorkspaceRuntimeV1({
      dataDir: options.dataDir,
      identity,
      platform,
      metroraVersion,
      collectorVersion,
      capabilities,
      ...(input.openTelemetryGenAiVersion !== undefined
        ? { openTelemetryGenAiVersion: input.openTelemetryGenAiVersion }
        : {}),
      now: options.now,
    })
    const runtime = attachDesktopReviewedProductionV1({
      runtime: workspaceRuntime,
      dataDir: options.dataDir,
      identity,
      adapterVersion: metroraVersion,
      ...(input.scanCanonicalCandidates !== undefined
        ? { scanCanonicalCandidates: input.scanCanonicalCandidates }
        : {}),
      now: options.now,
    })
    identity = undefined // private buffers are now owned exclusively by runtime.dispose()
    return {
      endpoint,
      masterKeyState: master.state,
      backend: options.backend,
      runtime,
    }
  } finally {
    master.key.fill(0)
    disposeLoadedIdentity(identity)
  }
}
