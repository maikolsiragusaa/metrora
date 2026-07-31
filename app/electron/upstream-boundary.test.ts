// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_ROOTS = [join(APP_ROOT, 'electron'), join(APP_ROOT, 'renderer')]
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.html', '.css'])
const TEST_FILE = /(?:^|\.)test\.[^.]+$/

function runtimeFiles(dir: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) files.push(...runtimeFiles(path))
    else if (TEXT_EXTENSIONS.has(extname(name)) && !TEST_FILE.test(name)) files.push(path)
  }
  return files
}

const FORBIDDEN_RUNTIME_DESTINATIONS = [
  'api.codeburn.app',
  'www.codeburn.app/telemetry',
  'github.com/getagentseal/codeburn/releases',
  'apps.microsoft.com/detail/9P0R4ZL5XMB8',
  'discord.com/invite/w2sw8mCqep',
  'x.com/_codeburn',
  'youtube.com/@codeburnn',
  'linkedin.com/showcase/codeburnn',
]

describe('desktop upstream-service boundary', () => {
  const sources = RUNTIME_ROOTS.flatMap(runtimeFiles).map(path => ({
    path,
    content: readFileSync(path, 'utf8'),
  }))

  it.each(FORBIDDEN_RUNTIME_DESTINATIONS)('does not contain %s', destination => {
    const matches = sources.filter(source => source.content.includes(destination)).map(source => source.path)
    expect(matches, `forbidden inherited destination found in: ${matches.join(', ')}`).toEqual([])
  })

  it('keeps the visible desktop identity on Qovrion', () => {
    expect(readFileSync(join(APP_ROOT, 'renderer', 'index.html'), 'utf8')).toContain('<title>Qovrion</title>')
    expect(readFileSync(join(APP_ROOT, 'renderer', 'components', 'Sidebar.tsx'), 'utf8')).toContain('<b>Qovrion</b>')
    expect(readFileSync(join(APP_ROOT, 'renderer', 'components', 'AboutModal.tsx'), 'utf8')).toContain('>Qovrion</div>')
  })
})
