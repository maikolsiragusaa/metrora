import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { runtimePaths } from './config'
import { readOpenCodeSessionMetadata, snapshotOpenCodeDatabase, type OpenCodeSessionMetadata, type OpenCodeSessionMetadataRead } from './storage'
import type { OpenCodeCommandEnvironment } from './runtime'
import { createStandaloneOpenCodeEnvironment, resolveStandaloneOpenCodeRuntime, type StandaloneOpenCodeResolverOptions, type StandaloneOpenCodeRuntime } from './standalone'

export const OPEN_CODE_IMPORT_REASONS = [
  'standalone-not-found',
  'export-unavailable',
  'incompatible-export',
  'directory-unavailable',
  'import-failed',
  'cancelled',
] as const

export type OpenCodeImportReason = typeof OPEN_CODE_IMPORT_REASONS[number]

export type OpenCodeImportResult = {
  discovered: number
  newSessions: number
  imported: number
  alreadyPresent: number
  skipped: number
  failed: number
  reason: OpenCodeImportReason | null
  reasons: Array<{ reason: OpenCodeImportReason; count: number }>
}

export type OpenCodeCommandRequest = {
  executablePath: string
  args: string[]
  cwd: string
  environment: NodeJS.ProcessEnv
  stdoutPath?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export type OpenCodeCommandResult = {
  code: number | null
  stderr: string
  timedOut: boolean
  cancelled?: boolean
}

export type OpenCodeCommandRunner = (request: OpenCodeCommandRequest) => Promise<OpenCodeCommandResult>

export type OpenCodeSessionImporterOptions = {
  userDataPath: string
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  standaloneResolver?: () => Promise<StandaloneOpenCodeRuntime | null>
  standaloneResolverOptions?: Omit<StandaloneOpenCodeResolverOptions, 'environment' | 'platform' | 'excludedRoots'>
  readSessionMetadata?: (databasePath: string) => Promise<OpenCodeSessionMetadataRead>
  snapshotDatabase?: (sourcePath: string, destinationPath: string) => Promise<void>
  directoryIsAvailable?: (directory: string) => Promise<boolean>
  commandRunner?: OpenCodeCommandRunner
  getMetroraCommand: () => Promise<OpenCodeCommandEnvironment>
  runWithRuntimeStopped: <T>(operation: () => Promise<T>) => Promise<T>
}

type ImportCandidate = {
  session: OpenCodeSessionMetadata
  directory: string
}

type ImportPlan = {
  standalone: StandaloneOpenCodeRuntime | null
  candidates: ImportCandidate[]
  result: OpenCodeImportResult
}

const EXPORT_TIMEOUT_MS = 10 * 60_000
const IMPORT_TIMEOUT_MS = 10 * 60_000
const MAX_EXPORT_BYTES = 128 * 1024 * 1024
const MAX_STDERR_BYTES = 8 * 1024
const TEMP_DIRECTORY_NAME = 'opencode-session-import'

function platformPath(platform: NodeJS.Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix
}

function emptyResult(reason: OpenCodeImportReason | null = null): OpenCodeImportResult {
  return { discovered: 0, newSessions: 0, imported: 0, alreadyPresent: 0, skipped: 0, failed: 0, reason, reasons: [] }
}

function addReason(result: OpenCodeImportResult, reason: OpenCodeImportReason, count = 1): void {
  if (count < 1) return
  result.reason ??= reason
  const existing = result.reasons.find(item => item.reason === reason)
  if (existing) existing.count += count
  else result.reasons.push({ reason, count })
}

function uniqueSessions(sessions: readonly OpenCodeSessionMetadata[]): OpenCodeSessionMetadata[] {
  const seen = new Set<string>()
  const unique: OpenCodeSessionMetadata[] = []
  for (const session of sessions) {
    if (seen.has(session.id)) continue
    seen.add(session.id)
    unique.push(session)
  }
  return unique
}

function isSafeDirectoryValue(directory: string, platform: NodeJS.Platform): boolean {
  return directory.length > 0
    && directory.length <= 32_768
    && !/[\u0000-\u001f\u007f]/u.test(directory)
    && platformPath(platform).isAbsolute(directory)
}

async function defaultDirectoryIsAvailable(directory: string): Promise<boolean> {
  try { return (await stat(directory)).isDirectory() } catch { return false }
}

function cancellationResult(base: OpenCodeImportResult, pending: number): OpenCodeImportResult {
  const result = { ...base, reasons: base.reasons.map(item => ({ ...item })) }
  result.failed += pending
  addReason(result, 'cancelled', pending)
  return result
}

class OpenCodeImportCancelled extends Error {
  constructor(readonly result: OpenCodeImportResult, readonly pending: number) {
    super('OpenCode import was cancelled.')
    this.name = 'OpenCodeImportCancelled'
  }
}

function validateExportShape(value: unknown, expectedId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const exportData = value as { info?: unknown; messages?: unknown }
  if (!exportData.info || typeof exportData.info !== 'object' || Array.isArray(exportData.info)) return false
  const id = (exportData.info as { id?: unknown }).id
  return id === expectedId && Array.isArray(exportData.messages)
}

async function validateExportFile(filePath: string, expectedId: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size < 2 || info.size > MAX_EXPORT_BYTES) return false
    const raw = await readFile(filePath, 'utf8')
    return validateExportShape(JSON.parse(raw) as unknown, expectedId)
  } catch {
    return false
  }
}

/**
 * Run one official OpenCode command without a shell. Export stdout is streamed
 * to the private temporary file and bounded; stderr is never logged or sent to
 * the renderer because it may contain provider paths or other sensitive data.
 */
export const runOpenCodeCommand: OpenCodeCommandRunner = async request => {
  const timeoutMs = request.timeoutMs ?? EXPORT_TIMEOUT_MS
  if (request.signal?.aborted) return { code: null, stderr: '', timedOut: false, cancelled: true }
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(request.executablePath, request.args, {
      cwd: request.cwd,
      env: request.environment,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', request.stdoutPath ? 'pipe' : 'ignore', 'pipe'],
    })
  } catch {
    return { code: null, stderr: '', timedOut: false, cancelled: request.signal?.aborted ?? false }
  }

  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', chunk => {
    if (stderr.length >= MAX_STDERR_BYTES) return
    stderr += String(chunk).slice(0, MAX_STDERR_BYTES - stderr.length)
  })

  let timedOut = false
  let cancelled = request.signal?.aborted ?? false
  const onAbort = () => {
    cancelled = true
    try { child.kill() } catch { /* best effort */ }
  }
  request.signal?.addEventListener('abort', onAbort, { once: true })
  if (request.signal?.aborted) onAbort()
  const timer = setTimeout(() => {
    timedOut = true
    try { child.kill() } catch { /* best effort */ }
  }, timeoutMs)
  timer.unref?.()

  const output = request.stdoutPath && child.stdout
    ? (() => {
        let bytes = 0
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.byteLength
            if (bytes > MAX_EXPORT_BYTES) {
              callback(new Error('OpenCode export exceeded the bounded size.'))
              return
            }
            callback(null, chunk)
          },
        })
        return pipeline(child.stdout, limiter, createWriteStream(request.stdoutPath, { flags: 'wx', mode: 0o600 }))
      })()
    : Promise.resolve()

  const exit = new Promise<number | null>(resolve => {
    child.once('error', () => resolve(null))
    child.once('exit', code => resolve(code))
  })
  let outputError = false
  try {
    await Promise.all([exit, output.catch(() => { outputError = true; try { child.kill() } catch { /* best effort */ } })])
  } finally {
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onAbort)
  }
  const code = await exit
  return { code: outputError || timedOut || cancelled ? null : code, stderr, timedOut, cancelled }
}

export class OpenCodeSessionImporter {
  private flight: Promise<OpenCodeImportResult> | null = null
  private activeCancellation: AbortController | null = null

  constructor(private readonly options: OpenCodeSessionImporterOptions) {}

  cancel(): void {
    this.activeCancellation?.abort()
  }

  importNewSessions(): Promise<OpenCodeImportResult> {
    if (this.flight) return this.flight
    const cancellation = new AbortController()
    this.activeCancellation = cancellation
    const promise = this.importInternal(cancellation.signal)
    this.flight = promise
    void promise.finally(() => {
      if (this.flight === promise) this.flight = null
      if (this.activeCancellation === cancellation) this.activeCancellation = null
    }).catch(() => {})
    return promise
  }

  private async importInternal(signal: AbortSignal): Promise<OpenCodeImportResult> {
    let plan: ImportPlan | null = null
    try {
      plan = await this.buildPlan()
    } catch {
      return emptyResult('export-unavailable')
    }
    if (!plan) return emptyResult('export-unavailable')
    if (plan.candidates.length === 0) return plan.result
    if (signal.aborted) return cancellationResult(plan.result, plan.candidates.length)

    try {
      return await this.options.runWithRuntimeStopped(() => this.importPlan(plan!, signal))
    } catch (error) {
      if (error instanceof OpenCodeImportCancelled) return cancellationResult(error.result, error.pending)
      const isCancelled = signal.aborted || error instanceof Error && /cancelled|shutdown/i.test(error.message)
      return isCancelled ? cancellationResult(plan.result, plan.candidates.length) : (() => {
        const result = { ...plan.result, reasons: plan.result.reasons.map(item => ({ ...item })) }
        result.failed += plan.candidates.length
        addReason(result, 'import-failed', plan.candidates.length)
        return result
      })()
    }
  }

  private async buildPlan(): Promise<ImportPlan | null> {
    const platform = this.options.platform ?? process.platform
    const standalone = this.options.standaloneResolver
      ? await this.options.standaloneResolver()
      : await resolveStandaloneOpenCodeRuntime({
          ...this.options.standaloneResolverOptions,
          platform,
          environment: this.options.environment,
          excludedRoots: [this.options.userDataPath],
        })
    if (!standalone) return { standalone: null, candidates: [], result: emptyResult('standalone-not-found') }
    if (!standalone.databasePath) return { standalone, candidates: [], result: emptyResult() }

    const readMetadata = this.options.readSessionMetadata ?? readOpenCodeSessionMetadata
    const source = await readMetadata(standalone.databasePath)
    if (source.kind === 'missing') return { standalone, candidates: [], result: emptyResult() }
    if (source.kind === 'incompatible') return { standalone, candidates: [], result: emptyResult('incompatible-export') }
    if (source.kind !== 'ok') return { standalone, candidates: [], result: emptyResult('export-unavailable') }

    const destinationDatabasePath = runtimePaths(this.options.userDataPath).databasePath
    const destination = await readMetadata(destinationDatabasePath)
    if (destination.kind !== 'ok' && destination.kind !== 'missing') {
      return { standalone, candidates: [], result: emptyResult('import-failed') }
    }
    const existingIds = new Set(destination.kind === 'ok' ? destination.sessions.map(session => session.id) : [])
    const sessions = uniqueSessions(source.sessions)
    const result = emptyResult()
    result.discovered = sessions.length
    const fresh = sessions.filter(session => {
      if (existingIds.has(session.id)) {
        result.alreadyPresent += 1
        return false
      }
      result.newSessions += 1
      return true
    })

    const directoryIsAvailable = this.options.directoryIsAvailable ?? defaultDirectoryIsAvailable
    const candidates: ImportCandidate[] = []
    for (const session of fresh) {
      if (!session.directory || !isSafeDirectoryValue(session.directory, platform) || !(await directoryIsAvailable(session.directory))) {
        result.skipped += 1
        addReason(result, 'directory-unavailable')
        continue
      }
      candidates.push({ session, directory: session.directory })
    }
    return { standalone, candidates, result }
  }

  private async importPlan(plan: ImportPlan, signal: AbortSignal): Promise<OpenCodeImportResult> {
    const result = { ...plan.result, reasons: plan.result.reasons.map(item => ({ ...item })) }
    const command = await this.options.getMetroraCommand()
    const runCommand = this.options.commandRunner ?? runOpenCodeCommand
    const tempRoot = path.join(this.options.userDataPath, 'temp', TEMP_DIRECTORY_NAME)
    await mkdir(tempRoot, { recursive: true, mode: 0o700 })
    const snapshotPath = path.join(tempRoot, `${randomUUID()}.db`)
    const standaloneRoot = path.join(tempRoot, `${randomUUID()}-standalone`)
    const importedIds: string[] = []
    let pending = plan.candidates.length
    const throwIfCancelled = () => {
      if (signal.aborted) throw new OpenCodeImportCancelled(result, pending)
    }

    try {
      throwIfCancelled()
      try {
        await (this.options.snapshotDatabase ?? snapshotOpenCodeDatabase)(plan.standalone!.databasePath!, snapshotPath)
      } catch {
        result.failed += plan.candidates.length
        addReason(result, 'export-unavailable', plan.candidates.length)
        return result
      }

      const standalone = {
        ...plan.standalone!,
        databasePath: snapshotPath,
        environment: createStandaloneOpenCodeEnvironment({
          baseEnvironment: this.options.environment ?? plan.standalone!.environment,
          databasePath: snapshotPath,
          excludedRoots: [this.options.userDataPath],
          platform: this.options.platform ?? process.platform,
          isolatedRoot: standaloneRoot,
        }),
      }

      for (const candidate of plan.candidates) {
        throwIfCancelled()
        const exportPath = path.join(tempRoot, `${randomUUID()}.json`)
        let stage: 'export' | 'validate' | 'import' = 'export'
        try {
          const exported = await runCommand({
            executablePath: standalone.executablePath,
            args: ['export', candidate.session.id],
            cwd: candidate.directory,
            environment: standalone.environment,
            stdoutPath: exportPath,
            timeoutMs: EXPORT_TIMEOUT_MS,
            signal,
          })
          if (exported.cancelled || signal.aborted) throw new OpenCodeImportCancelled(result, pending)
          if (exported.code !== 0) {
            result.failed += 1
            addReason(result, 'export-unavailable')
            continue
          }

          stage = 'validate'
          const validExport = await validateExportFile(exportPath, candidate.session.id)
          throwIfCancelled()
          if (!validExport) {
            result.skipped += 1
            addReason(result, 'incompatible-export')
            continue
          }

          stage = 'import'
          const imported = await runCommand({
            executablePath: command.executablePath,
            args: ['import', exportPath],
            cwd: candidate.directory,
            environment: command.environment,
            timeoutMs: IMPORT_TIMEOUT_MS,
            signal,
          })
          if (imported.cancelled || signal.aborted) throw new OpenCodeImportCancelled(result, pending)
          if (imported.code !== 0) {
            result.failed += 1
            addReason(result, 'import-failed')
            continue
          }
          result.imported += 1
          importedIds.push(candidate.session.id)
        } catch (error) {
          if (error instanceof OpenCodeImportCancelled) throw error
          if (stage === 'validate') {
            result.skipped += 1
            addReason(result, 'incompatible-export')
          } else {
            result.failed += 1
            addReason(result, stage === 'export' ? 'export-unavailable' : 'import-failed')
          }
        } finally {
          await rm(exportPath, { force: true }).catch(() => {})
          pending -= 1
        }
      }

      throwIfCancelled()
      if (importedIds.length > 0) {
        const after = await (this.options.readSessionMetadata ?? readOpenCodeSessionMetadata)(command.paths.databasePath)
        throwIfCancelled()
        if (after.kind !== 'ok') {
          result.failed += result.imported
          addReason(result, 'import-failed', result.imported)
          result.imported = 0
        } else {
          const actualIds = new Set(after.sessions.map(session => session.id))
          const missing = importedIds.filter(id => !actualIds.has(id)).length
          if (missing > 0) {
            result.imported -= missing
            result.failed += missing
            addReason(result, 'import-failed', missing)
          }
        }
      }
      return result
    } finally {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        await rm(`${snapshotPath}${suffix}`, { force: true }).catch(() => {})
      }
      await rm(standaloneRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}
