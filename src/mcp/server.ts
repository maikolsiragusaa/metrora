import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { loadPricing } from '../models.js'
import { boundedMetroraToolJson, MetroraToolContractError } from '../tools/contract.js'
import { METRORA_TOOL_MODEL_FILTER_MAX_LENGTH } from '../tools/contract.js'
import type { MetroraToolDefinition, MetroraToolRegistry } from '../tools/types.js'
import { createMetroraToolRuntime, type MetroraMcpStartupOptions } from './runtime.js'

const INSTRUCTIONS =
  'Metrora provides local, read-only, content-minimal factual evidence from its canonical Tools registry. ' +
  'The server uses stdio, keeps the selected scope bounded, and never exposes raw conversation content, ' +
  'credentials, unrestricted session payloads, or provider proxy capability. Unavailable and stale evidence ' +
  'remains labeled as such.'

const MAX_ACTIVE_CALLS = 2
const MAX_QUEUED_CALLS = 8

type JsonSchemaProperty = { type?: unknown; enum?: unknown[] }
type ZodShape = Record<string, z.ZodTypeAny>

function shapeFromDefinition(definition: MetroraToolDefinition): z.ZodObject<ZodShape> {
  const properties = definition.function.parameters.properties
  const shape: ZodShape = {}
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return z.object(shape).strict()

  for (const [name, raw] of Object.entries(properties as Record<string, JsonSchemaProperty>)) {
    if (Array.isArray(raw?.enum) && raw.enum.every(value => typeof value === 'string') && raw.enum.length > 0) {
      const values = raw.enum as [string, ...string[]]
      shape[name] = z.enum(values).optional()
      continue
    }
    if (raw?.type === 'string') {
      shape[name] = z.string().max(name === 'model' ? METRORA_TOOL_MODEL_FILTER_MAX_LENGTH : 256).optional()
      continue
    }
    shape[name] = z.unknown().optional()
  }
  return z.object(shape).strict()
}

function abortError(): Error {
  const error = new Error('Metrora tool call cancelled')
  error.name = 'AbortError'
  return error
}

type PendingCall<T> = {
  signal?: AbortSignal
  run: () => Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
  cleanup?: () => void
}

/** Keep a local stdio server from creating an unbounded parser backlog. */
function createCallLimiter() {
  let active = 0
  const pending: Array<PendingCall<unknown>> = []

  const start = <T>(call: PendingCall<T>): void => {
    call.cleanup?.()
    active += 1
    void call.run().then(call.resolve, call.reject).finally(() => {
      active -= 1
      pump()
    })
  }

  const pump = (): void => {
    while (active < MAX_ACTIVE_CALLS && pending.length > 0) {
      const call = pending.shift()!
      call.cleanup?.()
      if (call.signal?.aborted) {
        call.reject(abortError())
        continue
      }
      start(call)
    }
  }

  const run = <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(abortError())
    if (active < MAX_ACTIVE_CALLS) {
      return new Promise<T>((resolve, reject) => start({ signal, run: task, resolve, reject }))
    }
    if (pending.length >= MAX_QUEUED_CALLS) {
      return Promise.reject(new Error('Metrora tool call queue is full'))
    }
    return new Promise<T>((resolve, reject) => {
      const call: PendingCall<T> = { signal, run: task, resolve, reject }
      const onAbort = (): void => {
        const index = pending.indexOf(call as PendingCall<unknown>)
        if (index >= 0) pending.splice(index, 1)
        call.cleanup?.()
        reject(abortError())
      }
      if (signal) {
        call.cleanup = () => signal.removeEventListener('abort', onAbort)
        signal.addEventListener('abort', onAbort, { once: true })
      }
      pending.push(call as PendingCall<unknown>)
      pump()
    })
  }

  return { run }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof MetroraToolContractError) return error.code
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
  return 'unavailable'
}

function safeErrorText(error: unknown): string {
  return `Metrora tool request rejected (${safeErrorCode(error)}).`
}

export function createServer(deps: { version: string; registry: MetroraToolRegistry }): McpServer {
  const limiter = createCallLimiter()
  const server = new McpServer({ name: 'metrora', version: deps.version }, { instructions: INSTRUCTIONS })

  // Discovery and registration are generated from the same canonical list used
  // by the transport-neutral registry. There is no MCP-specific factual list.
  for (const definition of deps.registry.definitions) {
    const name = definition.function.name
    const inputSchema = shapeFromDefinition(definition)
    server.registerTool(
      name,
      {
        title: `Metrora — ${name}`,
        description: definition.function.description,
        inputSchema,
        annotations: { title: `Metrora — ${name}`, readOnlyHint: true, openWorldHint: false, idempotentHint: true },
      },
      async (args, extra) => {
        try {
          const execution = await limiter.run(
            () => deps.registry.execute(name, args as Record<string, unknown>, extra.signal),
            extra.signal,
          )
          const envelope = execution.envelope ?? JSON.parse(execution.content) as Record<string, unknown>
          const text = boundedMetroraToolJson(envelope)
          return {
            content: [{ type: 'text' as const, text }],
            structuredContent: envelope,
          }
        } catch (error) {
          return { content: [{ type: 'text' as const, text: safeErrorText(error) }], isError: true }
        }
      },
    )
  }

  return server
}

function redirectProtocolLogs(): void {
  const write = (...args: unknown[]): void => {
    process.stderr.write(args.map(value => typeof value === 'string' ? value : String(value)).join(' ') + '\n')
  }
  console.log = write as typeof console.log
  console.info = write as typeof console.info
  console.debug = write as typeof console.debug
  console.warn = write as typeof console.warn
}

export async function startStdioServer(version: string, options: MetroraMcpStartupOptions = {}): Promise<void> {
  // The protocol owns stdout. Initialization is deliberately silent there.
  redirectProtocolLogs()
  await loadPricing()
  const registry = await createMetroraToolRuntime(options)
  const server = createServer({ version, registry })
  const transport = new StdioServerTransport()
  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    await server.close().catch(() => undefined)
    await transport.close().catch(() => undefined)
  }
  const onSignal = (): void => { void shutdown() }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    await server.connect(transport)
  } catch (error) {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await shutdown()
    throw error
  }
}
