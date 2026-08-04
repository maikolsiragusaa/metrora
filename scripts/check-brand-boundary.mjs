import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)

const runtimeVisibleFiles = [
  'src/overview.ts',
  'src/doctor.ts',
  'src/optimize.ts',
  'src/mcp/server.ts',
  'src/export.ts',
  'src/dashboard.tsx',
  'src/web-dashboard.ts',
  'src/sync/auth.ts',
  'src/codex-throughput.ts',
  'src/sharing/host.ts',
  'src/providers/cursor.ts',
]

const violations = []
for (const path of files.filter(path => path.startsWith('src/') && /\.(?:ts|tsx)$/.test(path))) {
  const content = readFileSync(path, 'utf8')
  content.split(/\r?\n/).forEach((line, index) => {
    if (/codeburn:\s/i.test(line) || /codeburn model-(?:alias|savings)/i.test(line) || /npx codeburn@latest/i.test(line)) {
      violations.push(`${path}:${index + 1}:${line.trim()}`)
    }
  })
}

for (const path of runtimeVisibleFiles) {
  const content = readFileSync(path, 'utf8')
  content.split(/\r?\n/).forEach((line, index) => {
    if (/\bCodeBurn\b/.test(line)) violations.push(`${path}:${index + 1}:${line.trim()}`)
  })
}

if (violations.length) {
  console.error(`Upstream branding escaped the public product boundary:\n${violations.join('\n')}`)
  process.exit(1)
}

console.log('Public product branding boundary passed.')
