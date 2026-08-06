import { constants } from 'fs'
import { access } from 'fs/promises'
import { delimiter, join } from 'path'

export const PERSISTENT_CLI_REQUIRED_MESSAGE =
  'CodeBurn needs a persistent codeburn command. Install CodeBurn globally first: npm install -g codeburn'

export const PERSISTENT_METRORA_CLI_REQUIRED_MESSAGE =
  'Metrora needs a persistent metrora command. Install Metrora so metrora is available on PATH. The legacy codeburn alias is accepted for compatibility.'

const DEFAULT_CLI_LOOKUP_PATHS = process.platform === 'win32'
  ? []
  : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']

export function buildPersistentCodeburnLookupPath(existingPath = process.env.PATH ?? ''): string {
  const parts = existingPath.split(delimiter).filter(Boolean)
  for (const fallback of DEFAULT_CLI_LOOKUP_PATHS) {
    if (!parts.includes(fallback)) parts.push(fallback)
  }
  return parts.join(delimiter)
}

export function buildPersistentMetroraLookupPath(existingPath = process.env.PATH ?? ''): string {
  return buildPersistentCodeburnLookupPath(existingPath)
}

export function isTransientNpxPath(path: string): boolean {
  return path.includes('/_npx/') || path.includes('/.npm/_npx/') || path.includes('\\_npx\\')
}

function commandExecutableNames(command: string): string[] {
  if (process.platform !== 'win32') return [command]
  return [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command]
}

function codeburnExecutableNames(): string[] {
  return commandExecutableNames('codeburn')
}

function metroraExecutableNames(): string[] {
  return commandExecutableNames('metrora')
}

async function executableExists(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.F_OK | constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolvePersistentExecutableFromPath(
  lookupPath: string,
  executableNames: readonly string[],
): Promise<string | undefined> {
  const directories = lookupPath.split(delimiter).filter(Boolean)
  const seen = new Set<string>()
  for (const dir of directories) {
    for (const executable of executableNames) {
      const candidate = join(dir, executable)
      if (seen.has(candidate)) continue
      seen.add(candidate)
      if (isTransientNpxPath(candidate)) continue
      if (await executableExists(candidate)) return candidate
    }
  }
  return undefined
}

export async function resolvePersistentCodeburnPathFromPath(
  lookupPath: string,
  message: string = PERSISTENT_CLI_REQUIRED_MESSAGE,
): Promise<string> {
  const persistentPath = await resolvePersistentExecutableFromPath(lookupPath, codeburnExecutableNames())
  if (persistentPath) return persistentPath
  throw new Error(message)
}

export async function resolvePersistentMetroraPathFromPath(
  lookupPath: string,
  message: string = PERSISTENT_METRORA_CLI_REQUIRED_MESSAGE,
): Promise<string> {
  const canonicalPath = await resolvePersistentExecutableFromPath(lookupPath, metroraExecutableNames())
  if (canonicalPath) return canonicalPath
  return resolvePersistentCodeburnPathFromPath(lookupPath, message)
}

export function resolvePersistentCodeburnPathFromWhichOutput(
  output: string,
  message: string = PERSISTENT_CLI_REQUIRED_MESSAGE,
): string {
  const paths = output
    .split(/\r?\n/)
    .map(path => path.trim())
    .filter(Boolean)
  const persistentPath = paths.find(path => path.startsWith('/') && !isTransientNpxPath(path))
  if (persistentPath) return persistentPath
  throw new Error(message)
}
