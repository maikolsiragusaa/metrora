import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { LARGE_STREAM_LINE_BYTES, readSessionLines } from '../fs-utils.js'
import { withCodexModelProvider } from './codex-model-provider.js'
import { createCodexProvider } from './codex.js'
import type { ParsedProviderCall, SessionSource } from './types.js'

let root: string
let previousCacheDir: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'metrora-codex-model-attribution-'))
  previousCacheDir = process.env['METRORA_CACHE_DIR']
  process.env['METRORA_CACHE_DIR'] = join(root, 'metrora-cache')
})

afterEach(async () => {
  if (previousCacheDir === undefined) delete process.env['METRORA_CACHE_DIR']
  else process.env['METRORA_CACHE_DIR'] = previousCacheDir
  await rm(root, { recursive: true, force: true })
})

function sessionMeta(options: {
  sessionId?: string
  directModel?: string
  nestedModel?: string
  modelProvider?: string
  large?: boolean
  nestedFirst?: boolean
} = {}): string {
  const nested: Record<string, unknown> = {
    provenance: {
      type: 'model',
      ...(options.nestedModel ? { model: options.nestedModel } : {}),
    },
    ...(options.large ? { instruction_body: 'x'.repeat(40_000) } : {}),
  }
  const payload: Record<string, unknown> = {
    session_id: options.sessionId ?? 'session-model-attribution',
    cwd: '/tmp/codex-model-attribution',
    originator: 'codex_cli_rs',
  }
  if (options.nestedFirst) payload.base_instructions = nested
  if (options.directModel) payload.model = options.directModel
  if (options.modelProvider) payload.model_provider = options.modelProvider
  if (!options.nestedFirst) payload.base_instructions = nested

  return JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-08-01T10:00:00.000Z',
    payload,
  })
}

function turnContext(model: string, reasoningEffort?: string): string {
  return JSON.stringify({
    type: 'turn_context',
    timestamp: '2026-08-01T10:00:01.000Z',
    payload: {
      model,
      ...(reasoningEffort ? { collaboration_mode: { settings: { reasoning_effort: reasoningEffort } } } : {}),
    },
  })
}

function tokenCount(timestamp: string, totalTokens: number, input = 100, output = 20, reasoning = 0): string {
  const usage = {
    input_tokens: input,
    cached_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + output + reasoning,
  }
  return JSON.stringify({
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: usage,
        total_token_usage: {
          ...usage,
          total_tokens: totalTokens,
        },
      },
    },
  })
}

async function writeRollout(name: string, lines: string[]): Promise<string> {
  const path = join(root, `${name}.jsonl`)
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
  return path
}

async function parseRollout(path: string, provider = createCodexProvider(root)): Promise<ParsedProviderCall[]> {
  const source: SessionSource = { path, project: 'test', provider: 'codex' }
  const calls: ParsedProviderCall[] = []
  for await (const call of provider.createSessionParser(source, new Set()).parse()) calls.push(call)
  return calls
}

async function assertUsesBufferFastPath(path: string): Promise<void> {
  const lines: Array<string | Buffer> = []
  for await (const line of readSessionLines(path, undefined, { largeLineAsBuffer: true })) lines.push(line)
  expect(lines[0]).toBeInstanceOf(Buffer)
  expect((lines[0] as Buffer).byteLength).toBeGreaterThan(LARGE_STREAM_LINE_BYTES)
}

describe('Codex session_meta model attribution', () => {
  it('keeps direct payload.model parity across string and Buffer paths and key order', async () => {
    const smallPath = await writeRollout('small-string', [
      sessionMeta({ directModel: 'DIRECT_MODEL', nestedModel: 'NESTED_MODEL' }),
      tokenCount('2026-08-01T10:00:02.000Z', 120),
    ])
    const nestedFirstPath = await writeRollout('large-nested-first', [
      sessionMeta({ directModel: 'DIRECT_MODEL', nestedModel: 'NESTED_MODEL', large: true, nestedFirst: true }),
      tokenCount('2026-08-01T10:00:02.000Z', 120),
    ])
    const directFirstPath = await writeRollout('large-direct-first', [
      sessionMeta({ directModel: 'DIRECT_MODEL', nestedModel: 'NESTED_MODEL', large: true }),
      tokenCount('2026-08-01T10:00:02.000Z', 120),
    ])

    await assertUsesBufferFastPath(nestedFirstPath)
    await assertUsesBufferFastPath(directFirstPath)

    await expect(readFile(smallPath, 'utf8')).resolves.toContain('DIRECT_MODEL')
    const models = await Promise.all([
      parseRollout(smallPath),
      parseRollout(nestedFirstPath),
      parseRollout(directFirstPath),
    ])
    expect(models.map(calls => calls.map(call => call.model))).toEqual([
      ['DIRECT_MODEL'],
      ['DIRECT_MODEL'],
      ['DIRECT_MODEL'],
    ])
  })

  it('ignores nested provenance.model before the first turn_context without changing fallback policy', async () => {
    const path = await writeRollout('pre-turn-nested-only', [
      sessionMeta({ nestedModel: 'NESTED_MODEL', large: true, nestedFirst: true }),
      tokenCount('2026-08-01T10:00:02.000Z', 120),
    ])
    await assertUsesBufferFastPath(path)

    const calls = await parseRollout(path)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.model).toBe('gpt-5')
    expect(calls[0]!.model).not.toBe('NESTED_MODEL')
  })

  it('preserves the active turn model across nested-only mid-file session_meta records', async () => {
    const path = await writeRollout('mid-file-nested-only', [
      sessionMeta({ nestedModel: 'NESTED_BEFORE', large: true, nestedFirst: true }),
      turnContext('RIGHT_MODEL'),
      tokenCount('2026-08-01T10:00:02.000Z', 120),
      sessionMeta({ nestedModel: 'NESTED_AFTER', large: true, nestedFirst: true }),
      tokenCount('2026-08-01T10:00:03.000Z', 240, 80, 40),
    ])
    await assertUsesBufferFastPath(path)

    const calls = await parseRollout(path)
    expect(calls.map(call => call.model)).toEqual(['RIGHT_MODEL', 'RIGHT_MODEL'])
    expect(calls.map(call => call.inputTokens + call.outputTokens + call.reasoningTokens)).toEqual([120, 120])
  })

  it('applies direct model switches while ignoring nested provenance.model', async () => {
    const path = await writeRollout('mid-file-direct-switch', [
      sessionMeta({ directModel: 'SESSION_MODEL_A', nestedModel: 'NESTED_IGNORED_A', large: true, nestedFirst: true }),
      turnContext('TURN_MODEL_B'),
      tokenCount('2026-08-01T10:00:02.000Z', 120),
      sessionMeta({ directModel: 'SESSION_MODEL_C', nestedModel: 'NESTED_IGNORED_C', large: true, nestedFirst: true }),
      tokenCount('2026-08-01T10:00:03.000Z', 240, 80, 40),
    ])
    await assertUsesBufferFastPath(path)

    const calls = await parseRollout(path)
    expect(calls.map(call => call.model)).toEqual(['TURN_MODEL_B', 'SESSION_MODEL_C'])
    expect(calls.every(call => !call.model.includes('NESTED_IGNORED'))).toBe(true)
  })

  it('preserves model switches, explicit reasoning state, and accounting evidence', async () => {
    const path = await writeRollout('model-switch-reasoning', [
      sessionMeta({ nestedModel: 'NESTED_MODEL', large: true, nestedFirst: true }),
      turnContext('MODEL_A', 'high'),
      tokenCount('2026-08-01T10:00:02.000Z', 120, 100, 20, 5),
      turnContext('MODEL_B', 'low'),
      tokenCount('2026-08-01T10:00:03.000Z', 240, 80, 40, 7),
      sessionMeta({ nestedModel: 'NESTED_MODEL_AFTER', large: true, nestedFirst: true }),
      tokenCount('2026-08-01T10:00:04.000Z', 360, 60, 30, 9),
    ])
    await assertUsesBufferFastPath(path)

    const calls = await parseRollout(path)
    expect(calls.map(call => call.model)).toEqual(['MODEL_A', 'MODEL_B', 'MODEL_B'])
    expect(calls.map(call => [call.reasoningLevel, call.reasoningLevelSource])).toEqual([
      ['high', 'explicit'],
      ['low', 'explicit'],
      ['low', 'explicit'],
    ])
    expect(calls.reduce((sum, call) => sum + call.inputTokens, 0)).toBe(240)
    expect(calls.reduce((sum, call) => sum + call.outputTokens, 0)).toBe(90)
    expect(calls.reduce((sum, call) => sum + call.reasoningTokens, 0)).toBe(21)
  })

  it('keeps model_provider independent from model attribution', async () => {
    const path = await writeRollout('model-provider-independence', [
      sessionMeta({ directModel: 'MODEL_A', nestedModel: 'MODEL_B', modelProvider: 'OpenAI', large: true, nestedFirst: true }),
      turnContext('MODEL_A'),
      tokenCount('2026-08-01T10:00:02.000Z', 120),
    ])
    await assertUsesBufferFastPath(path)

    const decorated = withCodexModelProvider(createCodexProvider(root))
    const calls = await parseRollout(path, decorated)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.model).toBe('MODEL_A')
    expect(calls[0]!.modelProvider).toBe('openai')
    expect(calls[0]!.pricingContext?.inferenceProvider).toBe('openai')
  })
})
