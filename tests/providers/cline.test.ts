import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { cline, createClineProvider } from '../../src/providers/cline.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

let tmpDir: string

async function writeTask(baseDir: string, taskId: string, opts?: {
  tokensIn?: number
  tokensOut?: number
  model?: string
  userMessage?: string
  cost?: number
}): Promise<string> {
  const taskDir = join(baseDir, 'tasks', taskId)
  await mkdir(taskDir, { recursive: true })

  const messages: unknown[] = []
  if (opts?.userMessage) {
    messages.push({ type: 'say', say: 'user_feedback', text: opts.userMessage, ts: 1700000000000 })
  }
  const usage: Record<string, unknown> = {
    tokensIn: opts?.tokensIn ?? 100,
    tokensOut: opts?.tokensOut ?? 50,
  }
  if (opts?.cost !== undefined) usage.cost = opts.cost
  messages.push({ type: 'say', say: 'api_req_started', text: JSON.stringify(usage), ts: 1700000001000 })

  const modelTag = opts?.model ? `<model>${opts.model}</model>` : ''
  const history = [
    { role: 'user', content: [{ type: 'text', text: `hello\n<environment_details>\n${modelTag}\n</environment_details>` }] },
  ]

  await writeFile(join(taskDir, 'ui_messages.json'), JSON.stringify(messages))
  await writeFile(join(taskDir, 'api_conversation_history.json'), JSON.stringify(history))

  return taskDir
}

describe('cline provider - discovery', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cline-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('discovers Cline tasks from VS Code globalStorage and home data roots', async () => {
    const vscodeDir = join(tmpDir, 'globalStorage')
    const homeDataDir = join(tmpDir, 'cline-data')
    await writeTask(vscodeDir, 'task-vscode')
    await writeTask(homeDataDir, 'task-home')

    const provider = createClineProvider([vscodeDir, homeDataDir])
    const sessions = await provider.discoverSessions()

    expect(sessions).toHaveLength(2)
    expect(sessions.map(s => s.provider)).toEqual(['cline', 'cline'])
    expect(sessions.map(s => s.project)).toEqual(['Cline', 'Cline'])
    expect(sessions.map(s => s.path).sort()).toEqual([
      join(homeDataDir, 'tasks', 'task-home'),
      join(vscodeDir, 'tasks', 'task-vscode'),
    ].sort())
  })

  it('deduplicates the same task id across roots by keeping the newest task directory', async () => {
    const vscodeDir = join(tmpDir, 'globalStorage')
    const homeDataDir = join(tmpDir, 'cline-data')
    const oldTask = await writeTask(vscodeDir, 'task-same')
    const newTask = await writeTask(homeDataDir, 'task-same')
    await utimes(join(oldTask, 'ui_messages.json'), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    await utimes(join(newTask, 'ui_messages.json'), new Date('2026-02-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'))

    const provider = createClineProvider([vscodeDir, homeDataDir])
    const sessions = await provider.discoverSessions()

    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.path).toBe(newTask)
  })

  it('skips task directories without ui_messages.json', async () => {
    const vscodeDir = join(tmpDir, 'globalStorage')
    await mkdir(join(vscodeDir, 'tasks', 'task-no-ui'), { recursive: true })

    const provider = createClineProvider(vscodeDir)
    const sessions = await provider.discoverSessions()

    expect(sessions).toHaveLength(0)
  })
})

describe('cline provider - parsing', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cline-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('parses Cline usage with cline provider identity', async () => {
    const taskDir = await writeTask(tmpDir, 'task-parse', {
      tokensIn: 200,
      tokensOut: 100,
      model: 'anthropic/claude-sonnet-4-5',
      userMessage: 'build the feature',
      cost: 0.07,
    })

    const source = { path: taskDir, project: 'Cline', provider: 'cline' }
    const calls: ParsedProviderCall[] = []
    for await (const call of cline.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.provider).toBe('cline')
    expect(calls[0]!.model).toBe('claude-sonnet-4-5')
    expect(calls[0]!.inputTokens).toBe(200)
    expect(calls[0]!.outputTokens).toBe(100)
    expect(calls[0]!.costUSD).toBe(0.07)
    expect(calls[0]!.userMessage).toBe('build the feature')
    expect(calls[0]!.deduplicationKey).toMatch(/^cline:task-parse:/)
  })
})

describe('cline provider - metadata', () => {
  it('has correct name and displayName', () => {
    expect(cline.name).toBe('cline')
    expect(cline.displayName).toBe('Cline')
  })

  it('passes through model and tool display names', () => {
    expect(cline.modelDisplayName('claude-sonnet-4-5')).toBe('claude-sonnet-4-5')
    expect(cline.toolDisplayName('read_file')).toBe('read_file')
  })
})
