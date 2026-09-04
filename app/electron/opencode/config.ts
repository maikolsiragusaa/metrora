import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { OPENCODE_CUSTOM_TOOL_ID, OPENCODE_VERSION } from './types'
import type { OpenCodeLocalProviderConfig } from './types'
import { OPENCODE_USAGE_TOOL_SOURCE } from './tool'

export const LOOPBACK_HOST = '127.0.0.1'

export type OpenCodeRuntimePaths = {
  runtimeDir: string
  configPath: string
  snapshotPath: string
  localProviderPath: string
}

export function runtimePaths(userDataPath: string): OpenCodeRuntimePaths {
  const runtimeDir = path.join(userDataPath, 'opencode-engine', OPENCODE_VERSION)
  return {
    runtimeDir,
    configPath: path.join(runtimeDir, 'opencode.json'),
    snapshotPath: path.join(runtimeDir, 'metrora-usage-snapshot.json'),
    localProviderPath: path.join(runtimeDir, 'local-provider.json'),
  }
}

export function localProviderConfig(state: OpenCodeLocalProviderConfig): Record<string, unknown> {
  return {
    'llama.cpp': {
      npm: '@ai-sdk/openai-compatible',
      name: 'llama-server (local)',
      options: { baseURL: `http://${LOOPBACK_HOST}:${state.port}/v1` },
      models: { [state.modelId]: { name: `${state.modelId} (local)` } },
    },
  }
}

export async function isDirectory(value: string): Promise<boolean> {
  try { return (await stat(value)).isDirectory() } catch { return false }
}

export async function freeLoopbackPort(): Promise<number> {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

export async function loadLocalProvider(filePath: string): Promise<OpenCodeLocalProviderConfig | null> {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const item = value as Record<string, unknown>
    const port = typeof item.port === 'number' ? item.port : NaN
    const modelId = typeof item.modelId === 'string' ? item.modelId : ''
    return Number.isInteger(port) && port >= 1 && port <= 65_535 && /^[A-Za-z0-9._:-]{1,256}$/u.test(modelId) ? { port, modelId } : null
  } catch { return null }
}

export async function persistLocalProvider(filePath: string, value: OpenCodeLocalProviderConfig): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
}

export async function writeRuntimeFiles(paths: OpenCodeRuntimePaths, localProvider: OpenCodeLocalProviderConfig | null): Promise<void> {
  const toolsDir = path.join(paths.runtimeDir, 'tools')
  const nodeModulesDir = path.join(paths.runtimeDir, 'node_modules')
  await mkdir(toolsDir, { recursive: true })
  // OpenCode discovers config-directory tools after its npm reify step. Seed
  // the private manifest/lock and empty node_modules so this dependency-free
  // tool remains offline and deterministic.
  const runtimePackage = { name: 'metrora-opencode-runtime', version: '1.0.0', private: true, dependencies: { '@opencode-ai/plugin': OPENCODE_VERSION } }
  const runtimeLock = { name: runtimePackage.name, version: runtimePackage.version, lockfileVersion: 3, requires: true, packages: { '': { dependencies: runtimePackage.dependencies } } }
  await mkdir(nodeModulesDir, { recursive: true })
  await writeFile(path.join(paths.runtimeDir, 'package.json'), JSON.stringify(runtimePackage, null, 2), 'utf8')
  await writeFile(path.join(paths.runtimeDir, 'package-lock.json'), JSON.stringify(runtimeLock, null, 2), 'utf8')
  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    share: 'disabled',
    autoupdate: false,
    logLevel: 'ERROR',
    ...(localProvider ? { provider: localProviderConfig(localProvider) } : {}),
  }
  await writeFile(paths.configPath, JSON.stringify(config, null, 2), 'utf8')
  await writeFile(path.join(toolsDir, `${OPENCODE_CUSTOM_TOOL_ID}.js`), OPENCODE_USAGE_TOOL_SOURCE, 'utf8')
}

export async function writeUsageSnapshot(paths: OpenCodeRuntimePaths, value: Record<string, unknown>): Promise<void> {
  await mkdir(paths.runtimeDir, { recursive: true })
  await writeFile(paths.snapshotPath, JSON.stringify(value), 'utf8')
}
