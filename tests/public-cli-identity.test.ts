import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const commands = [
  'report', 'today', 'month', 'overview', 'status', 'sessions', 'models',
  'spend', 'export', 'compare', 'optimize', 'audit', 'doctor', 'yield',
  'context', 'codex-tps', 'budget', 'plan', 'currency', 'model-alias',
  'price-override', 'model-savings', 'proxy-path', 'act', 'guard', 'sync',
  'share', 'devices', 'identity', 'web', 'mcp', 'menubar',
  'antigravity-hook',
] as const

const sourceFiles = [
  'src/main.ts',
  'src/export.ts',
  'src/act/cli.ts',
  'src/act/optimize-apply.ts',
  'src/act/report.ts',
  'src/guard/cli.ts',
  'src/sync/cli.ts',
  'src/compare.tsx',
  'src/optimize.ts',
  'src/audit-report.ts',
] as const

describe('canonical CLI public identity', () => {
  it('uses Metrora in canonical command examples and diagnostics', () => {
    const source = sourceFiles
      .map(path => readFileSync(join(process.cwd(), path), 'utf-8'))
      .join('\n')

    for (const command of commands) {
      expect(source).not.toContain(`codeburn ${command}`)
    }
    expect(source).toContain('metrora optimize')
    expect(source).toContain('metrora act')
    expect(source).toContain('metrora share')
  })

  it('uses a Metrora default export name while preserving export compatibility authorities', () => {
    const main = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf-8')
    const exporter = readFileSync(join(process.cwd(), 'src/export.ts'), 'utf-8')

    expect(main).toContain('const defaultName = `metrora-${toDateString(new Date())}`')
    expect(exporter).toContain("schema: 'codeburn.export.v2'")
    expect(exporter).toContain("const EXPORT_MARKER_FILE = '.codeburn-export'")
  })
})
