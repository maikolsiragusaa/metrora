import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

export const METRORA_ENV = {
  bin: 'METRORA_BIN',
  pathDirs: 'METRORA_PATH_DIRS',
  cliPathFile: 'METRORA_CLI_PATH_FILE',
  bundledCli: 'METRORA_BUNDLED_CLI',
  devRepoRoot: 'METRORA_DEV_REPO_ROOT',
} as const

/** npm shims are .cmd on Windows; keep extensionless forms as fallbacks. */
export function cliExecutableNames(platformName: NodeJS.Platform = platform()): string[] {
  if (platformName !== 'win32') return ['metrora']
  return ['metrora.cmd', 'metrora.exe', 'metrora']
}

/** Keep all historical IPC prefixes inside the explicit identity/compatibility boundary. */
export function ipcChannelAliases(channel: string): string[] { return [channel] }

export type CliPathFiles = {
  canonical: string
}

function configPointer(home: string, platformName: NodeJS.Platform, product: string, file: string, env: NodeJS.ProcessEnv): string {
  return platformName === 'darwin'
    ? join(home, 'Library', 'Application Support', product, file)
    : join(env.XDG_CONFIG_HOME || join(home, '.config'), product, file)
}

export function cliPathFiles(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platformName: NodeJS.Platform = platform(),
): CliPathFiles {
  const canonicalOverride = env[METRORA_ENV.cliPathFile]
  const canonical = canonicalOverride !== undefined
    ? canonicalOverride
    : configPointer(home, platformName, 'Metrora', 'metrora-cli-path.v1', env)
  return { canonical }
}

function readCandidate(file: string, isUsable: (value: string) => boolean): string | null {
  if (!existsSync(file)) return null
  try {
    const value = readFileSync(file, 'utf8').trim()
    return value && isUsable(value) ? value : null
  } catch {
    return null
  }
}

/** Read the canonical Metrora CLI pointer without adopting historical files. */
export function readPersistedCliPath(options: {
  env?: NodeJS.ProcessEnv
  home?: string
  platformName?: NodeJS.Platform
  isUsable: (value: string) => boolean
}): string | null {
  const env = options.env ?? process.env
  const file = cliPathFiles(env, options.home ?? homedir(), options.platformName ?? platform()).canonical
  return readCandidate(file, options.isUsable)
}
