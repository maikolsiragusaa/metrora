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
  description: "Read the current, read-only Metrora usage snapshot. Use this only when the user asks about Metrora usage, cost, quota, or activity.",
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
