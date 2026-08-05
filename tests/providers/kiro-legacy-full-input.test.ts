// Focused money-path coverage: display previews stay bounded while complete
// eligible human input drives token and estimated-cost accounting.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { kiro } from '../../src/providers/kiro.js'
import { estimateTokensFromChars } from '../../src/token-estimate.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

const tempDirs: string[] = []

async function parseLegacyChat(chat: Array<{ role: 'human' | 'bot' | 'tool'; content: string }>): Promise<ParsedProviderCall> {
  const dir = await mkdtemp(join(tmpdir(), 'metrora-kiro-legacy-input-'))
  tempDirs.push(dir)
  const sourcePath = join(dir, 'legacy.chat')

  await writeFile(sourcePath, JSON.stringify({
    executionId: 'legacy-execution',
    actionId: 'act',
    chat,
    metadata: {
      modelId: 'claude-haiku-4-5',
      modelProvider: 'qdev',
      workflow: 'act',
      workflowId: 'legacy-session',
      startTime: 1777333000000,
      endTime: 1777333010000,
    },
  }))

  const calls: ParsedProviderCall[] = []
  const source = { path: sourcePath, project: 'fixture-project', provider: 'kiro' }
  for await (const call of kiro.createSessionParser(source, new Set()).parse()) calls.push(call)

  expect(calls).toHaveLength(1)
  return calls[0]!
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('kiro legacy chat full-input accounting', () => {
  it('uses the complete long prompt for accounting while keeping a bounded preview', async () => {
    const prompt = 'x'.repeat(2401)
    const call = await parseLegacyChat([
      { role: 'human', content: '<identity>\nYou are Kiro.\n</identity>' },
      { role: 'human', content: prompt },
      { role: 'bot', content: 'Done.' },
    ])

    expect(call.inputTokens).toBe(estimateTokensFromChars(prompt.length))
    expect(call.userMessage).toBe(prompt.slice(0, 500))
    expect(call.userMessage).toHaveLength(500)
  })

  it('counts every eligible human turn but excludes identity, bot, and tool content', async () => {
    const identity = `<identity>${'i'.repeat(1800)}</identity>`
    const firstPrompt = 'a'.repeat(401)
    const latestPrompt = 'b'.repeat(601)
    const firstOutput = 'First response.'
    const finalOutput = 'Final response. <tool_use><name>readFile</name></tool_use>'

    const call = await parseLegacyChat([
      { role: 'human', content: identity },
      { role: 'bot', content: firstOutput },
      { role: 'tool', content: 't'.repeat(2200) },
      { role: 'human', content: firstPrompt },
      { role: 'bot', content: 'Intermediate response.' },
      { role: 'human', content: latestPrompt },
      { role: 'bot', content: finalOutput },
    ])

    expect(call.inputTokens).toBe(estimateTokensFromChars(firstPrompt.length + latestPrompt.length))
    expect(call.userMessage).toBe(latestPrompt.slice(0, 500))
    expect(call.outputTokens).toBe(estimateTokensFromChars(firstOutput.length + 'Intermediate response.'.length + finalOutput.length))
    expect(call.tools).toEqual(['Read'])
    expect(call.timestamp).toBe('2026-04-27T23:36:40.000Z')
    expect(call.deduplicationKey).toBe('kiro:legacy-session:legacy-execution')
  })
})