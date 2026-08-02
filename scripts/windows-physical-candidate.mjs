import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  collectPayloadInventory,
  serializeInventory,
  sha256File,
  sha256Text,
  summarizeInventory,
} from './windows-release-manifest-lib.mjs'

const inventoryFile = 'CANONICAL_PRODUCT_PAYLOAD.jsonl'
const sha256Pattern = /^[a-f0-9]{64}$/

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function parsePhysicalCandidateInventory(text) {
  const entries = []
  const seen = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const raw = JSON.parse(line)
    if (
      !raw
      || typeof raw.path !== 'string'
      || !raw.path
      || raw.path.startsWith('/')
      || raw.path.includes('\\')
      || raw.path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
      || /[\r\n\0]/.test(raw.path)
      || !Number.isSafeInteger(raw.size)
      || raw.size < 0
      || !sha256Pattern.test(raw.sha256)
    ) {
      throw new Error('physical candidate inventory contains an invalid entry')
    }
    if (seen.has(raw.path)) {
      throw new Error(`physical candidate inventory contains duplicate path: ${raw.path}`)
    }
    seen.add(raw.path)
    entries.push({ path: raw.path, size: raw.size, sha256: raw.sha256 })
  }
  if (entries.length === 0) throw new Error('physical candidate inventory is empty')
  const sorted = [...entries].sort((left, right) => compareText(left.path, right.path))
  if (JSON.stringify(entries) !== JSON.stringify(sorted)) {
    throw new Error('physical candidate inventory is not sorted canonically')
  }
  return entries
}

function isInsideOrEqual(root, target) {
  const bounded = relative(root, target)
  return bounded === '' || (
    bounded !== '..'
    && !bounded.startsWith(`..${sep}`)
    && !isAbsolute(bounded)
  )
}

function assertInside(root, target, label) {
  if (target === root || !isInsideOrEqual(root, target)) {
    throw new Error(`${label} escapes its bounded root`)
  }
}

export async function materializePhysicalCanonicalPayload(options) {
  const candidate = resolve(options.candidateDirectory)
  const output = resolve(options.outputDirectory)
  if (isInsideOrEqual(candidate, output)) {
    throw new Error('physical canonical output must remain outside the candidate directory')
  }

  const inventoryPath = join(candidate, inventoryFile)
  const portable = join(candidate, 'portable')
  const text = await readFile(inventoryPath, 'utf8')
  const entries = parsePhysicalCandidateInventory(text)

  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })

  for (const entry of entries) {
    const source = resolve(portable, entry.path)
    const destination = resolve(output, entry.path)
    assertInside(portable, source, 'portable source')
    assertInside(output, destination, 'canonical destination')

    const sourceStat = await stat(source)
    if (!sourceStat.isFile() || sourceStat.size !== entry.size || await sha256File(source) !== entry.sha256) {
      throw new Error(`portable canonical source does not match inventory: ${entry.path}`)
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  const actual = await collectPayloadInventory(output)
  if (serializeInventory(actual) !== serializeInventory(entries)) {
    throw new Error('materialized physical canonical payload does not match its inventory')
  }
  const summary = summarizeInventory(entries, text)
  if (summary.inventorySha256 !== sha256Text(text)) {
    throw new Error('physical candidate inventory digest is inconsistent')
  }
  return summary
}
