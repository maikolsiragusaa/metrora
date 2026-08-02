#!/usr/bin/env node

import process from 'node:process'
import { resolve } from 'node:path'

import { verifyWindowsInstallerSource } from './windows-installer-source.mjs'

function parse(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`expected --name value arguments, received: ${argv.slice(index).join(' ')}`)
    }
    if (values.has(key)) throw new Error(`duplicate argument: ${key}`)
    values.set(key, value)
  }
  return values
}

function required(values, name) {
  const value = values.get(name)
  if (!value) throw new Error(`missing required argument: ${name}`)
  return value
}

const args = parse(process.argv.slice(2))
const result = await verifyWindowsInstallerSource({
  canonicalDirectory: resolve(required(args, '--canonical')),
  installerSourceDirectory: resolve(required(args, '--installer-source')),
})

process.stdout.write(`${JSON.stringify(result)}\n`)
