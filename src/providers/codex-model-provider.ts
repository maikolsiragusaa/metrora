import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

import { normalizeExplicitModelProvider } from '../model-provider.js'
import type { Provider, SessionParser, SessionSource } from './types.js'

const MAX_SESSION_META_LINES = 256

export class CodexModelProviderContradictionError extends Error {
  constructor() {
    super('Codex call provider contradicts session_meta.model_provider')
    this.name = 'CodexModelProviderContradictionError'
  }
}

/**
 * Read only the bounded session metadata prefix needed for provider identity.
 * Missing, malformed, or unsupported values remain unknown; no provider is
 * inferred from the Codex collector name or model label.
 */
export async function readCodexSessionModelProvider(
  sourcePath: string,
): Promise<string | undefined> {
  let stream: ReturnType<typeof createReadStream> | undefined
  try {
    stream = createReadStream(sourcePath, { encoding: 'utf8' })
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    let count = 0
    for await (const line of lines) {
      count += 1
      if (count > MAX_SESSION_META_LINES) break
      if (!line.includes('session_meta') || !line.includes('model_provider')) continue
      try {
        const entry = JSON.parse(line) as {
          type?: unknown
          payload?: { model_provider?: unknown }
        }
        if (entry.type !== 'session_meta') continue
        return normalizeExplicitModelProvider(entry.payload?.model_provider)
      } catch {
        // A malformed unrelated/prefix line remains the base parser's concern.
      }
    }
    return undefined
  } catch {
    return undefined
  } finally {
    stream?.destroy()
  }
}

export type CodexModelProviderReader = (sourcePath: string) => Promise<string | undefined>

/**
 * Decorate the canonical Codex provider so fresh parser output carries the
 * source-recorded model/API provider into the ordinary session cache.
 */
export function withCodexModelProvider(
  provider: Provider,
  readProvider: CodexModelProviderReader = readCodexSessionModelProvider,
): Provider {
  return {
    ...provider,
    createSessionParser(source: SessionSource, seenKeys, dateRange): SessionParser {
      const base = provider.createSessionParser(source, seenKeys, dateRange)
      return {
        async *parse() {
          const sourceProvider = await readProvider(source.path)
          for await (const call of base.parse()) {
            if (!sourceProvider) {
              yield call
              continue
            }
            if (call.modelProvider && call.modelProvider !== sourceProvider) {
              throw new CodexModelProviderContradictionError()
            }
            yield call.modelProvider ? call : { ...call, modelProvider: sourceProvider }
          }
        },
      }
    },
  }
}
