import { buildVersionFor } from './version-authority-lib.mjs'

const [version, ...extra] = process.argv.slice(2)
if (!version || extra.length > 0) {
  console.error('usage: node scripts/resolve-metrora-build-version.mjs <version>')
  process.exit(2)
}

try {
  process.stdout.write(`${buildVersionFor(version)}\n`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
