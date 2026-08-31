import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { ComponentArchiveError, extractArchive, safeRelativePath, type ArchiveFormat } from './component-archive'

export const COMPONENT_MANAGER_SCHEMA_VERSION = 'metrora.component.v1' as const
export const LLAMA_BENCH_COMPONENT_ID = 'llama-bench' as const
export const LLAMA_BENCH_COMPONENT_NAME = 'llama.cpp benchmark runtime' as const
export const LLAMA_BENCH_COMPONENT_VERSION = 'b10621' as const

const COMPONENT_DIRECTORY = 'components'
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const MAX_REDIRECTS = 3
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

type LlamaBenchAsset = {
  assetName: string
  archiveFormat: ArchiveFormat
  checksum: string
  backend: 'cpu'
  variant: 'cpu'
}

const LLAMA_BENCH_ASSETS: Record<string, LlamaBenchAsset> = {
  'win32-x64': {
    assetName: 'llama-b10621-bin-win-cpu-x64.zip',
    archiveFormat: 'zip',
    checksum: '0e8b65e650e369f70f8307d890508886f171ef4fb00facccddd4a1b7ffdaca51',
    backend: 'cpu',
    variant: 'cpu',
  },
  'win32-arm64': {
    assetName: 'llama-b10621-bin-win-cpu-arm64.zip',
    archiveFormat: 'zip',
    checksum: 'c072e8bb057751587243c1e0ed28d82e23c7e0544a426e0d476f1e77792bf3ce',
    backend: 'cpu',
    variant: 'cpu',
  },
  'darwin-x64': {
    assetName: 'llama-b10621-bin-macos-x64.tar.gz',
    archiveFormat: 'tar.gz',
    checksum: '33c44e036e0e223f71a29fc74a0ab3e130ca9eadeb032ecc1c7af25985b8b91b',
    backend: 'cpu',
    variant: 'cpu',
  },
  'darwin-arm64': {
    assetName: 'llama-b10621-bin-macos-arm64.tar.gz',
    archiveFormat: 'tar.gz',
    checksum: '429c8270608600188035e5e92f7d78dffb7900904fe7dd7e6a84f48068cd13cf',
    backend: 'cpu',
    variant: 'cpu',
  },
  'linux-x64': {
    assetName: 'llama-b10621-bin-ubuntu-x64.tar.gz',
    archiveFormat: 'tar.gz',
    checksum: '91d7b03ddae498a39f28fdb85d84d2b4a0fd3838d10b4f897e0ef8975bb9b583',
    backend: 'cpu',
    variant: 'cpu',
  },
  'linux-arm64': {
    assetName: 'llama-b10621-bin-ubuntu-arm64.tar.gz',
    archiveFormat: 'tar.gz',
    checksum: '95940151be63492f70f659da420b268244cc83a6ee70e310d2600ccdb7ea4deb',
    backend: 'cpu',
    variant: 'cpu',
  },
}

const EXECUTABLE_NAMES = ['llama-bench', 'llama-bench.exe'] as const

export type ComponentId = typeof LLAMA_BENCH_COMPONENT_ID
export type ComponentBackend = 'cpu'
export type ComponentVariant = 'cpu'
export type ComponentInstallState = 'not-installed' | 'installing' | 'installed' | 'failed' | 'cancelled' | 'unsupported'
export type ComponentInstallPhase = 'idle' | 'downloading' | 'verifying' | 'extracting' | 'installed' | 'failed' | 'cancelled'

export type ComponentProvenance = {
  repository: string
  source: string
  version: string
  checksum: string
  checksumVerified: true
  backend: ComponentBackend
  variant: ComponentVariant
  installedAt: string
}

export type ComponentStatus = {
  schemaVersion: typeof COMPONENT_MANAGER_SCHEMA_VERSION
  id: ComponentId
  name: typeof LLAMA_BENCH_COMPONENT_NAME
  state: ComponentInstallState
  phase: ComponentInstallPhase
  version: string | null
  backend: ComponentBackend | null
  variant: ComponentVariant | null
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
  backend: ComponentBackend
  variant: ComponentVariant
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
    backend: asset.backend,
    variant: asset.variant,
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

function ensureInside(root: string, candidate: string): void {
  const rootPath = resolve(root)
  const candidatePath = resolve(candidate)
  const rest = relative(rootPath, candidatePath)
  if (rest === '..' || rest.startsWith('..' + sep) || rest.startsWith(sep) || /^[A-Za-z]:/u.test(rest)) {
    throw new ComponentManagerError('archive-invalid', 'Component archive escaped its managed directory.')
  }
}

function statusBase(entry: ComponentCatalogEntry | null, state: ComponentInstallState, phase: ComponentInstallPhase, detail: string, error: string | null = null, progress: number | null = null, executablePath: string | null = null, provenance: ComponentProvenance | null = null): ComponentStatus {
  return {
    schemaVersion: COMPONENT_MANAGER_SCHEMA_VERSION,
    id: LLAMA_BENCH_COMPONENT_ID,
    name: LLAMA_BENCH_COMPONENT_NAME,
    state,
    phase,
    version: entry?.version ?? null,
    backend: entry?.backend ?? null,
    variant: entry?.variant ?? null,
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
  if (provenance.repository !== 'https://github.com/ggml-org/llama.cpp' || typeof provenance.source !== 'string' || typeof provenance.version !== 'string' || typeof provenance.checksum !== 'string' || provenance.checksumVerified !== true || provenance.backend !== 'cpu' || provenance.variant !== 'cpu' || typeof provenance.installedAt !== 'string') return null
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
      if (!manifest || manifest.provenance.source !== entry.source || manifest.provenance.version !== entry.version || manifest.provenance.checksum !== entry.checksum || manifest.provenance.backend !== entry.backend || manifest.provenance.variant !== entry.variant) return null
      const installDir = join(this.componentRoot(), entry.version)
      const executableRelativePath = safeRelativePath(manifest.executableRelativePath)
      const executablePath = join(installDir, executableRelativePath)
      ensureInside(installDir, executablePath)
      const info = await stat(executablePath)
      if (!info.isFile()) return null
      return statusBase(entry, 'installed', 'installed', 'Managed llama-bench CPU component is installed and checksum-verified.', null, 100, executablePath, manifest.provenance)
    } catch {
      return null
    }
  }

  async getStatus(id: string = LLAMA_BENCH_COMPONENT_ID): Promise<ComponentStatus> {
    if (id !== LLAMA_BENCH_COMPONENT_ID) throw new ComponentManagerError('invalid-component', 'Unknown component.')
    const active = this.flights.get(LLAMA_BENCH_COMPONENT_ID)
    if (active) return this.statuses.get(LLAMA_BENCH_COMPONENT_ID) ?? statusBase(this.entry(), 'installing', 'downloading', 'Preparing official CPU component download.', null, 0)
    const remembered = this.statuses.get(LLAMA_BENCH_COMPONENT_ID)
    if (remembered?.state === 'failed' || remembered?.state === 'cancelled') return { ...remembered, provenance: remembered.provenance ? { ...remembered.provenance } : null }
    const entry = this.entry()
    if (!entry) return statusBase(null, 'unsupported', 'idle', 'No official llama-bench artifact is available for this platform.', null, null)
    const installed = await this.installedStatus(entry)
    if (installed) return this.emit(installed)
    return this.emit(statusBase(entry, 'not-installed', 'idle', 'The official Metrora-managed llama-bench CPU component is not installed.', null, null))
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
    emit(statusBase(entry, 'installing', 'downloading', 'Preparing official CPU component download.', null, 0))
    try {
      await rm(staging, { recursive: true, force: true })
      await mkdir(staging, { recursive: true })
      const bytes = await fetchArtifact(entry, controller.signal, (progress, detail) => emit(statusBase(entry, 'installing', 'downloading', detail, null, progress)), this.fetchImpl)
      if (controller.signal.aborted) throw abortError()
      emit(statusBase(entry, 'installing', 'verifying', 'Verifying the official component checksum.', null, 94))
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (!SHA256_PATTERN.test(digest) || 'sha256:' + digest !== entry.checksum) throw new ComponentManagerError('checksum-mismatch', 'The downloaded component checksum did not match the authoritative checksum.')
      emit(statusBase(entry, 'installing', 'extracting', 'Extracting and validating the managed CPU component.', null, 97))
      const payload = join(staging, 'payload')
      await mkdir(payload, { recursive: true })
      let executableRelativePath: string
      try {
        executableRelativePath = await extractArchive(bytes, entry.archiveFormat, payload, entry.executableNames)
      } catch (error) {
        if (error instanceof ComponentArchiveError) throw new ComponentManagerError('archive-invalid', error.message)
        throw error
      }
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
        backend: entry.backend,
        variant: entry.variant,
        installedAt: this.now().toISOString(),
      }
      const manifest: ComponentManifest = { schemaVersion: COMPONENT_MANAGER_SCHEMA_VERSION, id: entry.id, version: entry.version, executableRelativePath, provenance }
      await writeFile(join(installDir, 'component.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
      const executablePath = join(installDir, executableRelativePath)
      const installed = statusBase(entry, 'installed', 'installed', 'Managed llama-bench CPU component installed and verified.', null, 100, executablePath, provenance)
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
