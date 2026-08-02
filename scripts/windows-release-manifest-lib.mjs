import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
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

const SOURCE_SCHEMA_PATH = 'release/windows-release-candidate-manifest.v1.schema.json'
const metadataFileSet = new Set(RELEASE_METADATA_FILES)
const allowedDistributions = new Set([
  'unsigned-development-artifact',
  'unsigned-release-candidate',
])
const sha256Pattern = /^[a-f0-9]{64}$/
const gitSha1Pattern = /^[a-f0-9]{40}$/

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

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

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
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
  return sha256Bytes(Buffer.from(value, 'utf8'))
}

async function walkFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => compareText(left.name, right.name))
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
  inventory.sort((left, right) => compareText(left.path, right.path))
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

function requireGitCommit(value) {
  if (!gitSha1Pattern.test(value)) {
    throw new Error('source commit must be a lowercase 40-character SHA-1')
  }
  return value
}

async function readSourceBytes(options, path) {
  const repositoryRoot = resolve(options.repositoryRoot)
  const normalized = normalizeManifestPath(path)
  if (options.sourceFileMode === 'working-tree') {
    return readFile(join(repositoryRoot, ...normalized.split('/')))
  }
  if (options.sourceFileMode && options.sourceFileMode !== 'git') {
    throw new Error(`unsupported source file mode: ${options.sourceFileMode}`)
  }
  const sourceCommit = requireGitCommit(options.sourceCommit)
  try {
    return execFileSync('git', ['show', `${sourceCommit}:${normalized}`], {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const detail = error?.stderr ? Buffer.from(error.stderr).toString('utf8').trim() : ''
    throw new Error(`could not read ${normalized} from source commit${detail ? `: ${detail}` : ''}`)
  }
}

export async function hashInputFiles(repositoryRoot, paths, options) {
  const result = {}
  for (const input of [...paths].sort(compareText)) {
    const normalized = normalizeManifestPath(input)
    result[normalized] = sha256Bytes(await readSourceBytes({
      repositoryRoot,
      sourceCommit: options.sourceCommit,
      sourceFileMode: options.sourceFileMode,
    }, normalized))
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

function requireCanonicalDistribution(value) {
  if (!allowedDistributions.has(value)) {
    throw new Error(`unsupported Windows candidate distribution: ${value}`)
  }
  return value
}

export async function buildReleaseManifest(options) {
  const repositoryRoot = resolve(options.repositoryRoot)
  const appPackagePath = join(repositoryRoot, 'app', 'package.json')
  const appLockPath = join(repositoryRoot, 'app', 'package-lock.json')
  const appPackage = await readJsonFile(appPackagePath)
  const appLock = await readJsonFile(appLockPath)
  const sourceDateEpoch = Number(options.sourceDateEpoch)

  requireGitCommit(options.sourceCommit)
  if (!gitSha1Pattern.test(options.sourceTree)) {
    throw new Error('source tree must be a lowercase 40-character SHA-1')
  }
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 0) {
    throw new Error('source date epoch must be a non-negative safe integer')
  }
  if (
    appPackage.name !== 'metrora-desktop'
    || appPackage.build?.appId !== 'eu.metrora.desktop'
    || appPackage.build?.productName !== 'Metrora'
    || appPackage.homepage !== 'https://metrora.eu'
  ) {
    throw new Error('desktop package identity is not canonical Metrora')
  }

  const inventoryText = serializeInventory(options.inventory)
  const inventorySummary = summarizeInventory(options.inventory, inventoryText)
  const inputFiles = await hashInputFiles(repositoryRoot, options.inputFiles, {
    sourceCommit: options.sourceCommit,
    sourceFileMode: options.sourceFileMode,
  })

  return {
    kind: RELEASE_MANIFEST_KIND,
    version: RELEASE_MANIFEST_VERSION,
    schema: {
      file: 'RELEASE_MANIFEST.schema.json',
      sha256: options.schemaSha256,
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
      distribution: requireCanonicalDistribution(options.distribution),
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
  for (const [name, value] of Object.entries({
    provider: options.provider,
    workflow: options.workflow,
    runId: String(options.runId),
    runAttempt: String(options.runAttempt),
    ref: options.ref,
    runnerOs: options.runnerOs,
    runnerImage: options.runnerImage,
  })) {
    if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) {
      throw new Error(`build attestation ${name} is invalid`)
    }
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
  for (const fileName of [...fileNames].sort(compareText)) {
    const normalized = normalizeManifestPath(fileName)
    lines.push(`${await sha256File(join(bundleDirectory, normalized))}  ${normalized}`)
  }
  await writeFile(join(bundleDirectory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'ascii')
}

export async function writeReleaseMetadata(options) {
  const bundleDirectory = resolve(options.bundleDirectory)
  const schemaDestination = join(bundleDirectory, 'RELEASE_MANIFEST.schema.json')
  const sourceSchema = await readSourceBytes({
    repositoryRoot: options.repositoryRoot,
    sourceCommit: options.sourceCommit,
    sourceFileMode: options.sourceFileMode,
  }, SOURCE_SCHEMA_PATH)
  const schemaSha256 = sha256Bytes(sourceSchema)

  await mkdir(dirname(schemaDestination), { recursive: true })
  await writeFile(schemaDestination, sourceSchema)

  const inventory = await collectPayloadInventory(bundleDirectory)
  const inventoryText = serializeInventory(inventory)
  const manifest = await buildReleaseManifest({ ...options, inventory, schemaSha256 })
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
  const sorted = [...entries].sort((left, right) => compareText(left.path, right.path))
  if (JSON.stringify(entries) !== JSON.stringify(sorted)) {
    throw new Error('payload inventory is not sorted canonically')
  }
  return entries
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

function requireManifestShape(manifest) {
  if (manifest.kind !== RELEASE_MANIFEST_KIND || manifest.version !== RELEASE_MANIFEST_VERSION) {
    throw new Error('release manifest kind or version is unsupported')
  }
  if (
    manifest.product?.name !== 'Metrora'
    || manifest.product?.packageName !== 'metrora-desktop'
    || manifest.product?.appId !== 'eu.metrora.desktop'
    || manifest.product?.homepage !== 'https://metrora.eu'
    || manifest.product?.visualIdentity?.name !== 'Signal Grid'
    || manifest.product?.visualIdentity?.version !== '1.0'
  ) {
    throw new Error('release manifest product identity is not canonical Metrora')
  }
  if (
    manifest.source?.repository !== 'maikolsiragusaa/metrora'
    || !gitSha1Pattern.test(manifest.source?.commit)
    || !gitSha1Pattern.test(manifest.source?.tree)
    || !Number.isSafeInteger(manifest.source?.sourceDateEpoch)
    || manifest.source.sourceDateEpoch < 0
  ) {
    throw new Error('release manifest source identity is invalid')
  }
  if (
    manifest.build?.target !== 'windows-x64'
    || manifest.build?.artifactType !== 'portable-directory'
    || !allowedDistributions.has(manifest.build?.distribution)
    || typeof manifest.build?.inputFiles !== 'object'
    || manifest.build.inputFiles === null
  ) {
    throw new Error('release manifest build identity is invalid')
  }
  if (
    manifest.reproducibility?.level !== 'content-addressed-candidate'
    || manifest.reproducibility?.payloadFullyInventoried !== true
    || manifest.reproducibility?.byteForByteArchiveProven !== false
  ) {
    throw new Error('release manifest makes an unsupported reproducibility claim')
  }
  if (
    manifest.schema?.file !== 'RELEASE_MANIFEST.schema.json'
    || !sha256Pattern.test(manifest.schema?.sha256)
    || manifest.payload?.inventoryFile !== 'PAYLOAD_MANIFEST.jsonl'
    || !Number.isSafeInteger(manifest.payload?.fileCount)
    || manifest.payload.fileCount < 1
    || !Number.isSafeInteger(manifest.payload?.totalBytes)
    || manifest.payload.totalBytes < 1
    || !sha256Pattern.test(manifest.payload?.inventorySha256)
  ) {
    throw new Error('release manifest payload metadata is invalid')
  }
}

async function verifySourceInputs(manifest, repositoryRoot, sourceFileMode) {
  const root = resolve(repositoryRoot)
  const declared = manifest.build.inputFiles
  const paths = Object.keys(declared)
  if (paths.length === 0 || paths.some(path => !sha256Pattern.test(declared[path]))) {
    throw new Error('release manifest build input inventory is invalid')
  }
  const actual = await hashInputFiles(root, paths, {
    sourceCommit: manifest.source.commit,
    sourceFileMode,
  })
  for (const path of paths) {
    if (actual[path] !== declared[path]) {
      throw new Error(`release manifest build input does not match source commit: ${path}`)
    }
  }
  const sourceSchema = await readSourceBytes({
    repositoryRoot: root,
    sourceCommit: manifest.source.commit,
    sourceFileMode,
  }, SOURCE_SCHEMA_PATH)
  if (sha256Bytes(sourceSchema) !== manifest.schema.sha256) {
    throw new Error('release manifest schema does not match the source commit')
  }
}

export async function verifyReleaseCandidate(bundleDirectory, options = {}) {
  const root = resolve(bundleDirectory)
  const manifestText = await readFile(join(root, 'RELEASE_MANIFEST.json'), 'utf8')
  const manifest = JSON.parse(manifestText)
  const attestation = await readJsonFile(join(root, 'BUILD_ATTESTATION.json'))
  const inventoryText = await readFile(join(root, 'PAYLOAD_MANIFEST.jsonl'), 'utf8')
  const inventory = parseInventory(inventoryText)

  requireManifestShape(manifest)
  if (options.expectedCommit && manifest.source.commit !== options.expectedCommit) {
    throw new Error('release manifest source commit does not match the expected commit')
  }
  await verifySourceInputs(
    manifest,
    options.repositoryRoot ?? process.cwd(),
    options.sourceFileMode,
  )
  if (await sha256File(join(root, 'RELEASE_MANIFEST.schema.json')) !== manifest.schema.sha256) {
    throw new Error('release manifest schema checksum mismatch')
  }
  if (sha256Text(inventoryText) !== manifest.payload.inventorySha256) {
    throw new Error('payload inventory checksum mismatch')
  }
  if (inventory.length !== manifest.payload.fileCount) {
    throw new Error('payload inventory file count mismatch')
  }
  if (inventory.reduce((sum, entry) => sum + entry.size, 0) !== manifest.payload.totalBytes) {
    throw new Error('payload inventory byte count mismatch')
  }
  if (attestation.kind !== RELEASE_ATTESTATION_KIND || attestation.version !== RELEASE_ATTESTATION_VERSION) {
    throw new Error('build attestation kind or version is unsupported')
  }
  if (attestation.manifestSha256 !== sha256Text(manifestText)) {
    throw new Error('build attestation does not bind the release manifest')
  }

  const actualInventory = await collectPayloadInventory(root)
  if (actualInventory.length !== inventory.length) {
    throw new Error('release candidate contains missing or unlisted payload files')
  }
  for (let index = 0; index < inventory.length; index += 1) {
    const expected = inventory[index]
    const actual = actualInventory[index]
    if (actual.path !== expected.path) {
      throw new Error('release candidate contains missing or unlisted payload files')
    }
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`payload verification failed: ${expected.path}`)
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
