import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const RELEASE_MANIFEST_KIND = 'metrora.windows-release-candidate-manifest'
export const RELEASE_MANIFEST_VERSION = 1
export const RELEASE_ATTESTATION_KIND = 'metrora.windows-release-build-attestation'
export const RELEASE_ATTESTATION_VERSION = 1

export const RELEASE_METADATA_FILES = Object.freeze([
  'BUILD_ATTESTATION.json',
  'PAYLOAD_MANIFEST.jsonl',
  'RELEASE_MANIFEST.json',
  'RELEASE_MANIFEST.schema.json',
  'SHA256SUMS.txt',
])

const metadataFileSet = new Set(RELEASE_METADATA_FILES)
const sha256Pattern = /^[a-f0-9]{64}$/

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function normalizeManifestPath(value) {
  const normalized = String(value).replaceAll('\\', '/')
  if (
    !normalized
    || normalized.startsWith('/')
    || isAbsolute(normalized)
    || normalized.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
    || /[\r\n\0]/.test(normalized)
  ) {
    throw new Error(`invalid release manifest path: ${value}`)
  }
  return normalized
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  await new Promise((accept, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', accept)
  })
  return hash.digest('hex')
}

export function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function walkFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const files = []

  for (const entry of entries) {
    const absolute = join(directory, entry.name)
    const manifestPath = normalizeManifestPath(relative(root, absolute).split(sep).join('/'))
    if (directory === root && metadataFileSet.has(manifestPath)) continue

    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, absolute))
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`release candidate contains unsupported filesystem entry: ${manifestPath}`)
    }
    files.push({ absolute, path: manifestPath })
  }

  return files
}

export async function collectPayloadInventory(bundleDirectory) {
  const root = resolve(bundleDirectory)
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error('release candidate bundle must be a directory')

  const files = await walkFiles(root)
  const inventory = []
  for (const file of files) {
    const fileInfo = await stat(file.absolute)
    inventory.push({
      path: file.path,
      size: fileInfo.size,
      sha256: await sha256File(file.absolute),
    })
  }
  inventory.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  return inventory
}

export function serializeInventory(inventory) {
  return inventory.map(entry => `${JSON.stringify(entry)}\n`).join('')
}

export function summarizeInventory(inventory, serialized = serializeInventory(inventory)) {
  return {
    fileCount: inventory.length,
    totalBytes: inventory.reduce((sum, entry) => sum + entry.size, 0),
    inventorySha256: sha256Text(serialized),
  }
}

export async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function hashInputFiles(repositoryRoot, paths) {
  const result = {}
  for (const input of [...paths].sort((left, right) => left.localeCompare(right, 'en'))) {
    const normalized = normalizeManifestPath(input)
    result[normalized] = await sha256File(join(repositoryRoot, ...normalized.split('/')))
  }
  return result
}

function packageVersion(lock, packageName) {
  const version = lock?.packages?.[`node_modules/${packageName}`]?.version
  if (typeof version !== 'string' || !version) {
    throw new Error(`package-lock is missing an exact ${packageName} version`)
  }
  return version
}

export async function buildReleaseManifest(options) {
  const repositoryRoot = resolve(options.repositoryRoot)
  const appPackagePath = join(repositoryRoot, 'app', 'package.json')
  const appLockPath = join(repositoryRoot, 'app', 'package-lock.json')
  const appPackage = await readJsonFile(appPackagePath)
  const appLock = await readJsonFile(appLockPath)
  const sourceDateEpoch = Number(options.sourceDateEpoch)

  if (!/^[a-f0-9]{40}$/.test(options.sourceCommit)) {
    throw new Error('source commit must be a lowercase 40-character SHA-1')
  }
  if (!/^[a-f0-9]{40}$/.test(options.sourceTree)) {
    throw new Error('source tree must be a lowercase 40-character SHA-1')
  }
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 0) {
    throw new Error('source date epoch must be a non-negative safe integer')
  }
  if (appPackage.name !== 'metrora-desktop' || appPackage.build?.appId !== 'eu.metrora.desktop') {
    throw new Error('desktop package identity is not canonical Metrora')
  }

  const inventoryText = serializeInventory(options.inventory)
  const inventorySummary = summarizeInventory(options.inventory, inventoryText)
  const schemaSha256 = await sha256File(options.schemaPath)
  const inputFiles = await hashInputFiles(repositoryRoot, options.inputFiles)

  return {
    kind: RELEASE_MANIFEST_KIND,
    version: RELEASE_MANIFEST_VERSION,
    schema: {
      file: 'RELEASE_MANIFEST.schema.json',
      sha256: schemaSha256,
    },
    product: {
      name: appPackage.build.productName,
      packageName: appPackage.name,
      appId: appPackage.build.appId,
      version: appPackage.version,
      homepage: appPackage.homepage,
      visualIdentity: {
        name: 'Signal Grid',
        version: '1.0',
      },
    },
    source: {
      repository: 'maikolsiragusaa/metrora',
      commit: options.sourceCommit,
      tree: options.sourceTree,
      sourceDateEpoch,
    },
    build: {
      target: 'windows-x64',
      artifactType: 'portable-directory',
      distribution: options.distribution,
      node: process.version,
      electron: packageVersion(appLock, 'electron'),
      electronBuilder: packageVersion(appLock, 'electron-builder'),
      inputFiles,
    },
    reproducibility: {
      level: 'content-addressed-candidate',
      payloadFullyInventoried: true,
      byteForByteArchiveProven: false,
      note: 'Payload contents and build inputs are deterministic and independently verifiable; byte-for-byte Electron/NSIS/archive reproduction is not yet claimed.',
    },
    payload: {
      inventoryFile: 'PAYLOAD_MANIFEST.jsonl',
      ...inventorySummary,
    },
  }
}

export function buildAttestation(options) {
  if (!sha256Pattern.test(options.manifestSha256)) {
    throw new Error('manifest SHA-256 is invalid')
  }
  return {
    kind: RELEASE_ATTESTATION_KIND,
    version: RELEASE_ATTESTATION_VERSION,
    manifestSha256: options.manifestSha256,
    provider: options.provider,
    workflow: options.workflow,
    runId: String(options.runId),
    runAttempt: String(options.runAttempt),
    ref: options.ref,
    builtAt: new Date(options.builtAt).toISOString(),
    runner: {
      os: options.runnerOs,
      image: options.runnerImage,
    },
  }
}

export async function writeChecksums(bundleDirectory, fileNames) {
  const lines = []
  for (const fileName of [...fileNames].sort((left, right) => left.localeCompare(right, 'en'))) {
    const normalized = normalizeManifestPath(fileName)
    lines.push(`${await sha256File(join(bundleDirectory, normalized))}  ${normalized}`)
  }
  await writeFile(join(bundleDirectory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'ascii')
}

export async function writeReleaseMetadata(options) {
  const bundleDirectory = resolve(options.bundleDirectory)
  const schemaDestination = join(bundleDirectory, 'RELEASE_MANIFEST.schema.json')
  await mkdir(dirname(schemaDestination), { recursive: true })
  await copyFile(options.schemaPath, schemaDestination)

  const inventory = await collectPayloadInventory(bundleDirectory)
  const inventoryText = serializeInventory(inventory)
  const manifest = await buildReleaseManifest({ ...options, inventory })
  const manifestText = stableJson(manifest)

  await writeFile(join(bundleDirectory, 'PAYLOAD_MANIFEST.jsonl'), inventoryText, 'utf8')
  await writeFile(join(bundleDirectory, 'RELEASE_MANIFEST.json'), manifestText, 'utf8')

  const attestation = buildAttestation({
    ...options.attestation,
    manifestSha256: sha256Text(manifestText),
  })
  await writeFile(join(bundleDirectory, 'BUILD_ATTESTATION.json'), stableJson(attestation), 'utf8')
  await writeChecksums(bundleDirectory, [
    'BUILD_ATTESTATION.json',
    'PAYLOAD_MANIFEST.jsonl',
    'RELEASE_MANIFEST.json',
    'RELEASE_MANIFEST.schema.json',
  ])

  return { manifest, attestation }
}

function parseInventory(text) {
  const entries = []
  const seen = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const entry = JSON.parse(line)
    const path = normalizeManifestPath(entry.path)
    if (seen.has(path)) throw new Error(`payload inventory contains duplicate path: ${path}`)
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !sha256Pattern.test(entry.sha256)) {
      throw new Error(`payload inventory entry is invalid: ${path}`)
    }
    seen.add(path)
    entries.push({ path, size: entry.size, sha256: entry.sha256 })
  }
  const sorted = [...entries].sort((left, right) => left.path.localeCompare(right.path, 'en'))
  if (JSON.stringify(entries) !== JSON.stringify(sorted)) {
    throw new Error('payload inventory is not sorted canonically')
  }
  return entries
}

function assertBundlePath(bundleDirectory, manifestPath) {
  const root = resolve(bundleDirectory)
  const absolute = resolve(root, ...manifestPath.split('/'))
  const traversal = relative(root, absolute)
  if (traversal.startsWith('..') || isAbsolute(traversal)) {
    throw new Error(`payload inventory escapes bundle: ${manifestPath}`)
  }
  return absolute
}

async function verifyChecksums(bundleDirectory) {
  const text = await readFile(join(bundleDirectory, 'SHA256SUMS.txt'), 'ascii')
  const expected = new Map()
  for (const line of text.trimEnd().split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})  ([^\r\n]+)$/)
    if (!match) throw new Error(`invalid SHA256SUMS line: ${line}`)
    const name = normalizeManifestPath(match[2])
    if (expected.has(name)) throw new Error(`duplicate SHA256SUMS path: ${name}`)
    expected.set(name, match[1])
  }
  const required = RELEASE_METADATA_FILES.filter(name => name !== 'SHA256SUMS.txt')
  if (expected.size !== required.length || required.some(name => !expected.has(name))) {
    throw new Error('SHA256SUMS does not contain the exact release metadata set')
  }
  for (const [name, digest] of expected) {
    if (await sha256File(join(bundleDirectory, name)) !== digest) {
      throw new Error(`release metadata checksum mismatch: ${name}`)
    }
  }
}

export async function verifyReleaseCandidate(bundleDirectory, options = {}) {
  const root = resolve(bundleDirectory)
  const manifestText = await readFile(join(root, 'RELEASE_MANIFEST.json'), 'utf8')
  const manifest = JSON.parse(manifestText)
  const attestation = await readJsonFile(join(root, 'BUILD_ATTESTATION.json'))
  const inventoryText = await readFile(join(root, 'PAYLOAD_MANIFEST.jsonl'), 'utf8')
  const inventory = parseInventory(inventoryText)

  if (manifest.kind !== RELEASE_MANIFEST_KIND || manifest.version !== RELEASE_MANIFEST_VERSION) {
    throw new Error('release manifest kind or version is unsupported')
  }
  if (manifest.product?.name !== 'Metrora' || manifest.product?.appId !== 'eu.metrora.desktop') {
    throw new Error('release manifest product identity is not canonical Metrora')
  }
  if (options.expectedCommit && manifest.source?.commit !== options.expectedCommit) {
    throw new Error('release manifest source commit does not match the expected commit')
  }
  if (manifest.reproducibility?.byteForByteArchiveProven !== false) {
    throw new Error('release manifest makes an unsupported byte-reproducibility claim')
  }
  if (await sha256File(join(root, 'RELEASE_MANIFEST.schema.json')) !== manifest.schema?.sha256) {
    throw new Error('release manifest schema checksum mismatch')
  }
  if (sha256Text(inventoryText) !== manifest.payload?.inventorySha256) {
    throw new Error('payload inventory checksum mismatch')
  }
  if (inventory.length !== manifest.payload?.fileCount) {
    throw new Error('payload inventory file count mismatch')
  }
  if (inventory.reduce((sum, entry) => sum + entry.size, 0) !== manifest.payload?.totalBytes) {
    throw new Error('payload inventory byte count mismatch')
  }
  if (attestation.kind !== RELEASE_ATTESTATION_KIND || attestation.version !== RELEASE_ATTESTATION_VERSION) {
    throw new Error('build attestation kind or version is unsupported')
  }
  if (attestation.manifestSha256 !== sha256Text(manifestText)) {
    throw new Error('build attestation does not bind the release manifest')
  }

  const actualInventory = await collectPayloadInventory(root)
  if (JSON.stringify(actualInventory.map(entry => entry.path)) !== JSON.stringify(inventory.map(entry => entry.path))) {
    throw new Error('release candidate contains missing or unlisted payload files')
  }
  for (const entry of inventory) {
    const absolute = assertBundlePath(root, entry.path)
    const fileInfo = await lstat(absolute)
    if (!fileInfo.isFile() || fileInfo.size !== entry.size || await sha256File(absolute) !== entry.sha256) {
      throw new Error(`payload verification failed: ${entry.path}`)
    }
  }

  await verifyChecksums(root)
  return {
    productVersion: manifest.product.version,
    sourceCommit: manifest.source.commit,
    fileCount: manifest.payload.fileCount,
    totalBytes: manifest.payload.totalBytes,
    manifestSha256: sha256Text(manifestText),
  }
}
