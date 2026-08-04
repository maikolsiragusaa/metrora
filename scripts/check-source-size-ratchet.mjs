import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const defaultMaxLines = 600
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
    || /\.node-test\.[cm]?[jt]s$/.test(path)
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

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    ...options,
  }).trim()
}

function resolveBaseRef() {
  const configured = process.env.SOURCE_SIZE_BASE_REF?.trim()
  if (configured && !/^0+$/.test(configured)) return configured
  try {
    return git(['rev-parse', 'HEAD^'])
  } catch {
    return null
  }
}

function renameMapFrom(baseRef) {
  const renames = new Map()
  if (!baseRef) return renames
  let output = ''
  try {
    output = git(['diff', '--name-status', '--find-renames=50%', baseRef, 'HEAD', '--'])
  } catch {
    return renames
  }
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [status, oldPath, newPath] = line.split('\t')
    if (!status?.startsWith('R') || !oldPath || !newPath) continue
    renames.set(normalized(newPath), normalized(oldPath))
  }
  return renames
}

function readAtRef(ref, path) {
  if (!ref) return null
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

const baseRef = resolveBaseRef()
if (!baseRef) {
  console.error('A Git base reference is required for source-size validation.')
  process.exit(1)
}

const renames = renameMapFrom(baseRef)
const failures = []
for (const file of await collect(root)) {
  const currentLines = physicalLineCount(await readFile(file.absolute, 'utf8'))
  if (currentLines <= defaultMaxLines) continue

  const basePath = renames.get(file.path) ?? file.path
  const baseSource = readAtRef(baseRef, basePath)
  const baseLines = baseSource === null ? null : physicalLineCount(baseSource)

  if (baseLines === null || baseLines <= defaultMaxLines) {
    failures.push(`${file.path}: ${currentLines} lines; new or newly oversized production modules must remain at or below ${defaultMaxLines}`)
    continue
  }

  if (currentLines > baseLines) {
    failures.push(`${file.path}: grew from ${baseLines} to ${currentLines} lines; an already oversized production module may not grow`)
  }
}

if (failures.length > 0) {
  console.error('Source-size ratchet failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('Extract a coherent responsibility or reduce the affected module before integration.')
  process.exit(1)
}

console.log('Source-size ratchet passed against the Git base.')
