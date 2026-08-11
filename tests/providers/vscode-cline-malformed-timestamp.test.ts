import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import { createClineParser } from '../../src/providers/vscode-cline-parser.js'

describe('VS Code Cline malformed timestamp isolation', () => {
  it('keeps valid usage when an api_req_started timestamp is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'metrora-cline-bad-ts-'))
    const taskDir = join(root, 'task-a')
    await mkdir(taskDir, { recursive: true })
    await writeFile(join(taskDir, 'ui_messages.json'), JSON.stringify([
      {
        type: 'say',
        say: 'api_req_started',
        ts: Number.MAX_VALUE,
        text: JSON.stringify({ tokensIn: 12, tokensOut: 3, cacheReads: 2, cacheWrites: 1 }),
      },
    ]))

    const parser = createClineParser(
      { path: taskDir, project: 'Cline', provider: 'cline' },
      new Set(),
      'cline',
      'gpt-5.3',
    )
    const calls = []
    for await (const call of parser.parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      inputTokens: 12,
      outputTokens: 3,
      cacheReadInputTokens: 2,
      cacheCreationInputTokens: 1,
      timestamp: '',
    })
  })
})
