import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const baselinePath = join(root, 'config', 'source-size-baseline.json')
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const defaultMax = baseline.defaultMaxLines
const frozen = new Map(Object.entries(baseline.frozenFiles))
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const excludedDirectories = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'out',
  'vendor', 'generated', 'fixtures', '__fixtures__', 'assets',
])

function normalized(path) {
  return path.split(sep).join('/')
}

function isTestFile(path) {
  return /(^|\/)(__tests__|test|tests)(\/|$)/.test(path)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
}

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collect(absolute))
      continue
    }
    const path = normalized(relative(root, absolute))
    if (!extensions.has(extname(entry.name)) || isTestFile(path)) continue
    files.push({ absolute, path })
  }
  return files
}

function physicalLineCount(source) {
  if (source.length === 0) return 0
  return source.split(/\r?\n/).length
}

const failures = []
const reports = []
for (const file of await collect(root)) {
  const lines = physicalLineCount(await readFile(file.absolute, 'utf8'))
  const frozenMax = frozen.get(file.path)
  const max = frozenMax ?? defaultMax
  if (lines > max) {
    failures.push(`${file.path}: ${lines} lines (maximum ${max}${frozenMax ? ', frozen legacy baseline' : ''})`)
  }
  if (lines >= Math.floor(defaultMax * 0.75) || frozenMax) {
    reports.push({ path: file.path, lines, max, frozen: frozenMax !== undefined })
  }
  if (frozenMax !== undefined) frozen.delete(file.path)
}

for (const [path] of frozen) {
  failures.push(`${path}: frozen baseline entry does not match a production source file`)
}

reports.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
console.log('Source-size review list:')
for (const item of reports) {
  console.log(`- ${item.path}: ${item.lines}/${item.max}${item.frozen ? ' (frozen)' : ''}`)
}

if (failures.length > 0) {
  console.error('\nSource-size ratchet failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('\nSplit an actual responsibility, or add a reviewed temporary baseline tied to issue #52.')
  process.exitCode = 1
} else {
  console.log('\nSource-size ratchet passed.')
}
