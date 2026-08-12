import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ProbeRoot } from './types.js'

export function getKiroAgentDir(override?: string): string[] {
  if (override) return [override]
  if (process.platform === 'darwin') {
    return [join(homedir(), 'Library', 'Application Support', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent')]
  }
  if (process.platform === 'win32') {
    return [join(homedir(), 'AppData', 'Roaming', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent')]
  }
  const paths: string[] = []
  const kiroServer = join(homedir(), '.kiro-server', 'data', 'User', 'globalStorage', 'kiro.kiroagent')
  const kiroConfig = join(homedir(), '.config', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent')
  if (existsSync(kiroServer)) paths.push(kiroServer)
  if (existsSync(kiroConfig)) paths.push(kiroConfig)
  return paths.length > 0 ? paths : [kiroConfig]
}

export function getKiroWorkspaceStorageDir(override?: string): string {
  if (override) return override
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Kiro', 'User', 'workspaceStorage')
  }
  if (process.platform === 'win32') {
    return join(homedir(), 'AppData', 'Roaming', 'Kiro', 'User', 'workspaceStorage')
  }
  return join(homedir(), '.config', 'Kiro', 'User', 'workspaceStorage')
}

export function getKiroCliSessionsDir(agentDirOverride?: string, cliSessionsDirOverride?: string): string {
  return cliSessionsDirOverride ?? (
    agentDirOverride
      ? join(agentDirOverride, '..', 'cli-sessions')
      : join(process.env['KIRO_HOME'] || join(homedir(), '.kiro'), 'sessions', 'cli')
  )
}

export function getKiroV2SessionsRoot(
  agentDirOverride: string | undefined,
  cliSessionsDirOverride: string | undefined,
  v2SessionsRootOverride: string | undefined,
  cliSessionsDir: string,
): string | undefined {
  return v2SessionsRootOverride ?? (
    cliSessionsDirOverride
      ? dirname(cliSessionsDir)
      : agentDirOverride
        ? undefined
        : dirname(cliSessionsDir)
  )
}

export function getKiroDoctorProbeRoots(
  agentDirOverride?: string,
  workspaceStorageDirOverride?: string,
  cliSessionsDirOverride?: string,
  v2SessionsRootOverride?: string,
): ProbeRoot[] {
  const agentDirs = getKiroAgentDir(agentDirOverride)
  const workspaceStorageDir = getKiroWorkspaceStorageDir(workspaceStorageDirOverride)
  const cliSessionsDir = getKiroCliSessionsDir(agentDirOverride, cliSessionsDirOverride)
  const v2Root = getKiroV2SessionsRoot(agentDirOverride, cliSessionsDirOverride, v2SessionsRootOverride, cliSessionsDir)
  const roots: ProbeRoot[] = agentDirs.map(path => ({
    path,
    label: path.includes('.kiro-server') ? 'legacy-ide-server' : 'legacy-ide',
  }))
  roots.push(
    { path: workspaceStorageDir, label: 'workspace-storage' },
    { path: cliSessionsDir, label: 'cli' },
  )
  if (v2Root) roots.push({ path: v2Root, label: 'kiro-v2' })
  return roots
}
