import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtimePathArg = process.argv[2]
if (!runtimePathArg) throw new Error('packaged companion probe requires the exact runtime path')
if (!process.versions.electron) throw new Error('packaged companion probe must run through the bundled Electron runtime')

const runtimePath = resolve(runtimePathArg)
if (basename(runtimePath) !== 'desktop-share-runtime.js' || !runtimePath.toLowerCase().includes('cli.asar')) {
  throw new Error('packaged companion probe received a path outside cli.asar/dist/desktop-share-runtime.js')
}
await access(runtimePath, constants.R_OK)

const runtimeModule = await import(pathToFileURL(runtimePath).href)
if (typeof runtimeModule.createDesktopShareRuntime !== 'function') {
  throw new Error('packaged companion runtime does not expose createDesktopShareRuntime')
}

// Import-only by design: this proves the shipped module is loadable without
// starting its listener, creating pairing state or performing a physical pair.
console.log(JSON.stringify({
  packagedCompanionRuntimeSmoke: 'pass',
  packagedCompanionRuntimeEntry: 'createDesktopShareRuntime',
}))
