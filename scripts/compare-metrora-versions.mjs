import { compareMetroraVersions } from './version-authority-lib.mjs'

const [left, right, ...extra] = process.argv.slice(2)
if (!left || !right || extra.length > 0) {
  console.error('usage: node scripts/compare-metrora-versions.mjs <left> <right>')
  process.exit(2)
}

try {
  process.stdout.write(`${compareMetroraVersions(left, right)}\n`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
