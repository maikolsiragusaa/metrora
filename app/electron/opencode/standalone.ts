import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { OPENCODE_VERSION } from './types'

const execFileAsync = promisify(execFile)
const PROBE_TIMEOUT_MS = 5_000
const PROBE_MAX_OUTPUT_BYTES = 64 * 1024
const SUPPORTED_EXPORT_FAMILY = OPENCODE_VERSION.split('.').slice(0, 2).join('.')
const WINDOWS_DESKTOP_APP_IDS = ['ai.opencode.desktop', 'ai.opencode.desktop.beta', 'ai.opencode.desktop.dev'] as const

export type StandaloneOpenCodeRuntime = {
  executablePath: string
  version: string
  databasePath: string | null
  environment: NodeJS.ProcessEnv
}

export type StandaloneProbeResult = { stdout: string; stderr: string; code?: number | null }

export type StandaloneOpenCodeEnvironmentOptions = {
  baseEnvironment: NodeJS.ProcessEnv
  databasePath: string | null
  excludedRoots?: readonly string[]
  platform: NodeJS.Platform
  isolatedRoot?: string
}

export type StandaloneOpenCodeResolverOptions = {
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  homePath?: string
  appDataPath?: string
  localAppDataPath?: string
  programFilesPath?: string
  programFilesX86Path?: string
  excludedRoots?: string[]
  executableCandidates?: string[]
  databaseCandidates?: string[]
  probe?: (executablePath: string, args: string[], environment: NodeJS.ProcessEnv) => Promise<StandaloneProbeResult>
  fileExists?: (filePath: string) => Promise<boolean>
  readDirectory?: (directory: string) => Promise<string[]>
}

function platformPath(platform: NodeJS.Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix
}

function isAbsolute(value: string, platform: NodeJS.Platform): boolean {
  return platformPath(platform).isAbsolute(value)
}

function resolvePath(value: string, platform: NodeJS.Platform): string {
  return platformPath(platform).resolve(value)
}

function normalizeKey(value: string, platform: NodeJS.Platform): string {
  const normalized = platformPath(platform).normalize(resolvePath(value, platform))
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isWithin(parent: string, candidate: string, platform: NodeJS.Platform): boolean {
  const relative = platformPath(platform).relative(resolvePath(parent, platform), resolvePath(candidate, platform))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${platform === 'win32' ? '\\' : '/'}`))
}

function addUnique(values: string[], seen: Set<string>, value: string | undefined, platform: NodeJS.Platform): void {
  if (!value || !isAbsolute(value, platform)) return
  const key = normalizeKey(value, platform)
  if (seen.has(key)) return
  seen.add(key)
  values.push(resolvePath(value, platform))
}

function isExcluded(value: string, excludedRoots: readonly string[], platform: NodeJS.Platform): boolean {
  return excludedRoots.some(root => isWithin(root, value, platform))
}

function parseVersion(value: string): string | null {
  const match = value.match(/(?:^|\s)v?(\d+\.\d+\.\d+)(?:\s|$)/u)
  return match?.[1] ?? null
}

export function isStandaloneExportVersionCompatible(version: string): boolean {
  return version.split('.').slice(0, 2).join('.') === SUPPORTED_EXPORT_FAMILY
}

function standaloneEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  databasePath: string | null,
  excludedRoots: readonly string[],
  platform: NodeJS.Platform,
  isolatedRoot?: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...baseEnvironment }
  for (const key of Object.keys(environment)) {
    if (key.startsWith('METRORA_') || key.startsWith('OPENCODE_')) delete environment[key]
  }

  // Keep the standalone process on its own database and never carry a Metrora
  // runtime XDG root into it. Other provider credentials remain available.
  if (databasePath) {
    environment.OPENCODE_DB = databasePath
    const dataRoot = platformPath(platform).dirname(databasePath)
    if (isolatedRoot) {
      const join = platformPath(platform).join.bind(platformPath(platform))
      environment.XDG_DATA_HOME = join(isolatedRoot, 'data')
      environment.XDG_CACHE_HOME = join(isolatedRoot, 'cache')
      environment.XDG_STATE_HOME = join(isolatedRoot, 'state')
      environment.XDG_CONFIG_HOME = join(isolatedRoot, 'config')
    } else if (!isExcluded(dataRoot, excludedRoots, platform)) {
      environment.XDG_DATA_HOME = platformPath(platform).dirname(dataRoot)
    }
  }
  environment.OPENCODE_DISABLE_AUTOUPDATE = '1'
  return environment
}

export function createStandaloneOpenCodeEnvironment(options: StandaloneOpenCodeEnvironmentOptions): NodeJS.ProcessEnv {
  return standaloneEnvironment(
    options.baseEnvironment,
    options.databasePath,
    options.excludedRoots ?? [],
    options.platform,
    options.isolatedRoot,
  )
}

async function defaultProbe(executablePath: string, args: string[], environment: NodeJS.ProcessEnv): Promise<StandaloneProbeResult> {
  try {
    const result = await execFileAsync(executablePath, args, {
      env: environment,
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: PROBE_MAX_OUTPUT_BYTES,
    })
    return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), code: 0 }
  } catch (error) {
    const output = error as { stdout?: unknown; stderr?: unknown }
    const code = (error as { code?: unknown }).code
    return { stdout: String(output.stdout ?? ''), stderr: String(output.stderr ?? ''), code: typeof code === 'number' ? code : null }
  }
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function defaultReadDirectory(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

function buildExecutableCandidates(options: StandaloneOpenCodeResolverOptions, platform: NodeJS.Platform): string[] {
  const environment = options.environment ?? process.env
  const home = options.homePath ?? homedir()
  const appData = options.appDataPath ?? environment.APPDATA
  const localAppData = options.localAppDataPath ?? environment.LOCALAPPDATA
  const programFiles = options.programFilesPath ?? environment.ProgramFiles
  const programFilesX86 = options.programFilesX86Path ?? environment['ProgramFiles(x86)']
  const values: string[] = []
  const seen = new Set<string>()
  const join = platformPath(platform).join.bind(platformPath(platform))

  for (const value of [environment.METRORA_STANDALONE_OPENCODE_PATH, environment.OPENCODE_BINARY, environment.OPENCODE_EXECUTABLE]) {
    addUnique(values, seen, value, platform)
  }
  if (options.executableCandidates) {
    for (const value of options.executableCandidates) addUnique(values, seen, value, platform)
  }

  if (platform === 'win32') {
    const installRoots = [
      localAppData ? join(localAppData, 'Programs', '@opencode-aidesktop') : undefined,
      localAppData ? join(localAppData, 'Programs', 'OpenCode') : undefined,
      localAppData ? join(localAppData, 'Programs', 'opencode') : undefined,
      programFiles ? join(programFiles, 'OpenCode') : undefined,
      programFiles ? join(programFiles, 'opencode') : undefined,
      programFilesX86 ? join(programFilesX86, 'OpenCode') : undefined,
      programFilesX86 ? join(programFilesX86, 'opencode') : undefined,
    ]
    for (const root of installRoots) {
      if (!root) continue
      for (const relative of [
        ['resources', 'opencode-cli.exe'],
        ['resources', 'opencode.exe'],
        ['opencode-cli.exe'],
        ['opencode.exe'],
      ]) addUnique(values, seen, join(root, ...relative), platform)
    }
    if (appData) addUnique(values, seen, join(appData, 'npm', 'opencode.exe'), platform)
    addUnique(values, seen, join(home, '.opencode', 'bin', 'opencode.exe'), platform)
  } else {
    addUnique(values, seen, join(home, '.local', 'bin', 'opencode'), platform)
    addUnique(values, seen, join(home, '.opencode', 'bin', 'opencode'), platform)
    addUnique(values, seen, '/usr/local/bin/opencode', platform)
    addUnique(values, seen, '/opt/homebrew/bin/opencode', platform)
    if (platform === 'darwin') addUnique(values, seen, join(home, 'Applications', 'OpenCode.app', 'Contents', 'Resources', 'opencode-cli'), platform)
  }
  return values
}

async function buildDesktopCliCandidates(options: StandaloneOpenCodeResolverOptions, platform: NodeJS.Platform): Promise<string[]> {
  if (platform !== 'win32') return []
  const environment = options.environment ?? process.env
  const appData = options.appDataPath ?? environment.APPDATA
  const localAppData = options.localAppDataPath ?? environment.LOCALAPPDATA
  const values: string[] = []
  const seen = new Set<string>()
  const join = platformPath(platform).join.bind(platformPath(platform))
  const readDirectory = options.readDirectory ?? defaultReadDirectory

  for (const base of [appData, localAppData]) {
    if (!base) continue
    for (const appId of WINDOWS_DESKTOP_APP_IDS) {
      const cliRoot = join(base, appId, 'cli')
      for (const version of (await readDirectory(cliRoot)).sort().reverse()) {
        addUnique(values, seen, join(cliRoot, version, 'opencode-cli.exe'), platform)
      }
    }
  }
  return values
}

function buildDatabaseRoots(options: StandaloneOpenCodeResolverOptions, platform: NodeJS.Platform): string[] {
  const environment = options.environment ?? process.env
  const home = options.homePath ?? homedir()
  const appData = options.appDataPath ?? environment.APPDATA
  const localAppData = options.localAppDataPath ?? environment.LOCALAPPDATA
  const join = platformPath(platform).join.bind(platformPath(platform))
  const roots: string[] = []
  const seen = new Set<string>()
  const addRoot = (value: string | undefined) => {
    if (!value || !isAbsolute(value, platform) || seen.has(normalizeKey(value, platform))) return
    seen.add(normalizeKey(value, platform))
    roots.push(resolvePath(value, platform))
  }

  if (environment.OPENCODE_DATA_DIR) addRoot(environment.OPENCODE_DATA_DIR)
  if (environment.XDG_DATA_HOME) addRoot(join(environment.XDG_DATA_HOME, 'opencode'))
  if (platform === 'win32') {
    if (localAppData) addRoot(join(localAppData, 'opencode'))
    if (appData) addRoot(join(appData, 'opencode'))
    addRoot(join(home, '.local', 'share', 'opencode'))
  } else if (platform === 'darwin') {
    addRoot(join(home, 'Library', 'Application Support', 'opencode'))
    addRoot(join(home, '.local', 'share', 'opencode'))
  } else {
    addRoot(join(home, '.local', 'share', 'opencode'))
  }
  return roots
}

async function buildDatabaseCandidates(options: StandaloneOpenCodeResolverOptions, platform: NodeJS.Platform): Promise<string[]> {
  const environment = options.environment ?? process.env
  const roots = buildDatabaseRoots(options, platform)
  const values: string[] = []
  const seen = new Set<string>()
  const join = platformPath(platform).join.bind(platformPath(platform))
  const add = (value: string | undefined) => addUnique(values, seen, value, platform)

  add(environment.OPENCODE_DB)
  for (const value of options.databaseCandidates ?? []) add(value)
  for (const root of roots) {
    add(join(root, 'opencode.db'))
    // Channel-specific stores are bounded and deterministic. The stable DB
    // remains first, so the desktop's normal authority wins when present.
    let names: string[] = []
    try {
      names = (await readdir(root)).filter(name => /^opencode(?:-[A-Za-z0-9._-]+)?\.db$/u.test(name)).sort()
    } catch { /* missing data roots are normal */ }
    for (const name of names.slice(0, 16)) add(join(root, name))
  }
  return values
}

export async function resolveStandaloneOpenCodeRuntime(options: StandaloneOpenCodeResolverOptions = {}): Promise<StandaloneOpenCodeRuntime | null> {
  const platform = options.platform ?? process.platform
  const baseEnvironment = options.environment ?? process.env
  const excludedRoots = (options.excludedRoots ?? []).filter(value => isAbsolute(value, platform))
  const executableCandidates = [
    ...buildExecutableCandidates(options, platform),
    ...(await buildDesktopCliCandidates(options, platform)),
  ]
  const databaseCandidates = await buildDatabaseCandidates(options, platform)
  const fileExists = options.fileExists ?? defaultFileExists
  const probe = options.probe ?? defaultProbe

  for (const executablePath of executableCandidates) {
    if (isExcluded(executablePath, excludedRoots, platform) || !(await fileExists(executablePath))) continue

    const probeEnvironment = standaloneEnvironment(baseEnvironment, null, excludedRoots, platform)
    const versionResult = await probe(executablePath, ['--version'], probeEnvironment)
    if (versionResult.code !== undefined && versionResult.code !== 0) continue
    const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`)
    if (!version || !isStandaloneExportVersionCompatible(version)) continue

    const helpResult = await probe(executablePath, ['export', '--help'], probeEnvironment)
    if (helpResult.code !== undefined && helpResult.code !== 0) continue
    if (!/^\s*opencode\s+export(?:\s|\[)/mu.test(`${helpResult.stdout}\n${helpResult.stderr}`)) continue

    const databasePath = (await Promise.all(databaseCandidates.map(async candidate => ({
      candidate,
      exists: !isExcluded(candidate, excludedRoots, platform) && await fileExists(candidate),
    })))).find(item => item.exists)?.candidate ?? null
    return {
      executablePath,
      version,
      databasePath,
      environment: standaloneEnvironment(baseEnvironment, databasePath, excludedRoots, platform),
    }
  }
  return null
}
