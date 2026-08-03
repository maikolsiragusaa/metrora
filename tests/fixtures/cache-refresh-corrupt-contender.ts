import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'

import { acquireCacheRefreshLock } from '../../src/cache-refresh-lock.js'

const [cacheDir, barriers, id] = process.argv.slice(2)
if (!cacheDir || !barriers || !id) throw new Error('cacheDir, barriers and id are required')

const mark = async (name: string): Promise<void> => {
  await writeFile(join(barriers, `${id}.${name}`), '')
}

const result = await acquireCacheRefreshLock({
  cacheDir,
  heartbeatMs: 10,
  staleMs: 90,
  waitMs: 250,
  pollMs: 5,
})

await mark(result.outcome)
if (result.outcome === 'acquired') {
  const releasePath = join(barriers, `${id}.release`)
  const deadline = Date.now() + 10_000
  while (!existsSync(releasePath)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${releasePath}`)
    await new Promise(resolve => { setTimeout(resolve, 5) })
  }
  await result.handle.release()
  await mark('done')
}
