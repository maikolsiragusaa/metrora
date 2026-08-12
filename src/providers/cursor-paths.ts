import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ProbeRoot } from './types.js'

export function getCursorDbPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  }
  if (process.platform === 'win32') {
    return join(homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  }
  return join(homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
}

export function getCursorWorkspaceStorageDir(globalDbPath: string): string {
  return join(globalDbPath, '..', '..', 'workspaceStorage')
}

export function getCursorDoctorProbeRoots(dbPathOverride?: string): ProbeRoot[] {
  const dbPath = dbPathOverride ?? getCursorDbPath()
  return [
    { path: dbPath, label: 'global-state' },
    { path: getCursorWorkspaceStorageDir(dbPath), label: 'workspace-storage' },
  ]
}
