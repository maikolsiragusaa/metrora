// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  OPENCODE_DESKTOP_GLOBAL_STORE_MAX_BYTES,
  mergeOpenCodeWebProjects,
  parseOpenCodeDesktopGlobalStore,
  readOpenCodeDesktopProjects,
  resolveOpenCodeDesktopGlobalStorePath,
} from './project-import'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'metrora-opencode-project-import-'))
  temporaryDirectories.push(directory)
  return directory
}

function desktopState(projects: unknown[], lastProject?: unknown): string {
  return JSON.stringify({
    'prompt-history': [{ prompt: 'must not be imported' }],
    server: JSON.stringify({
      list: [],
      projects: { local: projects },
      lastProject: lastProject === undefined ? {} : { local: lastProject },
      recentlyClosed: {},
    }),
  })
}

describe('OpenCode Desktop project compatibility import', () => {
  it('extracts only valid server.projects.local metadata in Desktop order', () => {
    const parsed = parseOpenCodeDesktopGlobalStore(desktopState([
      { worktree: 'C:/Repo/One', expanded: false, secret: 'drop' },
      { worktree: 'c:\\repo\\one', expanded: true },
      { worktree: 'D:\\Repo\\Two', expanded: true },
      { worktree: 'relative-project', expanded: true },
      { worktree: 'E:\\Repo\\Bad', expanded: 'yes' },
      'not-an-entry',
    ], 'D:\\Repo\\Two'), 'win32')

    expect(parsed).toEqual({
      projects: [
        { worktree: 'C:/Repo/One', expanded: false },
        { worktree: 'D:\\Repo\\Two', expanded: true },
      ],
      lastProject: 'D:\\Repo\\Two',
    })
    expect(JSON.stringify(parsed)).not.toContain('secret')
    expect(JSON.stringify(parsed)).not.toContain('prompt')
  })

  it('fails closed for malformed, missing, wrong-shape, and oversized Desktop stores', async () => {
    const root = tempDirectory()
    const missing = await readOpenCodeDesktopProjects(join(root, 'missing.dat'), 'win32')
    expect(missing).toEqual({ projects: [] })

    const malformedPath = join(root, 'malformed.dat')
    writeFileSync(malformedPath, '{not-json')
    expect(await readOpenCodeDesktopProjects(malformedPath, 'win32')).toEqual({ projects: [] })

    const wrongShapePath = join(root, 'wrong-shape.dat')
    writeFileSync(wrongShapePath, JSON.stringify({ server: { projects: { local: [] } } }))
    expect(await readOpenCodeDesktopProjects(wrongShapePath, 'win32')).toEqual({ projects: [] })

    const oversizedPath = join(root, 'oversized.dat')
    writeFileSync(oversizedPath, Buffer.alloc(OPENCODE_DESKTOP_GLOBAL_STORE_MAX_BYTES + 1, 120))
    expect(await readOpenCodeDesktopProjects(oversizedPath, 'win32')).toEqual({ projects: [] })
  })

  it('reads the production Desktop path without mutating the source file', async () => {
    const root = tempDirectory()
    const filePath = resolveOpenCodeDesktopGlobalStorePath(root)
    const before = desktopState([{ worktree: 'C:\\Repo\\One', expanded: true }])
    mkdirSync(join(root, 'ai.opencode.desktop'), { recursive: true })
    writeFileSync(filePath, before)

    const result = await readOpenCodeDesktopProjects(filePath, 'win32')

    expect(result.projects).toEqual([{ worktree: 'C:\\Repo\\One', expanded: true }])
    expect(readFileSync(filePath, 'utf8')).toBe(before)
  })
})

describe('OpenCode Web project registry merge', () => {
  it('merges Desktop projects before Web-only projects and preserves Web preference/state', () => {
    const current = JSON.stringify({
      list: [{ url: 'http://remote.example', username: 'keep-main-process-only' }],
      projects: {
        local: [
          { worktree: 'c:\\repo\\one', expanded: true },
          { worktree: 'F:\\Repo\\WebOnly', expanded: false },
        ],
      },
      lastProject: { local: 'F:\\Repo\\WebOnly' },
      recentlyClosed: { local: ['G:\\Repo\\Closed'] },
      unrelated: { keep: true },
    })
    const merged = mergeOpenCodeWebProjects(current, {
      projects: [
        { worktree: 'C:/Repo/One', expanded: false },
        { worktree: 'D:\\Repo\\DesktopOnly', expanded: true },
      ],
      lastProject: 'D:\\Repo\\DesktopOnly',
    }, 'win32')

    expect(merged.changed).toBe(true)
    expect(merged.importedProjects).toBe(2)
    const state = JSON.parse(merged.serialized ?? '') as Record<string, any>
    expect(state.projects.local).toEqual([
      { worktree: 'C:/Repo/One', expanded: false },
      { worktree: 'D:\\Repo\\DesktopOnly', expanded: true },
      { worktree: 'F:\\Repo\\WebOnly', expanded: false },
    ])
    expect(state.lastProject.local).toBe('F:\\Repo\\WebOnly')
    expect(state.recentlyClosed).toEqual({ local: ['G:\\Repo\\Closed'] })
    expect(state.unrelated).toEqual({ keep: true })
    expect(state.list).toEqual([{ url: 'http://remote.example', username: 'keep-main-process-only' }])
  })

  it('does not seed malformed or oversized Web state', () => {
    const desktop = { projects: [{ worktree: 'C:\\Repo\\One', expanded: true }] }
    expect(mergeOpenCodeWebProjects('{not-json', desktop, 'win32')).toEqual({ changed: false, serialized: '{not-json', importedProjects: 0 })
    const oversized = 'x'.repeat(2 * 1024 * 1024 + 1)
    expect(mergeOpenCodeWebProjects(oversized, desktop, 'win32')).toEqual({ changed: false, serialized: oversized, importedProjects: 0 })
  })
})
