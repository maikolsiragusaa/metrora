import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'

export const METRORA_ENV = {
  bin: 'METRORA_BIN',
  pathDirs: 'METRORA_PATH_DIRS',
  cliPathFile: 'METRORA_CLI_PATH_FILE',
  bundledCli: 'METRORA_BUNDLED_CLI',
  devRepoRoot: 'METRORA_DEV_REPO_ROOT',
} as const

export const LEGACY_QOVRION_ENV = {
  bin: 'QOVRION_BIN',
  pathDirs: 'QOVRION_PATH_DIRS',
  cliPathFile: 'QOVRION_CLI_PATH_FILE',
  bundledCli: 'QOVRION_BUNDLED_CLI',
  devRepoRoot: 'QOVRION_DEV_REPO_ROOT',
} as const

export const LEGACY_CODEBURN_ENV = {
  bin: 'CODEBURN_BIN',
  pathDirs: 'CODEBURN_PATH_DIRS',
  cliPathFile: 'CODEBURN_CLI_PATH_FILE',
  bundledCli: 'CODEBURN_BUNDLED_CLI',
  devRepoRoot: 'CODEBURN_DEV_REPO_ROOT',
} as const

/** The first defined value wins, including a deliberately empty string. */
export function compatEnv(
  env: NodeJS.ProcessEnv,
  canonical: string,
  ...legacy: string[]
): string | undefined {
  for (const key of [canonical, ...legacy]) {
    if (env[key] !== undefined) return env[key]
  }
  return undefined
}

/** npm shims are .cmd on Windows; keep extensionless forms as fallbacks. */
export function cliExecutableNames(platformName: NodeJS.Platform = platform()): string[] {
  const bases = ['metrora', 'qovrion', 'codeburn']
  if (platformName !== 'win32') return bases
  return bases.flatMap(name => [`${name}.cmd`, `${name}.exe`, name])
}

export type CliPathFiles = {
  canonical: string
  legacy: readonly string[]
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

  // An explicit canonical override is authoritative and intentionally disables
  // automatic fallback to old pointer files.
  if (canonicalOverride !== undefined) return { canonical, legacy: [] }

  const qovrionOverride = env[LEGACY_QOVRION_ENV.cliPathFile]
  const codeburnOverride = env[LEGACY_CODEBURN_ENV.cliPathFile]
  return {
    canonical,
    legacy: [
      qovrionOverride !== undefined
        ? qovrionOverride
        : configPointer(home, platformName, 'Qovrion', 'qovrion-cli-path.v1', env),
      codeburnOverride !== undefined
        ? codeburnOverride
        : configPointer(home, platformName, 'CodeBurn', 'codeburn-cli-path.v1', env),
    ],
  }
}

export type PersistedCliPathResult = {
  value: string
  source: 'canonical' | 'qovrion' | 'codeburn'
  migrated: boolean
}

function readCandidate(file: string | null, isUsable: (value: string) => boolean): string | null {
  if (!file || !existsSync(file)) return null
  try {
    const value = readFileSync(file, 'utf8').trim()
    return value && isUsable(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Read Metrora first, then Qovrion, then CodeBurn. A valid old value is copied
 * to the Metrora pointer only when the canonical file does not exist. Old files
 * are never modified or removed.
 */
export function readPersistedCliPath(options: {
  env?: NodeJS.ProcessEnv
  home?: string
  platformName?: NodeJS.Platform
  isUsable: (value: string) => boolean
}): PersistedCliPathResult | null {
  const env = options.env ?? process.env
  const files = cliPathFiles(env, options.home ?? homedir(), options.platformName ?? platform())
  const canonicalValue = readCandidate(files.canonical, options.isUsable)
  if (canonicalValue) return { value: canonicalValue, source: 'canonical', migrated: false }

  for (const [index, file] of files.legacy.entries()) {
    const value = readCandidate(file, options.isUsable)
    if (!value) continue

    let migrated = false
    if (files.canonical && !existsSync(files.canonical)) {
      try {
        mkdirSync(dirname(files.canonical), { recursive: true })
        writeFileSync(files.canonical, `${value}\n`, { flag: 'wx', mode: 0o600 })
        migrated = true
      } catch {
        // Resolution may still use the valid old pointer. No old file is changed.
      }
    }
    return { value, source: index === 0 ? 'qovrion' : 'codeburn', migrated }
  }
  return null
}
