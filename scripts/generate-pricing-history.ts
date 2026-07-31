import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  parseHistoricalPriceBookV1,
  renderHistoricalPriceBookMarkdownV1,
} from '../src/pricing/history.js'

const root = resolve(import.meta.dirname, '..')
const catalogPath = resolve(root, 'src/data/pricing-history/catalog.v1.json')
const documentationPath = resolve(root, 'docs/PRICING_HISTORY.md')
const checkOnly = process.argv.includes('--check')

const catalog = parseHistoricalPriceBookV1(JSON.parse(await readFile(catalogPath, 'utf8')))
const expected = renderHistoricalPriceBookMarkdownV1(catalog)

if (checkOnly) {
  const actual = (await readFile(documentationPath, 'utf8').catch(() => ''))
    .replace(/\r\n/g, '\n')
  if (actual !== expected) {
    process.stderr.write('docs/PRICING_HISTORY.md is stale. Run npm run pricing:docs.\n')
    process.exitCode = 1
  }
} else {
  await writeFile(documentationPath, expected, 'utf8')
}
