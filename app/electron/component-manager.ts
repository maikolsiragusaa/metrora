import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { gunzipSync, inflateRawSync } from 'node:zlib'

export const COMPONENT_MANAGER_SCHEMA_VERSION = 'metrora.component.v1' as const
export const LLAMA_BENCH_COMPONENT_ID = 'llama-bench' as const
export const LLAMA_BENCH_COMPONENT_NAME = 'llama.cpp benchmark runtime' as const
export const LLAMA_BENCH_COMPONENT_VERSION = 'b10621' as const

const COMPONENT_DIRECTORY = 'components'
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 512
const MAX_MEMBER_BYTES = 256 * 1024 * 1024
const MAX_MEMBER_NAME_BYTES = 512
const MAX_REDIRECTS = 3
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

type ArchiveFormat = 'zip' | 'tar.gz'

type LlamaBenchAsset = {
  assetName: string
  archiveFormat: ArchiveFormat
  checksum: string
}

const LLAMA_BENCH_ASSETS: Record<string, LlamaBenchAsset> = {
  'win32-x64': {
    assetName: 'llama-b10621-bin-win-cpu-x64.zip',
    archiveFormat: 'zip',
    checksum: '0e8b65e650e369f70f8307d890508886f171ef4fb00facccddd4a1b7ffdaca51',
  },
  'win32-arm64': {
    assetName: 'llama-b10621-bin-win-cpu-arm64.zip',
    archiveFormat: 'zip',
    checksum: 'c072e8bb057751587243c1e0ed28d82e23c7e0544a426e0d476f1e77792bf3ce',
  },
  'darwin-x64': {
    assetName: 'llama-b10621-bin-macos-x64.tar.gz',
    archiveFormat: 'tar.gz',
    checksum: '33c44e036e0e223f71a29fc74a0ab3e130ca9eadeb032ecc1c7af25985b8b91b',
  },
  'darwin-arm64': {
    assetName: 'llama-b10621-bin-macos-arm64.tar.gz',
    archiveFormat: 'tar.gz',
    checksum: '429c8270608600188035e5e92f7d78dffb7900904fe7dd7e6a84f48068cd13cf',
  },
  'linux-x64': {
    assetName: 'llama-b10621-bin-ubuntu-x64.tar.gz',
    archiveFormat: 'tar.gz',
    checksum: '91d7b03ddae498a39f28fdb85d84d2b4a0fd3838d10b4f897e0ef8975bb9b583',
  },
  'linux-arm64': {
    assetName: 'llama-b10621-bin-ubuntu-arm64.tar.gz',
    archiveFormat: 'tar.gz',
    checksum: '95940151be63492f70f659da420b268244cc83a6ee70e310d2600ccdb7ea4deb',
  },
}

const EXECUTABLE_NAMES = ['llama-bench', 'llama-bench.exe'] as const

export type ComponentId = typeof LLAMA_BENCH_COMPONENT_ID
export type ComponentInstallState = 'not-installed' | 'installing' | 'installed' | 'failed' | 'cancelled' | 'unsupported'
export type ComponentInstallPhase = 'idle' | 'downloading' | 'verifying' | 'extracting' | 'installed' | 'failed' | 'cancelled'

export type ComponentProvenance = {
  repository: string
  source: string
  version: string
  checksum: string
  checksumVerified: true
  installedAt: string
}

export type ComponentStatus = {
  schemaVersion: typeof COMPONENT_MANAGER_SCHEMA_VERSION
  id: ComponentId
  name: typeof LLAMA_BENCH_COMPONENT_NAME
  state: ComponentInstallState
  phase: ComponentInstallPhase
  version: string | null
  progress: number | null
  detail: string
  executablePath: string | null
  provenance: ComponentProvenance | null
  error: string | null
}

export type ComponentInstallEvent = ComponentStatus

export type ComponentCatalogEntry = {
  id: ComponentId
  name: typeof LLAMA_BENCH_COMPONENT_NAME
  repository: 'https://github.com/ggml-org/llama.cpp'
  version: typeof LLAMA_BENCH_COMPONENT_VERSION
  source: string
  checksum: string
  archiveFormat: ArchiveFormat
  executableNames: readonly string[]
  platform: string
  arch: string
}

export type ComponentManagerOptions = {
  /** Application-owned data directory, normally Electron's app.getPath('userData'). */
  rootDir: string
  platform?: string
  arch?: string
  /** Deterministic catalog seam used by contract tests; production uses the pinned official catalog. */
  catalog?: ComponentCatalogEntry | null
  fetchImpl?: typeof fetch
  now?: () => Date
  onEvent?: (event: ComponentInstallEvent) => void
}

type ComponentManifest = {
  schemaVersion: typeof COMPONENT_MANAGER_SCHEMA_VERSION
  id: ComponentId
  version: typeof LLAMA_BENCH_COMPONENT_VERSION
  executableRelativePath: string
  provenance: ComponentProvenance
}

type ComponentFlight = {
  controller: AbortController
  promise: Promise<ComponentStatus>
}

export type ComponentManagerErrorCode =
  | 'invalid-component'
  | 'unsupported-platform'
  | 'invalid-source'
  | 'download-failed'
  | 'checksum-mismatch'
  | 'archive-invalid'
  | 'cancelled'
  | 'state-invalid'

export class ComponentManagerError extends Error {
  constructor(public readonly code: ComponentManagerErrorCode, message: string) {
    super(message)
    this.name = 'ComponentManagerError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function keyFor(platform: string, arch: string): string {
  return platform + '-' + arch
}

function sourceFor(assetName: string): string {
  return 'https://github.com/ggml-org/llama.cpp/releases/download/' + LLAMA_BENCH_COMPONENT_VERSION + '/' + assetName
}

function entryFor(platform: string, arch: string): ComponentCatalogEntry | null {
  const asset = LLAMA_BENCH_ASSETS[keyFor(platform, arch)]
  if (!asset) return null
  return {
    id: LLAMA_BENCH_COMPONENT_ID,
    name: LLAMA_BENCH_COMPONENT_NAME,
    repository: 'https://github.com/ggml-org/llama.cpp',
    version: LLAMA_BENCH_COMPONENT_VERSION,
    source: sourceFor(asset.assetName),
    checksum: 'sha256:' + asset.checksum,
    archiveFormat: asset.archiveFormat,
    executableNames: EXECUTABLE_NAMES,
    platform,
    arch,
  }
}

export function getLlamaBenchCatalogEntry(platform: string = process.platform, arch: string = process.arch): ComponentCatalogEntry | null {
  return entryFor(platform, arch)
}

export function validateComponentSource(source: string, expected?: ComponentCatalogEntry): ComponentCatalogEntry {
  if (typeof source !== 'string' || source.length > 512) throw new ComponentManagerError('invalid-source', 'Component source is not approved.')
  let parsed: URL
  try { parsed = new URL(source) } catch { throw new ComponentManagerError('invalid-source', 'Component source is not approved.') }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ComponentManagerError('invalid-source', 'Component source is not approved.')
  }
  const match = Object.keys(LLAMA_BENCH_ASSETS)
    .map(value => value.split('-'))
    .map(value => entryFor(value[0]!, value.slice(1).join('-')))
    .find(value => value?.source === source)
  if (!match || (expected && match.source !== expected.source)) throw new ComponentManagerError('invalid-source', 'Component source is not approved.')
  return match
}

function safeRelativePath(raw: string): string {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_MEMBER_NAME_BYTES) throw new ComponentManagerError('archive-invalid', 'Component archive contains an invalid path.')
  const normalized = raw.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized) || normalized.includes('\u0000')) {
    throw new ComponentManagerError('archive-invalid', 'Component archive contains an unsafe path.')
  }
  const parts = normalized.split('/').filter(part => part && part !== '.')
  if (!parts.length || parts.some(part => part === '..' || part.includes('\u0000'))) {
    throw new ComponentManagerError('archive-invalid', 'Component archive contains an unsafe path.')
  }
  return parts.join(sep)
}

function ensureInside(root: string, candidate: string): void {
  const rootPath = resolve(root)
  const candidatePath = resolve(candidate)
  const rest = relative(rootPath, candidatePath)
  if (rest === '..' || rest.startsWith('..' + sep) || rest.startsWith(sep) || /^[A-Za-z]:/u.test(rest)) {
    throw new ComponentManagerError('archive-invalid', 'Component archive escaped its managed directory.')
  }
}

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function decodeArchiveName(value: Uint8Array, utf8: boolean): string {
  try {
    return utf8
      ? new TextDecoder('utf-8', { fatal: true }).decode(value)
      : Buffer.from(value).toString('utf8')
  } catch {
    throw new ComponentManagerError('archive-invalid', 'Component archive contains an invalid filename.')
  }
}

async function writeMember(destinationRoot: string, rawName: string, data: Uint8Array, written: Set<string>, total: { value: number }, executableNames: readonly string[]): Promise<string> {
  const member = safeRelativePath(rawName)
  if (written.has(member)) throw new ComponentManagerError('archive-invalid', 'Component archive contains duplicate files.')
  if (data.byteLength > MAX_MEMBER_BYTES || total.value + data.byteLength > MAX_EXTRACTED_BYTES) {
    throw new ComponentManagerError('archive-invalid', 'Component archive is too large.')
  }
  written.add(member)
  total.value += data.byteLength
  const destination = join(destinationRoot, member)
  ensureInside(destinationRoot, destination)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, data)
  if (executableNames.some(name => name.toLowerCase() === basename(member).toLowerCase())) {
    await chmod(destination, 0o755).catch(() => undefined)
  }
  return member
}

async function extractZip(input: Uint8Array, destinationRoot: string, executableNames: readonly string[]): Promise<string[]> {
  const bytes = Buffer.from(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset++) {
    if (view.getUint32(offset, true) === 0x06054b50) end = offset
  }
  if (end < 0) throw new ComponentManagerError('archive-invalid', 'Component archive is not a supported ZIP file.')
  const entryCount = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  const centralEnd = centralOffset + centralSize
  if (entryCount > MAX_ARCHIVE_ENTRIES || centralEnd > bytes.length) {
    throw new ComponentManagerError('archive-invalid', 'Component archive has invalid directory bounds.')
  }
  const written = new Set<string>()
  const files: string[] = []
  const total = { value: 0 }
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== 0x02014b50) throw new ComponentManagerError('archive-invalid', 'Component archive has an invalid directory entry.')
    const madeBy = view.getUint16(cursor + 4, true)
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const expectedCrc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameSize = view.getUint16(cursor + 28, true)
    const extraSize = view.getUint16(cursor + 30, true)
    const commentSize = view.getUint16(cursor + 32, true)
    const externalAttributes = view.getUint32(cursor + 38, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const nameStart = cursor + 46
    const nameEnd = nameStart + nameSize
    if (nameSize > MAX_MEMBER_NAME_BYTES || nameEnd + extraSize + commentSize > centralEnd) throw new ComponentManagerError('archive-invalid', 'Component archive has an invalid filename entry.')
    const rawName = decodeArchiveName(bytes.subarray(nameStart, nameEnd), Boolean(flags & 0x800))
    const isDirectory = rawName.endsWith('/')
    if (flags & 1) throw new ComponentManagerError('archive-invalid', 'Encrypted component archives are not supported.')
    const mode = externalAttributes >>> 16
    if ((madeBy >>> 8) === 3 && (mode & 0xf000) === 0xa000) throw new ComponentManagerError('archive-invalid', 'Component archives may not contain symbolic links.')
    if (!isDirectory) {
      if (uncompressedSize > MAX_MEMBER_BYTES || total.value + uncompressedSize > MAX_EXTRACTED_BYTES) throw new ComponentManagerError('archive-invalid', 'Component archive is too large.')
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new ComponentManagerError('archive-invalid', 'Component archive has an invalid local entry.')
      const localNameSize = view.getUint16(localOffset + 26, true)
      const localExtraSize = view.getUint16(localOffset + 28, true)
      const dataStart = localOffset + 30 + localNameSize + localExtraSize
      if (dataStart + compressedSize > bytes.length) throw new ComponentManagerError('archive-invalid', 'Component archive has invalid compressed data bounds.')
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
      let data: Uint8Array
      try {
        data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : (() => { throw new Error('method') })()
      } catch {
        throw new ComponentManagerError('archive-invalid', 'Component archive contains unsupported or corrupt compressed data.')
      }
      if (data.byteLength !== uncompressedSize || crc32(data) !== expectedCrc) throw new ComponentManagerError('archive-invalid', 'Component archive checksum is invalid.')
      files.push(await writeMember(destinationRoot, rawName, data, written, total, executableNames))
    } else {
      const directory = safeRelativePath(rawName)
      ensureInside(destinationRoot, join(destinationRoot, directory))
      await mkdir(join(destinationRoot, directory), { recursive: true })
    }
    cursor = nameEnd + extraSize + commentSize
  }
  if (cursor > centralEnd) throw new ComponentManagerError('archive-invalid', 'Component archive directory bounds are inconsistent.')
  return files
}

function parseTarSize(value: Uint8Array): number {
  const raw = Buffer.from(value).toString('ascii').replace(/\0/g, '').trim()
  if (!raw || !/^[0-7]+$/u.test(raw)) throw new ComponentManagerError('archive-invalid', 'Component archive contains an invalid TAR size.')
  const parsed = Number.parseInt(raw, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ComponentManagerError('archive-invalid', 'Component archive contains an invalid TAR size.')
  return parsed
}

async function extractTarGz(input: Uint8Array, destinationRoot: string, executableNames: readonly string[]): Promise<string[]> {
  let bytes: Buffer
  try { bytes = gunzipSync(input) } catch { throw new ComponentManagerError('archive-invalid', 'Component archive is not a supported gzip file.') }
  if (bytes.byteLength > MAX_EXTRACTED_BYTES) throw new ComponentManagerError('archive-invalid', 'Component archive is too large.')
  const written = new Set<string>()
  const files: string[] = []
  const total = { value: 0 }
  let cursor = 0
  let entries = 0
  while (cursor + 512 <= bytes.length) {
    const header = bytes.subarray(cursor, cursor + 512)
    if (header.every(value => value === 0)) break
    entries += 1
    if (entries > MAX_ARCHIVE_ENTRIES) throw new ComponentManagerError('archive-invalid', 'Component archive contains too many entries.')
    const name = Buffer.from(header.subarray(0, 100)).toString('utf8').replace(/\0.*$/u, '')
    const prefix = Buffer.from(header.subarray(345, 500)).toString('utf8').replace(/\0.*$/u, '')
    const rawName = prefix ? prefix + '/' + name : name
    const size = parseTarSize(header.subarray(124, 136))
    const type = header[156] ?? 0
    const dataStart = cursor + 512
    const paddedSize = Math.ceil(size / 512) * 512
    if (dataStart + paddedSize > bytes.length) throw new ComponentManagerError('archive-invalid', 'Component archive has invalid TAR bounds.')
    if (type === 0 || type === 48) {
      if (size > MAX_MEMBER_BYTES || total.value + size > MAX_EXTRACTED_BYTES) throw new ComponentManagerError('archive-invalid', 'Component archive is too large.')
      files.push(await writeMember(destinationRoot, rawName, bytes.subarray(dataStart, dataStart + size), written, total, executableNames))
    } else if (type === 5) {
      const directory = safeRelativePath(rawName)
      ensureInside(destinationRoot, join(destinationRoot, directory))
      await mkdir(join(destinationRoot, directory), { recursive: true })
    } else {
      throw new ComponentManagerError('archive-invalid', 'Component archives may contain only regular files and directories.')
    }
    cursor = dataStart + paddedSize
  }
  return files
}

async function extractArchive(input: Uint8Array, format: ArchiveFormat, destinationRoot: string, executableNames: readonly string[]): Promise<string> {
  const files = format === 'zip'
    ? await extractZip(input, destinationRoot, executableNames)
    : await extractTarGz(input, destinationRoot, executableNames)
  const executable = files.find(value => executableNames.some(name => name.toLowerCase() === basename(value).toLowerCase()))
  if (!executable) throw new ComponentManagerError('archive-invalid', 'The official component archive did not contain llama-bench.')
  return executable
}

function statusBase(entry: ComponentCatalogEntry | null, state: ComponentInstallState, phase: ComponentInstallPhase, detail: string, error: string | null = null, progress: number | null = null, executablePath: string | null = null, provenance: ComponentProvenance | null = null): ComponentStatus {
  return {
    schemaVersion: COMPONENT_MANAGER_SCHEMA_VERSION,
    id: LLAMA_BENCH_COMPONENT_ID,
    name: LLAMA_BENCH_COMPONENT_NAME,
    state,
    phase,
    version: entry?.version ?? null,
    progress,
    detail,
    executablePath,
    provenance,
    error,
  }
}

function boundedError(error: unknown): string {
  if (error instanceof ComponentManagerError) return error.message.slice(0, 240)
  return 'The component could not be installed.'
}

function abortError(): ComponentManagerError {
  return new ComponentManagerError('cancelled', 'Component installation was cancelled.')
}

async function readWithAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  if (signal.aborted) throw abortError()
  let remove: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    remove = () => signal.removeEventListener('abort', onAbort)
  })
  try { return await Promise.race([reader.read(), aborted]) } finally { remove?.() }
}

async function fetchArtifact(entry: ComponentCatalogEntry, signal: AbortSignal, emit: (progress: number | null, detail: string) => void, fetchImpl?: typeof fetch): Promise<Uint8Array> {
  const request = fetchImpl ?? globalThis.fetch
  if (typeof request !== 'function') throw new ComponentManagerError('download-failed', 'Component download is unavailable in this desktop build.')
  let url = validateComponentSource(entry.source, entry).source
  let response: Response | null = null
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    try {
      response = await request(url, { method: 'GET', headers: { accept: 'application/octet-stream' }, redirect: 'manual', signal })
    } catch (error) {
      if (signal.aborted) throw abortError()
      throw new ComponentManagerError('download-failed', error instanceof Error ? 'The official component download could not be reached.' : 'The official component download failed.')
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === MAX_REDIRECTS) throw new ComponentManagerError('download-failed', 'The official component download used an unsupported redirect.')
      let next: URL
      try { next = new URL(location, url) } catch { throw new ComponentManagerError('download-failed', 'The official component download used an invalid redirect.') }
      if (next.protocol !== 'https:' || !['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(next.hostname) || (next.port !== '' && next.port !== '443') || next.username || next.password || next.hash || next.href.length > 8_192) {
        throw new ComponentManagerError('download-failed', 'The official component download used an unapproved redirect.')
      }
      url = next.href
      continue
    }
    break
  }
  if (!response || !response.ok) throw new ComponentManagerError('download-failed', 'The official component download returned an HTTP error.')
  const declaredLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) throw new ComponentManagerError('download-failed', 'The component download is larger than the safety limit.')
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new ComponentManagerError('download-failed', 'The component download is larger than the safety limit.')
    emit(90, 'Download complete.')
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await readWithAbort(reader, signal)
      if (next.done) break
      if (!next.value || next.value.byteLength === 0) continue
      total += next.value.byteLength
      if (total > MAX_DOWNLOAD_BYTES) throw new ComponentManagerError('download-failed', 'The component download is larger than the safety limit.')
      chunks.push(next.value)
      const progress = Number.isFinite(declaredLength) && declaredLength > 0 ? Math.min(90, Math.floor(total / declaredLength * 90)) : null
      emit(progress, progress === null ? 'Downloading official component…' : 'Downloading official component… ' + progress + '%')
    }
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map(value => Buffer.from(value)), total)
}

function manifestFrom(value: unknown): ComponentManifest | null {
  if (!isRecord(value) || value.schemaVersion !== COMPONENT_MANAGER_SCHEMA_VERSION || value.id !== LLAMA_BENCH_COMPONENT_ID || value.version !== LLAMA_BENCH_COMPONENT_VERSION || typeof value.executableRelativePath !== 'string' || !isRecord(value.provenance)) return null
  const provenance = value.provenance
  if (provenance.repository !== 'https://github.com/ggml-org/llama.cpp' || typeof provenance.source !== 'string' || typeof provenance.version !== 'string' || typeof provenance.checksum !== 'string' || provenance.checksumVerified !== true || typeof provenance.installedAt !== 'string') return null
  try { safeRelativePath(value.executableRelativePath) } catch { return null }
  try { validateComponentSource(provenance.source) } catch { return null }
  if (!/^sha256:[0-9a-f]{64}$/u.test(provenance.checksum)) return null
  return value as unknown as ComponentManifest
}

export class ComponentManager {
  private readonly rootDir: string
  private readonly platform: string
  private readonly arch: string
  private readonly catalog: ComponentCatalogEntry | null | undefined
  private readonly fetchImpl?: typeof fetch
  private readonly now: () => Date
  private readonly onEvent?: (event: ComponentInstallEvent) => void
  private readonly statuses = new Map<ComponentId, ComponentStatus>()
  private readonly flights = new Map<ComponentId, ComponentFlight>()

  constructor(options: ComponentManagerOptions) {
    this.rootDir = resolve(options.rootDir)
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.catalog = options.catalog
    this.fetchImpl = options.fetchImpl
    this.now = options.now ?? (() => new Date())
    this.onEvent = options.onEvent
  }

  private entry(): ComponentCatalogEntry | null {
    return this.catalog === undefined ? getLlamaBenchCatalogEntry(this.platform, this.arch) : this.catalog
  }

  private componentRoot(): string {
    return join(this.rootDir, COMPONENT_DIRECTORY, LLAMA_BENCH_COMPONENT_ID)
  }

  private manifestPath(entry: ComponentCatalogEntry): string {
    return join(this.componentRoot(), entry.version, 'component.json')
  }

  private emit(status: ComponentStatus): ComponentStatus {
    const copy: ComponentStatus = { ...status, provenance: status.provenance ? { ...status.provenance } : null }
    this.statuses.set(LLAMA_BENCH_COMPONENT_ID, copy)
    try { this.onEvent?.(copy) } catch { /* UI event delivery is advisory. */ }
    return copy
  }

  private async installedStatus(entry: ComponentCatalogEntry): Promise<ComponentStatus | null> {
    try {
      const raw = JSON.parse(await readFile(this.manifestPath(entry), 'utf8')) as unknown
      const manifest = manifestFrom(raw)
      if (!manifest || manifest.provenance.source !== entry.source || manifest.provenance.version !== entry.version || manifest.provenance.checksum !== entry.checksum) return null
      const installDir = join(this.componentRoot(), entry.version)
      const executableRelativePath = safeRelativePath(manifest.executableRelativePath)
      const executablePath = join(installDir, executableRelativePath)
      ensureInside(installDir, executablePath)
      const info = await stat(executablePath)
      if (!info.isFile()) return null
      return statusBase(entry, 'installed', 'installed', 'Managed llama-bench component is installed and checksum-verified.', null, 100, executablePath, manifest.provenance)
    } catch {
      return null
    }
  }

  async getStatus(id: string = LLAMA_BENCH_COMPONENT_ID): Promise<ComponentStatus> {
    if (id !== LLAMA_BENCH_COMPONENT_ID) throw new ComponentManagerError('invalid-component', 'Unknown component.')
    const active = this.flights.get(LLAMA_BENCH_COMPONENT_ID)
    if (active) return this.statuses.get(LLAMA_BENCH_COMPONENT_ID) ?? statusBase(this.entry(), 'installing', 'downloading', 'Preparing component download.', null, 0)
    const remembered = this.statuses.get(LLAMA_BENCH_COMPONENT_ID)
    if (remembered?.state === 'failed' || remembered?.state === 'cancelled') return { ...remembered, provenance: remembered.provenance ? { ...remembered.provenance } : null }
    const entry = this.entry()
    if (!entry) return statusBase(null, 'unsupported', 'idle', 'No official llama-bench artifact is available for this platform.', null, null)
    const installed = await this.installedStatus(entry)
    if (installed) return this.emit(installed)
    return this.emit(statusBase(entry, 'not-installed', 'idle', 'llama-bench is not installed. Install the official Metrora-managed component.', null, null))
  }

  async install(id: string = LLAMA_BENCH_COMPONENT_ID): Promise<ComponentStatus> {
    if (id !== LLAMA_BENCH_COMPONENT_ID) throw new ComponentManagerError('invalid-component', 'Unknown component.')
    const existing = this.flights.get(LLAMA_BENCH_COMPONENT_ID)
    if (existing) return existing.promise
    const entry = this.entry()
    if (!entry) {
      const status = statusBase(null, 'unsupported', 'idle', 'No official llama-bench artifact is available for this platform.', 'This platform is not supported by the current official artifact catalog.')
      this.emit(status)
      throw new ComponentManagerError('unsupported-platform', status.error ?? 'This platform is not supported by the current official artifact catalog.')
    }
    const controller = new AbortController()
    const promise = (async () => {
      const installed = await this.installedStatus(entry)
      if (installed) return this.emit(installed)
      return this.performInstall(entry, controller)
    })()
    this.flights.set(LLAMA_BENCH_COMPONENT_ID, { controller, promise })
    try { return await promise } finally { if (this.flights.get(LLAMA_BENCH_COMPONENT_ID)?.promise === promise) this.flights.delete(LLAMA_BENCH_COMPONENT_ID) }
  }

  cancel(id: string = LLAMA_BENCH_COMPONENT_ID): boolean {
    if (id !== LLAMA_BENCH_COMPONENT_ID) return false
    const flight = this.flights.get(LLAMA_BENCH_COMPONENT_ID)
    if (!flight) return false
    flight.controller.abort()
    return true
  }

  private async performInstall(entry: ComponentCatalogEntry, controller: AbortController): Promise<ComponentStatus> {
    const staging = join(this.componentRoot(), '.staging-' + process.pid + '-' + Date.now().toString(36))
    let installedDir: string | null = null
    const emit = (status: ComponentStatus): ComponentStatus => this.emit(status)
    emit(statusBase(entry, 'installing', 'downloading', 'Preparing official component download.', null, 0))
    try {
      await rm(staging, { recursive: true, force: true })
      await mkdir(staging, { recursive: true })
      const bytes = await fetchArtifact(entry, controller.signal, (progress, detail) => emit(statusBase(entry, 'installing', 'downloading', detail, null, progress)), this.fetchImpl)
      if (controller.signal.aborted) throw abortError()
      emit(statusBase(entry, 'installing', 'verifying', 'Verifying the official component checksum.', null, 94))
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (!SHA256_PATTERN.test(digest) || 'sha256:' + digest !== entry.checksum) throw new ComponentManagerError('checksum-mismatch', 'The downloaded component checksum did not match the authoritative checksum.')
      emit(statusBase(entry, 'installing', 'extracting', 'Extracting and validating the managed component.', null, 97))
      const payload = join(staging, 'payload')
      await mkdir(payload, { recursive: true })
      const executableRelativePath = await extractArchive(bytes, entry.archiveFormat, payload, entry.executableNames)
      if (controller.signal.aborted) throw abortError()
      const installDir = join(this.componentRoot(), entry.version)
      ensureInside(this.componentRoot(), installDir)
      await rm(installDir, { recursive: true, force: true })
      await rename(payload, installDir)
      installedDir = installDir
      const provenance: ComponentProvenance = {
        repository: entry.repository,
        source: entry.source,
        version: entry.version,
        checksum: entry.checksum,
        checksumVerified: true,
        installedAt: this.now().toISOString(),
      }
      const manifest: ComponentManifest = { schemaVersion: COMPONENT_MANAGER_SCHEMA_VERSION, id: entry.id, version: entry.version, executableRelativePath, provenance }
      await writeFile(join(installDir, 'component.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
      const executablePath = join(installDir, executableRelativePath)
      const installed = statusBase(entry, 'installed', 'installed', 'Managed llama-bench component installed and verified.', null, 100, executablePath, provenance)
      emit(installed)
      await rm(staging, { recursive: true, force: true })
      return installed
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      if (installedDir) await rm(installedDir, { recursive: true, force: true }).catch(() => undefined)
      if (controller.signal.aborted || (error instanceof ComponentManagerError && error.code === 'cancelled')) {
        const cancelled = statusBase(entry, 'cancelled', 'cancelled', 'Component installation was cancelled. Retry when ready.', null, null)
        emit(cancelled)
        throw abortError()
      }
      const failure = error instanceof ComponentManagerError ? error : new ComponentManagerError('download-failed', 'The component could not be installed.')
      emit(statusBase(entry, 'failed', 'failed', 'Component installation failed. Retry is available.', boundedError(failure), null))
      throw failure
    }
  }
}

export function createComponentManager(options: ComponentManagerOptions): ComponentManager {
  return new ComponentManager(options)
}
