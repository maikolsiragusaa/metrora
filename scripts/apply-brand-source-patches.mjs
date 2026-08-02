import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const appPath = resolve('dash/src/App.tsx')
let source = await readFile(appPath, 'utf8')

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`)
  source = source.replace(before, after)
}

replaceOnce(
  '<img src="/codeburn-logo.png" alt="CodeBurn" className="h-6 w-6" />',
  '<img src="/metrora-mark.svg" alt="" aria-hidden="true" className="h-6 w-7 object-contain" />',
  'dashboard brand mark',
)

replaceOnce(
  `<span className="text-lg font-semibold tracking-[-0.02em] text-foreground">\n              Code<span className="text-[#e8553a]">Burn</span>\n            </span>`,
  `<span className="text-lg font-semibold tracking-[-0.02em] text-foreground">Metrora</span>`,
  'dashboard wordmark',
)

replaceOnce(
  '>usage</span>',
  '>local usage</span>',
  'dashboard descriptor',
)

replaceOnce('https://codeburn.app/', 'https://metrora.eu', 'website link')
replaceOnce('title="codeburn.app"', 'title="metrora.eu"', 'website title')

const discordBlock = /\n\s*<a\n\s*href="https:\/\/discord\.com\/invite\/w2sw8mCqep"[\s\S]*?\n\s*<\/a>/
if (!discordBlock.test(source)) throw new Error('Discord legacy block not found')
source = source.replace(discordBlock, `
                <a
                  href="https://github.com/maikolsiragusaa/metrora"
                  target="_blank"
                  rel="noreferrer"
                  title="GitHub"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary-foreground transition-colors hover:bg-interactive-secondary hover:text-foreground"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M12 .7a11.3 11.3 0 0 0-3.57 22.02c.57.1.77-.25.77-.55v-2.16c-3.16.69-3.83-1.34-3.83-1.34-.52-1.31-1.26-1.66-1.26-1.66-1.03-.71.08-.7.08-.7 1.14.08 1.74 1.17 1.74 1.17 1.01 1.73 2.66 1.23 3.31.94.1-.73.4-1.23.72-1.51-2.52-.29-5.17-1.26-5.17-5.62 0-1.24.44-2.25 1.17-3.05-.12-.29-.51-1.44.11-3 0 0 .96-.31 3.11 1.16a10.8 10.8 0 0 1 5.67 0c2.16-1.47 3.11-1.16 3.11-1.16.63 1.56.24 2.71.12 3 .73.8 1.17 1.81 1.17 3.05 0 4.37-2.66 5.32-5.19 5.61.41.35.77 1.05.77 2.1v3.16c0 .3.2.66.78.55A11.3 11.3 0 0 0 12 .7Z" />
                  </svg>
                </a>`)

const xBlock = /\n\s*<a\n\s*href="https:\/\/x\.com\/_codeburn"[\s\S]*?\n\s*<\/a>/
if (!xBlock.test(source)) throw new Error('X legacy block not found')
source = source.replace(xBlock, '')

source = source.replaceAll('accent-[#1f8a5b]', 'accent-[#2563EB]')

for (const forbidden of ['alt="CodeBurn"', 'codeburn.app', 'x.com/_codeburn', 'discord.com/invite/w2sw8mCqep']) {
  if (source.includes(forbidden)) throw new Error(`Visible legacy brand remains: ${forbidden}`)
}

await writeFile(appPath, source)

for (const path of [
  'app/renderer/components/FlameMark.tsx',
  'app/renderer/assets/flame.png',
  'dash/public/codeburn-logo.png',
]) {
  if (existsSync(path)) await rm(path)
}

await import('./generate-brand-assets.mjs')
console.log('Applied one-time Metrora brand source migration')
