import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join, posix, win32 } from 'path'
import { tmpdir } from 'os'

import { createClineParser, discoverClineTasks, getVSCodeGlobalStoragePaths } from '../../src/providers/vscode-cline-parser.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vscode-cline-parser-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

async function writeTask(baseDir: string, taskId: string): Promise<void> {
  const taskDir = join(baseDir, 'tasks', taskId)
  await mkdir(taskDir, { recursive: true })
  await writeFile(join(taskDir, 'ui_messages.json'), '[]')
}

describe('VS Code Cline-family storage discovery', () => {
  it('includes VSCodium globalStorage paths on all supported platforms', () => {
    const extensionId = 'example.extension'

    expect(getVSCodeGlobalStoragePaths(extensionId, '/Users/test', 'darwin')).toContain(
      posix.join('/Users/test', 'Library', 'Application Support', 'VSCodium', 'User', 'globalStorage', extensionId),
    )
    expect(getVSCodeGlobalStoragePaths(extensionId, 'C:\\Users\\test', 'win32')).toContain(
      win32.join('C:\\Users\\test', 'AppData', 'Roaming', 'VSCodium', 'User', 'globalStorage', extensionId),
    )
    expect(getVSCodeGlobalStoragePaths(extensionId, '/home/test', 'linux')).toContain(
      posix.join('/home/test', '.config', 'VSCodium', 'User', 'globalStorage', extensionId),
    )
  })

  it('discovers tasks across multiple VS Code-compatible storage roots', async () => {
    const codeRoot = join(tmpDir, 'Code', 'User', 'globalStorage', 'example.extension')
    const codiumRoot = join(tmpDir, 'VSCodium', 'User', 'globalStorage', 'example.extension')
    await writeTask(codeRoot, 'task-code')
    await writeTask(codiumRoot, 'task-codium')

    const sessions = await discoverClineTasks(
      'example.extension',
      'example-provider',
      'Example Provider',
      [codeRoot, codiumRoot],
    )

    expect(sessions).toHaveLength(2)
    expect(sessions.map(s => s.path).sort()).toEqual([
      join(codeRoot, 'tasks', 'task-code'),
      join(codiumRoot, 'tasks', 'task-codium'),
    ].sort())
  })

  it('retains provider prefixes and cache/cost-only API records', async () => {
    const taskDir = join(tmpDir, 'tasks', 'task-parse')
    await mkdir(taskDir, { recursive: true })
    await writeFile(join(taskDir, 'ui_messages.json'), JSON.stringify([
      { type: 'say', say: 'user_feedback', text: 'do the work' },
      { type: 'say', say: 'api_req_started', ts: 1776074400000, text: JSON.stringify({ tokensIn: 0, tokensOut: 0, cacheReads: 12, cacheWrites: 3, cost: 0 }) },
    ]))
    await writeFile(join(taskDir, 'api_conversation_history.json'), JSON.stringify([
      { role: 'user', content: [{ text: '<model>anthropic/claude-sonnet-4-5</model> Current Workspace Directory (/Users/test/project)' }] },
    ]))

    const calls: any[] = []
    const source = { path: taskDir, project: 'Cline', provider: 'cline' }
    for await (const call of createClineParser(source, new Set(), 'cline').parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe('claude-sonnet-4-5')
    expect(calls[0].modelProvider).toBe('anthropic')
    expect(calls[0].cacheReadInputTokens).toBe(12)
    expect(calls[0].cacheCreationInputTokens).toBe(3)
    expect(calls[0].costUSD).toBe(0)
  })
})
