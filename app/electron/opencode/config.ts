import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { OPENCODE_CUSTOM_TOOL_ID, OPENCODE_VERSION } from './types'
import { OPENCODE_USAGE_TOOL_SOURCE } from './tool'
import type { MetroraUsageSnapshot } from './snapshot'

export const LOOPBACK_HOST = '127.0.0.1' as const
export const OPENCODE_WEB_SURFACE_STATE_FILENAME = 'web-surface.json' as const
export const OPENCODE_WEB_SURFACE_STATE_MAX_BYTES = 16 * 1024

export type OpenCodeWebSurfaceState = {
  preferredPort: number
}

export type OpenCodeRuntimePaths = {
  runtimeDir: string
  configPath: string
  toolsDir: string
  snapshotPath: string
  webSurfacePath: string
}

export function runtimePaths(userDataPath: string): OpenCodeRuntimePaths {
  const runtimeDir = path.join(userDataPath, 'opencode', OPENCODE_VERSION)
  return {
    runtimeDir,
    configPath: path.join(runtimeDir, 'opencode.json'),
    toolsDir: path.join(runtimeDir, 'tools'),
    snapshotPath: path.join(runtimeDir, 'metrora-usage-snapshot.json'),
    webSurfacePath: path.join(userDataPath, 'opencode', OPENCODE_WEB_SURFACE_STATE_FILENAME),
  }
}

export function parsePreferredOpenCodePort(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const preferredPort = (value as { preferredPort?: unknown }).preferredPort
  return typeof preferredPort === 'number' && Number.isInteger(preferredPort) && preferredPort >= 1 && preferredPort <= 65_535
    ? preferredPort
    : null
}

/** Read only the tiny Metrora-owned origin hint; never stores auth or project data. */
export async function readPreferredOpenCodePort(filePath: string): Promise<number | null> {
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size > OPENCODE_WEB_SURFACE_STATE_MAX_BYTES) return null
    const raw = await readFile(filePath, 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > OPENCODE_WEB_SURFACE_STATE_MAX_BYTES) return null
    return parsePreferredOpenCodePort(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export async function writePreferredOpenCodePort(filePath: string, preferredPort: number): Promise<void> {
  if (parsePreferredOpenCodePort({ preferredPort }) === null) throw new Error('OpenCode preferred port is invalid.')
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  await writeFile(filePath, JSON.stringify({ preferredPort }), { encoding: 'utf8', mode: 0o600 })
  await restrictPermissions(filePath, 0o600)
}

async function loadRuntimeConfig(filePath: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function restrictPermissions(filePath: string, mode: number): Promise<void> {
  try { await chmod(filePath, mode) } catch { /* Windows ACLs are managed by the OS. */ }
}

/** Write only the private config/tool files needed by the official runtime. */
export async function writeRuntimeFiles(paths: OpenCodeRuntimePaths): Promise<void> {
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 })
  await mkdir(paths.toolsDir, { recursive: true, mode: 0o700 })
  // v1.18.27 eagerly checks for a node_modules directory before loading a
  // custom tool. Keeping this directory empty and declaring the bundled
  // plugin version in the private lockfile makes that check deterministic and
  // prevents the official runtime from attempting a network install.
  const nodeModulesDir = path.join(paths.runtimeDir, 'node_modules')
  await mkdir(nodeModulesDir, { recursive: true, mode: 0o700 })
  await restrictPermissions(paths.runtimeDir, 0o700)
  await restrictPermissions(paths.toolsDir, 0o700)
  await restrictPermissions(nodeModulesDir, 0o700)

  // Keep a private package manifest because OpenCode's extension loader checks
  // the config directory as a package boundary. No network dependency is
  // required by the one dependency-free Metrora tool.
  const runtimePackage = {
    name: 'metrora-opencode-runtime',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: {
      '@opencode-ai/plugin': OPENCODE_VERSION,
    },
  }
  await writeFile(path.join(paths.runtimeDir, 'package.json'), JSON.stringify(runtimePackage, null, 2), { encoding: 'utf8', mode: 0o600 })
  await writeFile(path.join(paths.runtimeDir, 'package-lock.json'), JSON.stringify({
    name: runtimePackage.name,
    version: runtimePackage.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        dependencies: {
          '@opencode-ai/plugin': OPENCODE_VERSION,
        },
      },
    },
  }, null, 2), { encoding: 'utf8', mode: 0o600 })

  const existing = await loadRuntimeConfig(paths.configPath)
  const config: Record<string, unknown> = {
    ...existing,
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    share: 'disabled',
    logLevel: 'ERROR',
  }
  await writeFile(paths.configPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
  await restrictPermissions(paths.configPath, 0o600)

  await writeFile(path.join(paths.toolsDir, `${OPENCODE_CUSTOM_TOOL_ID}.js`), OPENCODE_USAGE_TOOL_SOURCE, { encoding: 'utf8', mode: 0o600 })
  await restrictPermissions(path.join(paths.toolsDir, `${OPENCODE_CUSTOM_TOOL_ID}.js`), 0o600)
}

export async function writeUsageSnapshot(paths: OpenCodeRuntimePaths, value: MetroraUsageSnapshot): Promise<void> {
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 })
  const content = JSON.stringify(value)
  // The file is intentionally replaced as one bounded write. It contains no
  // credentials, prompts, source code, or arbitrary CLI payload fields.
  await writeFile(paths.snapshotPath, content, { encoding: 'utf8', mode: 0o600 })
  await restrictPermissions(paths.snapshotPath, 0o600)
}
