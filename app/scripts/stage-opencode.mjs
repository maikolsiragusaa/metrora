import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const VERSION = '1.18.27'
const RELEASE_URL = `https://github.com/anomalyco/opencode/releases/download/v${VERSION}`

// These are the official release assets and SHA-256 digests published by the
// pinned upstream release. The desktop never falls back to PATH or downloads
// an unpinned build.
const ASSETS = {
  'win32-x64': { file: 'opencode-windows-x64.zip', sha256: 'ac26bb6f0309e9a6de279b64dc7bec5e69ab9b79c1a4e2d947d68d213b7eb575', archive: 'zip', binary: 'opencode.exe' },
  'win32-arm64': { file: 'opencode-windows-arm64.zip', sha256: '59174ffeb6ce327bd2c534bf5147d0005e8db3b5889414de10490d00e640c908', archive: 'zip', binary: 'opencode.exe' },
  'darwin-x64': { file: 'opencode-darwin-x64.zip', sha256: 'e182eab3a6bf095ff773d303bbc7938d3551a636eab00625b599ad6383fabd88', archive: 'zip', binary: 'opencode' },
  'darwin-arm64': { file: 'opencode-darwin-arm64.zip', sha256: '149b0c6d272d0059b8b5ffcd18c84b24f1d6cbf585942b10e60c601211992eb1', archive: 'zip', binary: 'opencode' },
  'linux-x64': { file: 'opencode-linux-x64.tar.gz', sha256: '4af5494f9433f59db8c1e344198f0ee72a50c06ec009fb4a8aeab4c2d4abd702', archive: 'tar.gz', binary: 'opencode' },
  'linux-arm64': { file: 'opencode-linux-arm64.tar.gz', sha256: '8cbc134eb5e100baf61ee7196150f503e352056e703276e2d8637c38bafd2c39', archive: 'tar.gz', binary: 'opencode' },
}

const platform = process.env.METRORA_OPENCODE_PLATFORM ?? process.platform
const arch = process.env.METRORA_OPENCODE_ARCH ?? process.arch
const target = `${platform}-${arch}`
const asset = ASSETS[target]
if (!asset) throw new Error(`OpenCode ${VERSION} has no staged asset mapping for ${target}`)

const appDir = resolve(import.meta.dirname, '..')
const destinationDir = join(appDir, 'build', 'opencode', VERSION, target)
const destination = join(destinationDir, asset.binary)
const archivePath = join(destinationDir, asset.file)

function sha256(file) {
  const hash = createHash('sha256')
  const data = readFileSync(file)
  hash.update(data)
  return hash.digest('hex')
}

function findBinary(root) {
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry)
    if (statSync(candidate).isDirectory()) {
      const found = findBinary(candidate)
      if (found) return found
    } else if (entry === asset.binary) return candidate
  }
  return null
}

async function download() {
  const response = await fetch(`${RELEASE_URL}/${asset.file}`)
  if (!response.ok) throw new Error(`OpenCode download failed: HTTP ${response.status}`)
  writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))
  const digest = sha256(archivePath)
  if (digest !== asset.sha256) {
    rmSync(archivePath, { force: true })
    throw new Error(`OpenCode ${VERSION} checksum mismatch for ${asset.file}`)
  }
}

function extract() {
  const extractDir = join(destinationDir, 'extract')
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  if (asset.archive === 'zip' && platform === 'win32') {
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${extractDir.replaceAll("'", "''")}' -Force`], { stdio: 'inherit' })
  } else if (asset.archive === 'zip') {
    execFileSync('unzip', ['-q', archivePath, '-d', extractDir], { stdio: 'inherit' })
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' })
  }
  const binary = findBinary(extractDir)
  if (!binary) throw new Error(`OpenCode archive did not contain ${asset.binary}`)
  rmSync(destination, { force: true })
  copyFileSync(binary, destination)
  if (platform !== 'win32') chmodSync(destination, 0o755)
  rmSync(extractDir, { recursive: true, force: true })
  rmSync(archivePath, { force: true })
}

mkdirSync(destinationDir, { recursive: true })
if (existsSync(destination)) {
  rmSync(archivePath, { force: true })
  console.log(`OpenCode ${VERSION} already staged: ${destination}`)
  process.exit(0)
}
if (process.env.METRORA_OPENCODE_SKIP_DOWNLOAD === '1') throw new Error(`OpenCode ${VERSION} is not staged and download was disabled`)
await download()
extract()
console.log(`Staged OpenCode ${VERSION} (${target}) -> ${destination}`)
