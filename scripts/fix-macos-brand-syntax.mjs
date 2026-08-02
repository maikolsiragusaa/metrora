import { readFile, writeFile } from 'node:fs/promises'

const path = 'mac/Sources/CodeBurnMenubar/Views/MenuBarContent.swift'
let source = await readFile(path, 'utf8')

const before = 'ForEach(Array(heights.enumerated()), id: .offset)'
const after = 'ForEach(Array(heights.enumerated()), id: \\.offset)'
const count = source.split(before).length - 1
if (count !== 1) throw new Error(`Expected one malformed key path, found ${count}`)
source = source.replace(before, after)
source = source
  .replace('/// and centers an animated burning flame -- the brand mark filling up bottom-to-top in\n/// yellow→orange→red, looping.', '/// and centers an animated Signal Grid mark that fills one measured bar at a time.')
  .replaceAll('private let flameSize: CGFloat = 64', 'private let markSize: CGFloat = 64')
  .replaceAll('SignalGridLoadingMark(size: flameSize', 'SignalGridLoadingMark(size: markSize')

await writeFile(path, source)
console.log('Corrected Signal Grid loading mark syntax')
