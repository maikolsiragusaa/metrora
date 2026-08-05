import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  collectPayloadInventory,
  readJsonFile,
  serializeInventory,
  sha256File,
  sha256Text,
  stableJson,
  summarizeInventory,
  verifyReleaseCandidate,
} from './windows-release-manifest-lib.mjs'
import { readReleaseSourceBytes } from './windows-release-source.mjs'

export const FORMAT_DERIVATION_KIND = 'metrora.windows-format-derivation'
export const FORMAT_DERIVATION_VERSION = 1

const SOURCE_SCHEMA_PATH = 'release/windows-format-derivation.v1.schema.json'
const CANONICAL_INVENTORY_FILE = 'CANONICAL_PRODUCT_PAYLOAD.jsonl'
const DERIVATION_SCHEMA_FILE = 'FORMAT_DERIVATION.schema.json'
const DERIVATION_MANIFEST_FILE = 'FORMAT_DERIVATION.json'
const DERIVATION_CHECKSUM_FILE = 'FORMAT_SHA256SUMS.txt'

const portableExtraFiles = Object.freeze([
  'README.txt',
  'Run-Metrora-Baseline.cmd',
  'Run-Metrora-Baseline.ps1',
])

const sha256Pattern = /^[a-f0-9]{64}$/
const gitSha1Pattern = /^[a-f0-9]{40}$/

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function candidatePaths(candidateDirectory) {
  const root = resolve(candidateDirectory)
  return {
    root,
    portable: join(root, 'portable'),
    installer: join(root, 'installer'),
    canonicalInventory: join(root, CANONICAL_INVENTORY_FILE),
    schema: join(root, DERIVATION_SCHEMA_FILE),
    manifest: join(root, DERIVATION_MANIFEST_FILE),
    checksums: join(root, DERIVATION_CHECKSUM_FILE),
  }
}

function parseInventory(text) {
  const entries = []
  const seen = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const raw = JSON.parse(line)
    if (
      !raw
      || typeof raw.path !== 'string'
      || !raw.path
      || raw.path.startsWith('/')
      || raw.path.includes('\\')
      || raw.path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
      || /[\r\n\0]/.test(raw.path)
      || !Number.isSafeInteger(raw.size)
      || raw.size < 0
      || !sha256Pattern.test(raw.sha256)
    ) {
      throw new Error('canonical product payload inventory contains an invalid entry')
    }
    if (seen.has(raw.path)) {
      throw new Error(`canonical product payload inventory contains duplicate path: ${raw.path}`)
    }
    seen.add(raw.path)
    entries.push({ path: raw.path, size: raw.size, sha256: raw.sha256 })
  }
  if (entries.length === 0) throw new Error('canonical product payload inventory is empty')

  const sorted = [...entries].sort((left, right) => compareText(left.path, right.path))
  if (JSON.stringify(entries) !== JSON.stringify(sorted)) {
    throw new Error('canonical product payload inventory is not sorted canonically')
  }
  return entries
}

function assertSameInventory(expected, actual, label) {
  if (expected.length !== actual.length) {
    throw new Error(`${label} file count does not match the canonical product payload`)
  }
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index]
    const right = actual[index]
    if (
      left.path !== right.path
      || left.size !== right.size
      || left.sha256 !== right.sha256
    ) {
      throw new Error(`${label} does not match canonical product payload: ${left.path}`)
    }
  }
}

function assertPortableDerivation(canonical, portable) {
  const canonicalByPath = new Map(canonical.map(entry => [entry.path, entry]))
  const extras = []

  for (const entry of portable) {
    const expected = canonicalByPath.get(entry.path)
    if (!expected) {
      extras.push(entry.path)
      continue
    }
    if (entry.size !== expected.size || entry.sha256 !== expected.sha256) {
      throw new Error(`portable changed canonical product file: ${entry.path}`)
    }
    canonicalByPath.delete(entry.path)
  }

  if (canonicalByPath.size > 0) {
    throw new Error(`portable is missing canonical product file: ${canonicalByPath.keys().next().value}`)
  }

  extras.sort(compareText)
  if (JSON.stringify(extras) !== JSON.stringify(portableExtraFiles)) {
    throw new Error(`portable extra-file set is invalid: ${extras.join(', ')}`)
  }
  return extras
}

function assertInstallerInventory(inventory) {
  if (inventory.length === 0) throw new Error('installer directory is empty')
  let executableCount = 0
  for (const entry of inventory) {
    if (!/\.(exe|blockmap)$/.test(entry.path)) {
      throw new Error(`installer directory contains unsupported output: ${entry.path}`)
    }
    if (/\.exe$/.test(entry.path)) {
      executableCount += 1
      if (!/^Metrora-Setup-[^/]+\.exe$/.test(entry.path)) {
        throw new Error(`installer executable name is not canonical: ${entry.path}`)
      }
    }
    if (entry.size < 1) throw new Error(`installer output is empty: ${entry.path}`)
  }
  if (executableCount !== 1) {
    throw new Error('installer directory must contain exactly one Metrora setup executable')
  }
}

function requireManifestShape(manifest) {
  if (manifest.kind !== FORMAT_DERIVATION_KIND || manifest.version !== FORMAT_DERIVATION_VERSION) {
    throw new Error('Windows format derivation manifest kind or version is unsupported')
  }
  if (
    manifest.schema?.file !== DERIVATION_SCHEMA_FILE
    || !sha256Pattern.test(manifest.schema?.sha256)
    || manifest.source?.repository !== 'maikolsiragusaa/metrora'
    || !gitSha1Pattern.test(manifest.source?.commit)
  ) {
    throw new Error('Windows format derivation source or schema metadata is invalid')
  }
  if (
    manifest.product?.name !== 'Metrora'
    || manifest.product?.publisher !== 'Vensent'
    || manifest.product?.appId !== 'eu.metrora.desktop'
    || typeof manifest.product?.version !== 'string'
    || !manifest.product.version
    || manifest.product?.visualIdentity !== 'Signal Grid v1'
  ) {
    throw new Error('Windows format derivation product identity is invalid')
  }
  if (
    manifest.canonicalPayload?.directory !== 'win-unpacked'
    || manifest.canonicalPayload?.inventoryFile !== CANONICAL_INVENTORY_FILE
    || !Number.isSafeInteger(manifest.canonicalPayload?.fileCount)
    || manifest.canonicalPayload.fileCount < 1
    || !Number.isSafeInteger(manifest.canonicalPayload?.totalBytes)
    || manifest.canonicalPayload.totalBytes < 1
    || !sha256Pattern.test(manifest.canonicalPayload?.inventorySha256)
  ) {
    throw new Error('canonical product payload metadata is invalid')
  }
  if (
    manifest.portable?.directory !== 'portable'
    || manifest.portable?.releaseManifestFile !== 'portable/RELEASE_MANIFEST.json'
    || !sha256Pattern.test(manifest.portable?.releaseManifestSha256)
    || manifest.portable?.canonicalPayloadMatch !== true
    || JSON.stringify(manifest.portable?.extraFiles) !== JSON.stringify(portableExtraFiles)
  ) {
    throw new Error('portable derivation metadata is invalid')
  }
  if (
    manifest.installer?.directory !== 'installer'
    || manifest.installer?.method !== 'electron-builder-prepackaged-nsis'
    || manifest.installer?.unsigned !== true
    || !Array.isArray(manifest.installer?.files)
  ) {
    throw new Error('installer derivation metadata is invalid')
  }
  if (
    manifest.reproducibility?.canonicalPayloadBuiltOnce !== true
    || manifest.reproducibility?.formatDerivationVerified !== true
    || manifest.reproducibility?.installerByteReproducibilityProven !== false
  ) {
    throw new Error('Windows format derivation makes an unsupported reproducibility claim')
  }
}

async function writeMetadataChecksums(paths) {
  const files = [
    CANONICAL_INVENTORY_FILE,
    DERIVATION_MANIFEST_FILE,
    DERIVATION_SCHEMA_FILE,
  ].sort(compareText)
  const lines = []
  for (const file of files) {
    lines.push(`${await sha256File(join(paths.root, file))}  ${file}`)
  }
  await writeFile(paths.checksums, `${lines.join('\n')}\n`, 'ascii')
}

async function verifyMetadataChecksums(paths) {
  const text = await readFile(paths.checksums, 'ascii')
  const expected = new Map()
  for (const line of text.trimEnd().split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})  ([^\r\n]+)$/)
    if (!match || expected.has(match[2])) throw new Error('format metadata checksum file is invalid')
    expected.set(match[2], match[1])
  }
  const required = [CANONICAL_INVENTORY_FILE, DERIVATION_MANIFEST_FILE, DERIVATION_SCHEMA_FILE]
  if (expected.size !== required.length || required.some(file => !expected.has(file))) {
    throw new Error('format metadata checksum file is incomplete')
  }
  for (const [file, digest] of expected) {
    if (await sha256File(join(paths.root, file)) !== digest) {
      throw new Error(`format metadata checksum mismatch: ${file}`)
    }
  }
}

export async function prepareWindowsCandidateLayout(options) {
  const payloadDirectory = resolve(options.payloadDirectory)
  const paths = candidatePaths(options.candidateDirectory)
  await rm(paths.root, { recursive: true, force: true })
  await mkdir(paths.root, { recursive: true })
  await mkdir(paths.installer, { recursive: true })
  await cp(payloadDirectory, paths.portable, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  })

  const inventory = await collectPayloadInventory(payloadDirectory)
  await writeFile(paths.canonicalInventory, serializeInventory(inventory), 'utf8')
  return summarizeInventory(inventory)
}

export async function finalizeWindowsCandidateLayout(options) {
  const payloadDirectory = resolve(options.payloadDirectory)
  const paths = candidatePaths(options.candidateDirectory)
  const canonicalText = await readFile(paths.canonicalInventory, 'utf8')
  const canonical = parseInventory(canonicalText)
  const canonicalSummary = summarizeInventory(canonical, canonicalText)
  const currentPayload = await collectPayloadInventory(payloadDirectory)
  assertSameInventory(canonical, currentPayload, 'prepackaged installer source')

  const portableInventory = await collectPayloadInventory(paths.portable)
  const extras = assertPortableDerivation(canonical, portableInventory)
  const portableVerification = await verifyReleaseCandidate(paths.portable, {
    repositoryRoot: options.repositoryRoot,
    expectedCommit: options.expectedCommit,
    sourceFileMode: options.sourceFileMode,
  })
  const portableReleaseManifestSha256 = await sha256File(join(paths.portable, 'RELEASE_MANIFEST.json'))

  const installerInventory = await collectPayloadInventory(paths.installer)
  assertInstallerInventory(installerInventory)

  const schemaBytes = await readReleaseSourceBytes({
    repositoryRoot: options.repositoryRoot,
    sourceCommit: options.expectedCommit,
    sourceFileMode: options.sourceFileMode,
  }, SOURCE_SCHEMA_PATH)
  await writeFile(paths.schema, schemaBytes)

  const manifest = {
    kind: FORMAT_DERIVATION_KIND,
    version: FORMAT_DERIVATION_VERSION,
    schema: {
      file: DERIVATION_SCHEMA_FILE,
      sha256: sha256Text(schemaBytes),
    },
    source: {
      repository: 'maikolsiragusaa/metrora',
      commit: portableVerification.sourceCommit,
    },
    product: {
      name: 'Metrora',
      publisher: 'Vensent',
      appId: 'eu.metrora.desktop',
      version: portableVerification.productVersion,
      visualIdentity: 'Signal Grid v1',
    },
    canonicalPayload: {
      directory: 'win-unpacked',
      inventoryFile: CANONICAL_INVENTORY_FILE,
      ...canonicalSummary,
    },
    portable: {
      directory: 'portable',
      releaseManifestFile: 'portable/RELEASE_MANIFEST.json',
      releaseManifestSha256: portableReleaseManifestSha256,
      canonicalPayloadMatch: true,
      extraFiles: extras,
    },
    installer: {
      directory: 'installer',
      method: 'electron-builder-prepackaged-nsis',
      unsigned: true,
      files: installerInventory,
    },
    reproducibility: {
      canonicalPayloadBuiltOnce: true,
      formatDerivationVerified: true,
      installerByteReproducibilityProven: false,
      note: 'Portable and NSIS are derived from one verified unpacked payload; byte-for-byte NSIS reproducibility is not yet claimed.',
    },
  }
  await writeFile(paths.manifest, stableJson(manifest), 'utf8')
  await writeMetadataChecksums(paths)
  return verifyWindowsCandidateLayout(options)
}

export async function verifyWindowsCandidateLayout(options) {
  const paths = candidatePaths(options.candidateDirectory)
  const manifest = await readJsonFile(paths.manifest)
  requireManifestShape(manifest)
  if (options.expectedCommit && manifest.source.commit !== options.expectedCommit) {
    throw new Error('Windows format derivation source commit does not match the expected commit')
  }

  const schemaBytes = await readReleaseSourceBytes({
    repositoryRoot: options.repositoryRoot,
    sourceCommit: manifest.source.commit,
    sourceFileMode: options.sourceFileMode,
  }, SOURCE_SCHEMA_PATH)
  if (
    sha256Text(schemaBytes) !== manifest.schema.sha256
    || await sha256File(paths.schema) !== manifest.schema.sha256
  ) {
    throw new Error('Windows format derivation schema does not match the source commit')
  }

  const canonicalText = await readFile(paths.canonicalInventory, 'utf8')
  const canonical = parseInventory(canonicalText)
  const canonicalSummary = summarizeInventory(canonical, canonicalText)
  if (
    canonical.length !== manifest.canonicalPayload.fileCount
    || canonicalSummary.totalBytes !== manifest.canonicalPayload.totalBytes
    || canonicalSummary.inventorySha256 !== manifest.canonicalPayload.inventorySha256
  ) {
    throw new Error('canonical product payload summary does not match its inventory')
  }

  const portableInventory = await collectPayloadInventory(paths.portable)
  assertPortableDerivation(canonical, portableInventory)
  const portableVerification = await verifyReleaseCandidate(paths.portable, {
    repositoryRoot: options.repositoryRoot,
    expectedCommit: manifest.source.commit,
    sourceFileMode: options.sourceFileMode,
  })
  if (
    portableVerification.productVersion !== manifest.product.version
    || await sha256File(join(paths.portable, 'RELEASE_MANIFEST.json')) !== manifest.portable.releaseManifestSha256
  ) {
    throw new Error('portable derivation does not match the format manifest')
  }

  const installerInventory = await collectPayloadInventory(paths.installer)
  assertInstallerInventory(installerInventory)
  if (JSON.stringify(installerInventory) !== JSON.stringify(manifest.installer.files)) {
    throw new Error('installer outputs do not match the format manifest')
  }

  await verifyMetadataChecksums(paths)
  return {
    productVersion: manifest.product.version,
    sourceCommit: manifest.source.commit,
    canonicalFileCount: manifest.canonicalPayload.fileCount,
    installerFiles: manifest.installer.files.map(file => file.path),
    formatManifestSha256: await sha256File(paths.manifest),
  }
}
