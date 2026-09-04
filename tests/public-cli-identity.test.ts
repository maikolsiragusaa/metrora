import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const sourceFiles = [
  'src/main.ts',
  'src/export.ts',
  'src/audit-report.ts',
  'src/compare.tsx',
  'src/context-tree.ts',
  'src/cursor-cache.ts',
  'src/mcp/tables.ts',
  'src/optimize.ts',
  'src/providers/types.ts',
  'src/web-dashboard.ts',
  'src/optimization-operations/apply.ts',
  'src/optimization-operations/cli.ts',
  'src/optimization-operations/journal.ts',
  'src/optimization-operations/optimize-apply.ts',
  'src/optimization-operations/report.ts',
  'src/guard/cli.ts',
  'src/guard/hooks.ts',
  'src/guard/settings.ts',
  'src/sharing/discovery.ts',
  'src/sharing/store.ts',
  'src/sync/auth.ts',
  'src/sync/cli.ts',
  'src/sync/config.ts',
  'src/sync/credentials.ts',
  'src/sync/discovery.ts',
  'src/sync/ledger.ts',
  'src/sync/otlp.ts',
  'src/sync/push.ts',
] as const

describe('canonical Metrora CLI public identity', () => {
  it('uses Metrora in canonical command examples and diagnostics', () => {
    const source = sourceFiles
      .map(path => readFileSync(join(process.cwd(), path), 'utf-8'))
      .join('\n')

    expect(source).toContain('metrora optimize')
    expect(source).toContain('metrora optimization-actions')
    expect(source).toContain('metrora share')
    expect(source).toContain('metrora sync')
  })

  it('uses a Metrora default export name while preserving compatibility authorities', () => {
    const main = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf-8')
    const exporter = readFileSync(join(process.cwd(), 'src/export.ts'), 'utf-8')

    expect(main).toContain('const defaultName = `metrora-${toDateString(new Date())}`')
    expect(main).toContain('type MetroraConfig')
    expect(exporter).toContain("schema: 'metrora.export.v2'")
    expect(exporter).toContain("const EXPORT_MARKER_FILE = '.metrora-export'")
  })
})
