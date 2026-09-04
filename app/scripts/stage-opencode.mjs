import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = '1.18.27'
export const SOURCE_COMMIT = 'b04697366f05419e9bd7a92f841813dd976161c9'
export const RELEASE_URL = `https://github.com/anomalyco/opencode/releases/download/v${VERSION}`

// Archive digests are the official release asset pins. Binary digests are
// derived from the verified archive and persisted in identity.json, so a
// destination binary cannot silently drift while retaining a valid archive.
export const ASSETS = {
  'win32-x64': { file: 'opencode-windows-x64.zip', sha256: 'ac26bb6f0309e9a6de279b64dc7bec5e69ab9b79c1a4e2d947d68d213b7eb575', archive: 'zip', binary: 'opencode.exe' },
  'win32-arm64': { file: 'opencode-windows-arm64.zip', sha256: '59174ffeb6ce327bd2c534bf5147d0005e8db3b5889414de10490d00e640c908', archive: 'zip', binary: 'opencode.exe' },
  'darwin-x64': { file: 'opencode-darwin-x64.zip', sha256: 'e182eab3a6bf095ff773d303bbc7938d3551a636eab00625b599ad6383fabd88', archive: 'zip', binary: 'opencode' },
  'darwin-arm64': { file: 'opencode-darwin-arm64.zip', sha256: '149b0c6d272d0059b8b5ffcd18c84b24f1d6cbf585942b10e60c601211992eb1', archive: 'zip', binary: 'opencode' },
  'linux-x64': { file: 'opencode-linux-x64.tar.gz', sha256: '4af5494f9433f59db8c1e344198f0ee72a50c06ec009fb4a8aeab4c2d4abd702', archive: 'tar.gz', binary: 'opencode' },
  'linux-arm64': { file: 'opencode-linux-arm64.tar.gz', sha256: '8cbc134eb5e100baf61ee7196150f503e352056e703276e2d8637c38bafd2c39', archive: 'tar.gz', binary: 'opencode' },
}

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function verifyStageIdentity(destination, archivePath, expectedArchiveSha256, expectedBinarySha256) {
  return existsSync(destination)
    && existsSync(archivePath)
    && sha256(archivePath) === expectedArchiveSha256
    && (!expectedBinarySha256 || sha256(destination) === expectedBinarySha256)
}

function findBinary(root, binaryName) {
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry)
    if (statSync(candidate).isDirectory()) {
      const found = findBinary(candidate, binaryName)
      if (found) return found
    } else if (entry === binaryName) return candidate
  }
  return null
}

function extractArchive(archive, destinationDir, platform, asset) {
  const extractDir = join(destinationDir, 'extract')
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  if (asset.archive === 'zip' && platform === 'win32') {
    const archiveLiteral = archive.replaceAll("'", "''")
    const destinationLiteral = extractDir.replaceAll("'", "''")
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archiveLiteral}' -DestinationPath '${destinationLiteral}' -Force`], { stdio: 'ignore' })
  } else if (asset.archive === 'zip') {
    execFileSync('unzip', ['-q', archive, '-d', extractDir], { stdio: 'ignore' })
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', extractDir], { stdio: 'ignore' })
  }
  const binary = findBinary(extractDir, asset.binary)
  if (!binary) throw new Error(`OpenCode archive did not contain ${asset.binary}`)
  return { binary, extractDir }
}

async function download(archivePath, asset) {
  const response = await fetch(`${RELEASE_URL}/${asset.file}`, { headers: { 'User-Agent': 'metrora-opencode-stager' } })
  if (!response.ok) throw new Error(`OpenCode download failed: HTTP ${response.status}`)
  writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))
  if (sha256(archivePath) !== asset.sha256) {
    rmSync(archivePath, { force: true })
    throw new Error(`OpenCode ${VERSION} checksum mismatch for ${asset.file}`)
  }
}

function materialize(destination, destinationDir, platform, asset) {
  const { binary, extractDir } = extractArchive(join(destinationDir, asset.file), destinationDir, platform, asset)
  try {
    const binaryDigest = sha256(binary)
    if (!verifyStageIdentity(destination, join(destinationDir, asset.file), asset.sha256, binaryDigest)) {
      rmSync(destination, { force: true })
      copyFileSync(binary, destination)
      if (platform !== 'win32') chmodSync(destination, 0o755)
    }
    return binaryDigest
  } finally {
    rmSync(extractDir, { recursive: true, force: true })
  }
}

function smokeVersion(destination) {
  const output = execFileSync(destination, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).trim()
  if (!output.startsWith(VERSION)) throw new Error(`OpenCode staged binary reported ${output || '<empty>'}; expected ${VERSION}`)
}

export async function stageOpenCode({ appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..'), platform = process.env.METRORA_OPENCODE_PLATFORM ?? process.platform, arch = process.env.METRORA_OPENCODE_ARCH ?? process.arch } = {}) {
  const target = `${platform}-${arch}`
  const asset = ASSETS[target]
  if (!asset) throw new Error(`OpenCode ${VERSION} has no staged asset mapping for ${target}`)
  const destinationDir = join(appDir, 'build', 'opencode', VERSION, target)
  const destination = join(destinationDir, asset.binary)
  const archivePath = join(destinationDir, asset.file)
  mkdirSync(destinationDir, { recursive: true })

  if (existsSync(destination) && existsSync(archivePath) && sha256(archivePath) !== asset.sha256) {
    throw new Error(`OpenCode ${VERSION} staged archive identity mismatch; refusing reuse`)
  }
  if (existsSync(destination) && !existsSync(archivePath) && process.env.METRORA_OPENCODE_SKIP_DOWNLOAD === '1') {
    throw new Error(`OpenCode ${VERSION} staged binary has no verified archive; refusing stale reuse`)
  }
  if (!existsSync(archivePath)) {
    if (process.env.METRORA_OPENCODE_SKIP_DOWNLOAD === '1') throw new Error(`OpenCode ${VERSION} is not staged and download was disabled`)
    await download(archivePath, asset)
  }
  if (sha256(archivePath) !== asset.sha256) throw new Error(`OpenCode ${VERSION} staged archive checksum mismatch`)

  try {
    const binaryDigest = materialize(destination, destinationDir, platform, asset)
    smokeVersion(destination)
    writeFileSync(join(destinationDir, 'identity.json'), JSON.stringify({ version: VERSION, source: SOURCE_COMMIT, platform, arch, asset: asset.file, archiveSha256: asset.sha256, binarySha256: binaryDigest }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    if (!existsSync(destination)) rmSync(archivePath, { force: true })
    throw error
  }
  console.log(`OpenCode ${VERSION} staged and verified (${target}) -> ${destination}`)
  return destination
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await stageOpenCode()
