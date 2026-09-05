export const OPENCODE_VERSION = '1.18.27' as const
export const OPENCODE_COMMIT = 'b04697366f05419e9bd7a92f841813dd976161c9' as const
export const OPENCODE_CUSTOM_TOOL_ID = 'metrora_usage_snapshot' as const
export const OPENCODE_LEGACY_CUSTOM_TOOL_ID = OPENCODE_CUSTOM_TOOL_ID
export const OPENCODE_METRORA_TOOL_IDS = [
  'metrora_get_spend_snapshot',
  'metrora_get_model_efficiency',
  'metrora_get_overview_snapshot',
  'metrora_get_project_drivers',
  'metrora_get_session_highlights',
  'metrora_get_coverage_report',
  'metrora_get_bench_evidence',
] as const
export type OpenCodeMetroraToolId = typeof OPENCODE_METRORA_TOOL_IDS[number]
/** All Metrora-owned custom tools expected from the private runtime config. */
export const OPENCODE_CUSTOM_TOOL_IDS = [OPENCODE_CUSTOM_TOOL_ID, ...OPENCODE_METRORA_TOOL_IDS] as const
export const OPENCODE_EXPECTED_CUSTOM_TOOL_IDS = OPENCODE_CUSTOM_TOOL_IDS
export const OPENCODE_LOOPBACK_HOST = '127.0.0.1' as const

export type OpenCodeRuntimeState = 'idle' | 'starting' | 'ready' | 'stopping' | 'unavailable'

/** Renderer-safe. It deliberately contains no server origin or credential. */
export type OpenCodeRuntimeStatus = {
  state: OpenCodeRuntimeState
  version: typeof OPENCODE_VERSION
  commit: typeof OPENCODE_COMMIT
  customToolRegistered: boolean | null
  detail: string | null
}

/** Main-process-only connection material. Never return this across IPC. */
export type OpenCodeConnection = {
  origin: string
  username: string
  password: string
}

export class OpenCodeError extends Error {
  constructor(public readonly kind: string, message: string) {
    super(message)
    this.name = 'OpenCodeError'
  }
}
