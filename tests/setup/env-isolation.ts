// Vitest setup file: isolates every test from the developer's shell environment.
//
// Metrora discovers sessions through a long list of provider-specific env vars
// (CLAUDE_CONFIG_DIR, CODEX_HOME, CRUSH_GLOBAL_DATA, …) and via HOME / XDG_* /
// APPDATA / LOCALAPPDATA. Without this file, values set in the developer's shell
// can bleed into fixture-based tests and make them read real local state.
//
// What this file does:
//   1. Mints an empty sandbox temp dir once per worker.
//   2. REDIRECTED home/platform roots point at the sandbox so ordinary platform
//      defaults land in an empty filesystem.
//   3. XDG roots and explicit product/provider overrides are CLEARED. This is
//      deliberate: tests that replace HOME must be able to exercise that home's
//      canonical defaults instead of silently inheriting one worker-wide XDG
//      root. A test that specifically covers XDG behavior sets that variable in
//      its own beforeEach/test body.
//   4. PRESERVED vars (PATH, COLUMNS, …) are snapshotted from the developer's
//      shell and restored every test. We cannot wipe them because Node uses PATH
//      for spawn/module resolution and terminal code reads COLUMNS.
//   5. Re-asserts the above before EVERY test, so mutations do not leak into the
//      next test.
//
// CAVEAT: env vars set in a test file's beforeAll() get overwritten by this
// file's beforeEach before each test runs. Use beforeEach (not beforeAll) when
// the test body depends on a specific env var value.

import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach } from 'vitest'

const sandbox = mkdtempSync(join(tmpdir(), 'metrora-test-env-'))

const REDIRECTED = [
  'HOME',
  'USERPROFILE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
] as const

const CLEARED = [
  // Platform roots: leave unset unless the individual test is exercising XDG.
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  // Canonical and compatibility product roots. No developer shell override may
  // leak into tests; individual compatibility tests set these explicitly.
  'METRORA_CONFIG_DIR',
  'METRORA_CONFIG_DIR',
  'METRORA_CONFIG_DIR',
  'METRORA_CACHE_DIR',
  'METRORA_CACHE_DIR',
  'METRORA_CACHE_DIR',
  // Provider session-discovery dirs
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CONFIG_DIRS',
  'CLINE_DIR',
  'CLINE_DATA_DIR',
  'CLINE_SESSION_DATA_DIR',
  'CODEX_HOME',
  'CODEWHALE_HOME',
  'CRUSH_GLOBAL_DATA',
  'CODEBUFF_DATA_DIR',
  'FACTORY_DIR',
  'GOOSE_PATH_ROOT',
  'GROK_HOME',
  'KIRO_HOME',
  'KIMI_SHARE_DIR',
  'MUX_ROOT',
  'OPENCODE_DATA_DIR',
  'OPENCODE_DB_PREFIX',
  'QWEN_DATA_DIR',
  'VIBE_HOME',
  'WARP_DB_PATH',
  'ZS_DATA_DIR',
  // Compatibility collector/cache overrides
  'METRORA_COPILOT_JETBRAINS_DIR',
  'METRORA_COPILOT_OTEL_DB',
  'METRORA_COPILOT_SESSION_STATE_DIR',
  'METRORA_COPILOT_WS_STORAGE_DIR',
  'METRORA_DESKTOP_SESSIONS_DIR',
  'METRORA_MUX_DIR',
  'METRORA_ANTIGRAVITY_SETTINGS_PATH',
  // Compatibility behavior toggles (set by developers to tweak local runs)
  'METRORA_COPILOT_DISABLE_OTEL',
  'METRORA_TZ',
  'METRORA_VERBOSE',
  'METRORA_CURSOR_MAX_BUBBLES',
  'METRORA_FORCE_MACOS_MAJOR',
  // Provider model/credential overrides
  'KIMI_MODEL_NAME',
  'AI_GATEWAY_API_KEY',
  'VERCEL_OIDC_TOKEN',
  // Read by detectBashBloat - a developer's real shell limit must not bleed in
  'BASH_MAX_OUTPUT_LENGTH',
] as const

// Snapshotted from the developer's shell and restored every test. These cannot
// be wiped (Node needs PATH for spawn/module resolution; dashboard/table layout
// reads COLUMNS), but a test mutation must not leak into the next test.
const PRESERVED = ['PATH', 'COLUMNS'] as const
const preservedSnapshot = new Map<string, string | undefined>()
for (const key of PRESERVED) preservedSnapshot.set(key, process.env[key])

function applyIsolation(): void {
  for (const key of REDIRECTED) process.env[key] = sandbox
  // Windows' homedir() prefers USERPROFILE, and some path helpers still
  // consult the split drive/path pair. Keep every home representation inside
  // the same empty sandbox for cross-platform fixture determinism.
  process.env['HOMEDRIVE'] = ''
  for (const key of CLEARED) delete process.env[key]
  for (const key of PRESERVED) {
    const original = preservedSnapshot.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
  // Pin the timezone so date grouping is deterministic regardless of the
  // developer's shell timezone. A test that needs another zone can still set
  // process.env.TZ in its own beforeEach.
  process.env.TZ = 'UTC'
}

applyIsolation()
beforeEach(applyIsolation)
