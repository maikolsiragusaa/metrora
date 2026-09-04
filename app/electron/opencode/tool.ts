/**
 * This is written into Metrora's private OpenCode config directory at runtime.
 * It is deliberately the only Metrora custom OpenCode tool. OpenCode discovers
 * it through its documented config-directory tool extension point.
 */
export const OPENCODE_USAGE_TOOL_SOURCE = String.raw`import { readFile } from "node:fs/promises"

const MAX_OUTPUT = 8000

export default {
  description: "Read the current, read-only Metrora usage snapshot. Use this only when the user asks about Metrora usage, cost, quota, or activity.",
  args: {},
  async execute() {
    const snapshotPath = process.env.METRORA_USAGE_SNAPSHOT_FILE
    if (!snapshotPath) return "Metrora usage snapshot is unavailable."
    try {
      const value = JSON.parse(await readFile(snapshotPath, "utf8"))
      return JSON.stringify(value).slice(0, MAX_OUTPUT)
    } catch {
      return "Metrora usage snapshot is unavailable."
    }
  },
}
`
