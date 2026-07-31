import { stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, join } from 'path'

import { discoverClineTasks, createClineParser, getVSCodeGlobalStoragePath } from './vscode-cline-parser.js'
import type { Provider, SessionSource, SessionParser } from './types.js'

const EXTENSION_ID = 'saoudrizwan.claude-dev'

export function getClineDataPath(): string {
  return join(homedir(), '.cline', 'data')
}

function normalizeOverrideDirs(overrideDirs?: string | string[]): string[] | undefined {
  if (overrideDirs === undefined) return undefined
  // Cline has two default roots, so tests and future callers can override one or both.
  return Array.isArray(overrideDirs) ? overrideDirs : [overrideDirs]
}

async function dedupeTaskSources(sources: SessionSource[]): Promise<SessionSource[]> {
  const candidates = await Promise.all(sources.map(async source => ({
    source,
    mtimeMs: (await stat(join(source.path, 'ui_messages.json')).catch(() => null))?.mtimeMs ?? 0,
  })))

  const seenTaskIds = new Set<string>()
  const deduped: SessionSource[] = []

  for (const { source } of candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    const taskId = basename(source.path)
    if (seenTaskIds.has(taskId)) continue
    seenTaskIds.add(taskId)
    deduped.push(source)
  }

  return deduped
}

export function createClineProvider(overrideDirs?: string | string[]): Provider {
  const configuredDirs = normalizeOverrideDirs(overrideDirs)

  return {
    name: 'cline',
    displayName: 'Cline',

    modelDisplayName(model: string): string {
      return model
    },

    toolDisplayName(rawTool: string): string {
      return rawTool
    },

    async discoverSessions(): Promise<SessionSource[]> {
      const baseDirs = configuredDirs ?? [
        getVSCodeGlobalStoragePath(EXTENSION_ID),
        getClineDataPath(),
      ]

      const sources = await Promise.all(
        baseDirs.map(dir => discoverClineTasks(EXTENSION_ID, 'cline', 'Cline', dir)),
      )

      return dedupeTaskSources(sources.flat())
    },

    createSessionParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
      return createClineParser(source, seenKeys, 'cline')
    },
  }
}

export const cline = createClineProvider()
