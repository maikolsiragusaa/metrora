import { OPENCODE_METRORA_TOOL_IDS, OPENCODE_METRORA_TOOL_MAP, type OpenCodeMetroraToolId } from './types'

/**
 * This source is written into Metrora's private OpenCode config directory at
 * runtime. OpenCode discovers it through its normal config-directory tool
 * extension point; Metrora does not implement a second tool runtime.
 */
export const OPENCODE_USAGE_TOOL_SOURCE = String.raw`import { readFile } from "node:fs/promises"

const MAX_OUTPUT = 8000
const MAX_PROVIDERS = 20
const MAX_NUMBER = 1000000000000

function boundedNumber(value, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  const bounded = Math.min(MAX_NUMBER, value)
  return integer ? Math.floor(bounded) : bounded
}

function boundedText(value, max) {
  if (typeof value !== "string") return null
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, max) || null
}

function projectSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const source = value
  const providers = Array.isArray(source.providers)
    ? source.providers.slice(0, MAX_PROVIDERS).flatMap(provider => {
        if (!provider || typeof provider !== "object") return []
        const costUSD = boundedNumber(provider.costUSD)
        if (costUSD === null) return []
        return [{
          id: boundedText(provider.id, 80) || "unknown",
          label: boundedText(provider.label, 120) || "Unknown provider",
          costUSD,
        }]
      })
    : []
  return {
    schemaVersion: "metrora.usage-snapshot.v1",
    generatedAt: boundedText(source.generatedAt, 40),
    period: "today",
    available: source.available === true,
    costUSD: boundedNumber(source.costUSD),
    calls: boundedNumber(source.calls, true),
    sessions: boundedNumber(source.sessions, true),
    inputTokens: boundedNumber(source.inputTokens, true),
    outputTokens: boundedNumber(source.outputTokens, true),
    providers,
  }
}

export default {
  description: "Read the current, read-only Metrora usage snapshot for compatibility. It covers measured usage and activity only; use canonical Metrora Tools for bounded evidence.",
  args: {},
  async execute() {
    const snapshotPath = process.env.METRORA_USAGE_SNAPSHOT_FILE
    if (!snapshotPath) return "Metrora usage snapshot is unavailable."
    try {
      const value = projectSnapshot(JSON.parse(await readFile(snapshotPath, "utf8")))
      return value ? JSON.stringify(value).slice(0, MAX_OUTPUT) : "Metrora usage snapshot is unavailable."
    } catch {
      return "Metrora usage snapshot is unavailable."
    }
  },
}
`

const PERIOD_VALUES = ['today', 'yesterday', 'week', '30days', 'month', 'all', 'lifetime'] as const
const MAX_ARGUMENT_BYTES = 8 * 1024
const MAX_OUTPUT_BYTES = 32 * 1024
const MAX_STDERR_BYTES = 8 * 1024
const DEFAULT_TIMEOUT_MS = 45_000
const UNAVAILABLE = 'Metrora tool unavailable.'

type OpenCodeToolArgumentSchema = {
  filters: {
    type: 'object'
    properties: Record<string, Record<string, unknown>>
    required: string[]
    additionalProperties: false
  }
}

const PERIOD_ARGUMENT = {
  type: 'string',
  enum: [...PERIOD_VALUES],
  description: 'Optional bounded period refinement; it cannot widen the startup scope.',
}
const MODEL_ARGUMENT = {
  type: 'string',
  maxLength: 256,
  description: 'Optional exact model filter.',
}

function filterArguments(properties: Record<string, Record<string, unknown>>): OpenCodeToolArgumentSchema {
  return {
    filters: {
      type: 'object',
      properties,
      required: [],
      additionalProperties: false,
    },
  }
}

const TOOL_CONFIG: Record<OpenCodeMetroraToolId, { description: string; args: OpenCodeToolArgumentSchema }> = {
  metrora_get_spend_snapshot: {
    description: 'Read canonical Metrora measured spend, daily trend, model and Project drivers, and coverage.',
    args: filterArguments({ period: PERIOD_ARGUMENT, model: MODEL_ARGUMENT }),
  },
  metrora_get_model_efficiency: {
    description: 'Read canonical Metrora model rows and observed cost per call. Do not infer quality or comparable work.',
    args: filterArguments({ period: PERIOD_ARGUMENT, model: MODEL_ARGUMENT }),
  },
  metrora_get_overview_snapshot: {
    description: 'Read the canonical Metrora overview for the selected bounded scope.',
    args: filterArguments({ period: PERIOD_ARGUMENT, model: MODEL_ARGUMENT }),
  },
  metrora_get_project_drivers: {
    description: 'Read descriptive Project spend drivers from canonical Metrora evidence. Do not infer causality.',
    args: filterArguments({ period: PERIOD_ARGUMENT }),
  },
  metrora_get_session_highlights: {
    description: 'Read content-minimal highest-cost session highlights from canonical Metrora evidence.',
    args: filterArguments({ period: PERIOD_ARGUMENT }),
  },
  metrora_get_coverage_report: {
    description: 'Read canonical Metrora evidence coverage, assumptions, and unknowns for the selected scope.',
    args: filterArguments({ period: PERIOD_ARGUMENT }),
  },
  metrora_get_bench_evidence: {
    description: 'Read bounded canonical Metrora Bench history and compatible comparisons. Never start a Bench run.',
    args: filterArguments({ period: PERIOD_ARGUMENT }),
  },
}

function sourceJson(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Generate a dependency-light OpenCode module. The default timeout is part of
 * the production boundary; the optional argument keeps the safety behavior
 * directly testable without waiting 45 seconds in unit tests.
 */
export function createOpenCodeMetroraToolSource(
  toolId: OpenCodeMetroraToolId,
  options: { timeoutMs?: number } = {},
): string {
  const config = TOOL_CONFIG[toolId]
  const canonicalToolName = OPENCODE_METRORA_TOOL_MAP[toolId]
  const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
    ? Math.max(1, Math.floor(options.timeoutMs!))
    : DEFAULT_TIMEOUT_MS
  return String.raw`import { spawn } from "node:child_process"
import { isAbsolute } from "node:path"

const OPENCODE_TOOL_ID = ${sourceJson(toolId)}
const CANONICAL_TOOL_NAME = ${sourceJson(canonicalToolName)}
const MAX_ARGUMENT_BYTES = ${MAX_ARGUMENT_BYTES}
const MAX_OUTPUT_BYTES = ${MAX_OUTPUT_BYTES}
const MAX_STDERR_BYTES = ${MAX_STDERR_BYTES}
const TIMEOUT_MS = ${timeoutMs}
const UNAVAILABLE = ${sourceJson(UNAVAILABLE)}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8")
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function readBridgeSpec() {
  const raw = process.env.METRORA_TOOL_BRIDGE_SPEC
  if (typeof raw !== "string" || byteLength(raw) > MAX_ARGUMENT_BYTES) return null
  let value
  try { value = JSON.parse(raw) } catch { return null }
  if (!isRecord(value) || !Array.isArray(value.command) || !isRecord(value.environment)) return null
  if (Object.keys(value).some(key => key !== "command" && key !== "environment")) return null
  const command = value.command
  if ((command.length !== 3 && command.length !== 4) || !command.every(item => typeof item === "string" && item.length > 0)) return null
  if (!isAbsolute(command[0])) return null
  if (command.length === 3) {
    if (command[1] !== "tools" || command[2] !== "call") return null
  } else {
    if (!isAbsolute(command[1]) || command[2] !== "tools" || command[3] !== "call") return null
  }
  const environment = value.environment
  if (Object.keys(environment).some(key => key !== "ELECTRON_RUN_AS_NODE")) return null
  if (environment.ELECTRON_RUN_AS_NODE !== undefined && environment.ELECTRON_RUN_AS_NODE !== "1") return null
  return { command: [...command], environment: { ...(environment.ELECTRON_RUN_AS_NODE === "1" ? { ELECTRON_RUN_AS_NODE: "1" } : {}) } }
}

function terminationSignal(context) {
  const signal = context && context.abort
  return signal && typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function"
    ? signal
    : null
}

function canonicalArguments(value) {
  if (value === undefined) return {}
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length === 0) return {}
  if (keys.length !== 1 || !Object.prototype.hasOwnProperty.call(value, "filters") || !isRecord(value.filters)) return null
  return value.filters
}

function invokeBridge(bridge, args, signal) {
  if (signal?.aborted) return Promise.resolve(null)
  let serializedArgs
  try {
    if (!isRecord(args)) return Promise.resolve(null)
    serializedArgs = JSON.stringify(args)
  } catch {
    return Promise.resolve(null)
  }
  if (typeof serializedArgs !== "string" || byteLength(serializedArgs) > MAX_ARGUMENT_BYTES) return Promise.resolve(null)

  return new Promise(resolve => {
    let child
    let settled = false
    let stdout = ""
    let stdoutBytes = 0
   let stderrBytes = 0
   let timer
    let hardTimer
   const finish = value => {
     if (settled) return
     settled = true
      if (timer !== undefined) clearTimeout(timer)
     signal?.removeEventListener("abort", onAbort)
     resolve(value)
   }
   const terminate = () => {
     try { child?.kill() } catch { /* the result remains unavailable */ }
      hardTimer ??= setTimeout(() => {
        try { child?.kill("SIGKILL") } catch { /* the result remains unavailable */ }
      }, 250)
   }
    const onAbort = () => {
      terminate()
      finish(null)
    }

    try {
      child = spawn(bridge.command[0], [...bridge.command.slice(1), CANONICAL_TOOL_NAME, "--args-json", serializedArgs], {
        shell: false,
        windowsHide: true,
        env: bridge.environment,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch {
      finish(null)
      return
    }

    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) {
      terminate()
      finish(null)
      return
    }
    timer = setTimeout(() => {
      terminate()
      finish(null)
    }, TIMEOUT_MS)
    child.stdout?.on("data", chunk => {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
      stdoutBytes += byteLength(text)
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        terminate()
        finish(null)
        return
      }
      stdout += text
    })
    child.stderr?.on("data", chunk => {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
      stderrBytes += byteLength(text)
      if (stderrBytes > MAX_STDERR_BYTES) {
        terminate()
        finish(null)
      }
    })
    child.once("error", () => finish(null))
    child.once("close", code => {
      if (settled || code !== 0) {
        if (!settled) finish(null)
        return
      }
      const output = stdout.trim()
      if (!output || byteLength(output) > MAX_OUTPUT_BYTES) {
        finish(null)
        return
      }
      try {
        const parsed = JSON.parse(output)
        if (!isRecord(parsed)) {
          finish(null)
          return
        }
        const canonical = JSON.stringify(parsed)
        finish(typeof canonical === "string" && byteLength(canonical) <= MAX_OUTPUT_BYTES ? canonical : null)
      } catch {
        finish(null)
      }
    })
  })
}

export default {
  description: ${sourceJson(config.description)},
  args: ${sourceJson(config.args)},
  async execute(args, context) {
    try {
      const bridge = readBridgeSpec()
      if (!bridge) return UNAVAILABLE
      const output = await invokeBridge(bridge, canonicalArguments(args), terminationSignal(context))
      return typeof output === "string" ? output : UNAVAILABLE
    } catch {
      return UNAVAILABLE
    }
  },
}
`
}

export const OPENCODE_METRORA_TOOL_SOURCES: Readonly<Record<OpenCodeMetroraToolId, string>> = Object.freeze(
  Object.fromEntries(OPENCODE_METRORA_TOOL_IDS.map(toolId => [toolId, createOpenCodeMetroraToolSource(toolId)])) as Record<OpenCodeMetroraToolId, string>,
)
