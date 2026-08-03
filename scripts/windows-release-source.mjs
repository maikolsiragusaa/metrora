import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const SOURCE_SCHEMA_PATH = 'release/windows-release-candidate-manifest.v1.schema.json'
export const RELEASE_INPUT_FILES = Object.freeze([
  '.github/workflows/windows-portable.yml',
  'app/package-lock.json',
  'app/package.json',
  'assets/brand/README.md',
  'package-lock.json',
  'package.json',
])

const gitSha1Pattern = /^[a-f0-9]{40}$/
const sha256Pattern = /^[a-f0-9]{64}$/

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeSourcePath(value) {
  const normalized = String(value).replaceAll('\\', '/')
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
    || /[\r\n\0]/.test(normalized)
  ) {
    throw new Error(`invalid release source path: ${value}`)
  }
  return normalized
}

function requireGitCommit(value) {
  if (!gitSha1Pattern.test(value)) {
    throw new Error('source commit must be a lowercase 40-character SHA-1')
  }
  return value
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

function runGit(repositoryRoot, args, encoding = null) {
  try {
    return execFileSync('git', args, {
      cwd: resolve(repositoryRoot),
      encoding,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const detail = error?.stderr ? Buffer.from(error.stderr).toString('utf8').trim() : ''
    throw new Error(`git source verification failed${detail ? `: ${detail}` : ''}`)
  }
}

export async function readReleaseSourceBytes(options, path) {
  const repositoryRoot = resolve(options.repositoryRoot)
  const normalized = normalizeSourcePath(path)
  if (options.sourceFileMode === 'working-tree') {
    return readFile(join(repositoryRoot, ...normalized.split('/')))
  }
  if (options.sourceFileMode && options.sourceFileMode !== 'git') {
    throw new Error(`unsupported source file mode: ${options.sourceFileMode}`)
  }
  const sourceCommit = requireGitCommit(options.sourceCommit)
  return runGit(repositoryRoot, ['show', `${sourceCommit}:${normalized}`])
}

export async function readReleaseSourceJson(options, path) {
  const bytes = await readReleaseSourceBytes(options, path)
  return JSON.parse(Buffer.from(bytes).toString('utf8'))
}

export async function hashReleaseSourceInputs(options) {
  const hashes = {}
  for (const path of [...RELEASE_INPUT_FILES].sort(compareText)) {
    hashes[path] = sha256Bytes(await readReleaseSourceBytes(options, path))
  }
  return hashes
}

function packageVersion(lock, packageName) {
  const version = lock?.packages?.[`node_modules/${packageName}`]?.version
  if (typeof version !== 'string' || !version) {
    throw new Error(`package-lock is missing an exact ${packageName} version`)
  }
  return version
}

export async function loadCanonicalReleaseSource(options) {
  requireGitCommit(options.sourceCommit)
  const [appPackage, appLock, schemaBytes, inputFiles] = await Promise.all([
    readReleaseSourceJson(options, 'app/package.json'),
    readReleaseSourceJson(options, 'app/package-lock.json'),
    readReleaseSourceBytes(options, SOURCE_SCHEMA_PATH),
    hashReleaseSourceInputs(options),
  ])

  if (
    appPackage.name !== 'metrora-desktop'
    || appPackage.build?.appId !== 'eu.metrora.desktop'
    || appPackage.build?.productName !== 'Metrora'
    || appPackage.publisher !== 'Vensent'
    || appPackage.author !== 'Vensent (https://metrora.eu)'
    || appPackage.homepage !== 'https://metrora.eu'
  ) {
    throw new Error('desktop package identity is not canonical Metrora/Vensent')
  }

  return {
    appPackage,
    electron: packageVersion(appLock, 'electron'),
    electronBuilder: packageVersion(appLock, 'electron-builder'),
    schemaBytes,
    schemaSha256: sha256Bytes(schemaBytes),
    inputFiles,
  }
}

function exactInputSet(inputFiles) {
  if (!inputFiles || typeof inputFiles !== 'object' || Array.isArray(inputFiles)) return false
  const actual = Object.keys(inputFiles)
  const expected = [...RELEASE_INPUT_FILES].sort(compareText)
  return JSON.stringify(actual) === JSON.stringify(expected)
    && actual.every(path => sha256Pattern.test(inputFiles[path]))
}

function verifyCommitMetadata(manifest, options) {
  if (options.sourceFileMode === 'working-tree') return
  const output = String(runGit(
    options.repositoryRoot,
    ['show', '-s', '--format=%T%n%ct', manifest.source.commit],
    'utf8',
  )).trim().split(/\r?\n/)
  if (output.length !== 2 || output[0] !== manifest.source.tree || Number(output[1]) !== manifest.source.sourceDateEpoch) {
    throw new Error('release manifest tree or source timestamp does not match the source commit')
  }
}

export async function verifyCanonicalReleaseSource(manifest, options) {
  requireGitCommit(manifest.source?.commit)
  verifyCommitMetadata(manifest, options)

  if (!exactInputSet(manifest.build?.inputFiles)) {
    throw new Error('release manifest build input set is incomplete or invalid')
  }

  const canonical = await loadCanonicalReleaseSource({
    repositoryRoot: options.repositoryRoot,
    sourceCommit: manifest.source.commit,
    sourceFileMode: options.sourceFileMode,
  })

  for (const path of RELEASE_INPUT_FILES) {
    if (canonical.inputFiles[path] !== manifest.build.inputFiles[path]) {
      throw new Error(`release manifest build input does not match source commit: ${path}`)
    }
  }
  if (canonical.schemaSha256 !== manifest.schema?.sha256) {
    throw new Error('release manifest schema does not match the source commit')
  }
  if (
    manifest.product?.name !== canonical.appPackage.build.productName
    || manifest.product?.publisher !== canonical.appPackage.publisher
    || manifest.product?.packageName !== canonical.appPackage.name
    || manifest.product?.appId !== canonical.appPackage.build.appId
    || manifest.product?.version !== canonical.appPackage.version
    || manifest.product?.homepage !== canonical.appPackage.homepage
  ) {
    throw new Error('release manifest product metadata does not match the source commit')
  }
  if (
    manifest.build?.electron !== canonical.electron
    || manifest.build?.electronBuilder !== canonical.electronBuilder
  ) {
    throw new Error('release manifest toolchain does not match the source commit')
  }

  return canonical
}
