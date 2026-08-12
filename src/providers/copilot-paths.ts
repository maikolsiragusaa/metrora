import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, posix, win32 } from 'node:path'

import type { ProbeRoot } from './types.js'

export function getCopilotSessionStateDir(override?: string): string {
  return override ?? process.env['METRORA_COPILOT_SESSION_STATE_DIR'] ?? join(homedir(), '.copilot', 'session-state')
}

export function getVSCodeWorkspaceStorageDirs(home: string, os: string): string[] {
  const j = os === 'win32' ? win32.join : posix.join
  if (os === 'darwin') {
    return [
      j(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'),
      j(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'workspaceStorage'),
      j(home, 'Library', 'Application Support', 'VSCodium', 'User', 'workspaceStorage'),
    ]
  }
  if (os === 'linux') {
    return [
      j(home, '.config', 'Code', 'User', 'workspaceStorage'),
      j(home, '.config', 'Code - Insiders', 'User', 'workspaceStorage'),
      j(home, '.config', 'VSCodium', 'User', 'workspaceStorage'),
    ]
  }
  return [
    j(home, 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage'),
    j(home, 'AppData', 'Roaming', 'Code - Insiders', 'User', 'workspaceStorage'),
    j(home, 'AppData', 'Roaming', 'VSCodium', 'User', 'workspaceStorage'),
  ]
}

export function getVSCodeGlobalStorageDirs(home: string, os: string): string[] {
  const j = os === 'win32' ? win32.join : posix.join
  if (os === 'darwin') {
    return [
      j(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage'),
      j(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'globalStorage'),
      j(home, 'Library', 'Application Support', 'VSCodium', 'User', 'globalStorage'),
    ]
  }
  if (os === 'linux') {
    return [
      j(home, '.config', 'Code', 'User', 'globalStorage'),
      j(home, '.config', 'Code - Insiders', 'User', 'globalStorage'),
      j(home, '.config', 'VSCodium', 'User', 'globalStorage'),
    ]
  }
  return [
    j(home, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage'),
    j(home, 'AppData', 'Roaming', 'Code - Insiders', 'User', 'globalStorage'),
    j(home, 'AppData', 'Roaming', 'VSCodium', 'User', 'globalStorage'),
  ]
}

export function getAgentTracesDbCandidates(): string[] {
  const override = process.env['METRORA_COPILOT_OTEL_DB']
  if (override) return [override]
  const os = platform()
  const globalStorageDirs = os === 'win32' && process.env['APPDATA']
    ? ['Code', 'Code - Insiders', 'VSCodium'].map(variant => join(process.env['APPDATA']!, variant, 'User', 'globalStorage'))
    : getVSCodeGlobalStorageDirs(homedir(), os)
  return globalStorageDirs
    .map(root => join(root, 'github.copilot-chat', 'agent-traces.db'))
}

export function getAgentTracesDbPath(): string | null {
  return getAgentTracesDbCandidates().find(existsSync) ?? null
}

export function getJetBrainsCopilotRoot(override?: string): string {
  const envOverride = override ?? process.env['METRORA_COPILOT_JETBRAINS_DIR']
  if (envOverride) return envOverride
  const xdg = process.env['XDG_CONFIG_HOME']
  if (xdg && (posix.isAbsolute(xdg) || win32.isAbsolute(xdg))) return join(xdg, 'github-copilot')
  if (platform() === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'github-copilot')
  }
  return join(homedir(), '.config', 'github-copilot')
}

export function getCopilotDoctorProbeRoots(
  sessionStateDir?: string,
  workspaceStorageDir?: string,
  globalStorageDir?: string,
  jetbrainsDir?: string,
): ProbeRoot[] {
  const roots: ProbeRoot[] = getAgentTracesDbCandidates().map(path => ({ path, label: 'otel-agent-traces' }))
  roots.push({ path: getCopilotSessionStateDir(sessionStateDir), label: 'cli-session-state' })
  const workspaceRoots = workspaceStorageDir !== undefined
    ? [workspaceStorageDir]
    : process.env['METRORA_COPILOT_WS_STORAGE_DIR']
      ? [process.env['METRORA_COPILOT_WS_STORAGE_DIR']!]
      : getVSCodeWorkspaceStorageDirs(homedir(), platform())
  roots.push(...workspaceRoots.map(path => ({ path, label: 'vscode-workspace-storage' })))
  const globalRoots = globalStorageDir !== undefined
    ? [globalStorageDir]
    : process.env['METRORA_COPILOT_GLOBAL_STORAGE_DIR']
      ? [process.env['METRORA_COPILOT_GLOBAL_STORAGE_DIR']!]
      : getVSCodeGlobalStorageDirs(homedir(), platform())
  roots.push(...globalRoots.map(path => ({ path: join(path, 'emptyWindowChatSessions'), label: 'empty-window-global-storage' })))
  roots.push({ path: getJetBrainsCopilotRoot(jetbrainsDir), label: 'jetbrains' })
  return roots
}
