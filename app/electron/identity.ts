import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'

export const QOVRION_ENV = {
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

/** Canonical values win even when deliberately set to an empty string. */
export function compatEnv(
  env: NodeJS.ProcessEnv,
  canonical: string,
  legacy: string,
): string | undefined {
  return env[canonical] !== undefined ? env[canonical] : env[legacy]
}

/** npm shims are .cmd on Windows; keep extensionless forms as fallbacks. */
export function cliExecutableNames(platformName: NodeJS.Platform = platform()): string[] {
  const bases = ['qovrion', 'codeburn']
  if (platformName !== 'win32') return bases
  return bases.flatMap(name => [`${name}.cmd`, `${name}.exe`, name])
}

export type CliPathFiles = {
  canonical: string
  legacy: string | null
}

export function cliPathFiles(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platformName: NodeJS.Platform = platform(),
): CliPathFiles {
  const canonicalOverride = env[QOVRION_ENV.cliPathFile]
  const canonical = canonicalOverride !== undefined
    ? canonicalOverride
    : platformName === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Qovrion', 'qovrion-cli-path.v1')
      : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Qovrion', 'qovrion-cli-path.v1')

  // An explicit canonical override is authoritative and intentionally disables
  // automatic fallback to a legacy pointer file.
  if (canonicalOverride !== undefined) return { canonical, legacy: null }

  const legacyOverride = env[LEGACY_CODEBURN_ENV.cliPathFile]
  const legacy = legacyOverride !== undefined
    ? legacyOverride
    : platformName === 'darwin'
      ? join(home, 'Library', 'Application Support', 'CodeBurn', 'codeburn-cli-path.v1')
      : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'CodeBurn', 'codeburn-cli-path.v1')
  return { canonical, legacy }
}

export type PersistedCliPathResult = {
  value: string
  source: 'canonical' | 'legacy'
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
 * Read the canonical pointer first, then the legacy pointer. A valid legacy
 * value is copied to the canonical file only when that file does not exist.
 * The legacy file is never modified or removed.
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

  const legacyValue = readCandidate(files.legacy, options.isUsable)
  if (!legacyValue) return null

  let migrated = false
  if (files.canonical && !existsSync(files.canonical)) {
    try {
      mkdirSync(dirname(files.canonical), { recursive: true })
      writeFileSync(files.canonical, `${legacyValue}\n`, { flag: 'wx', mode: 0o600 })
      migrated = true
    } catch {
      // Best effort only. Resolution still uses the valid legacy value.
    }
  }
  return { value: legacyValue, source: 'legacy', migrated }
}
