import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Runs once per worker before any test. Scrubs the developer's shell so
    // session-discovery env vars (CLAUDE_CONFIG_DIRS, HOME, XDG_*, every
    // provider-specific *_HOME) don't bleed real local data into fixtures.
    setupFiles: ['./tests/setup/env-isolation.ts'],
    // The desktop app owns a separate Vitest project and dependency graph
    // (including jsdom). Keep the root CLI/library suite from collecting its
    // renderer tests with the root Node runtime.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', 'app/**'],
    // The suite contains many spawn-based CLI and cross-process lock fixtures;
    // four workers keep those Windows integration tests deterministic.
    maxWorkers: 4,
  },
})
