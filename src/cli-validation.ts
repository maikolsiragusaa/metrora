import { allProviderNames } from './providers/index.js'

export function assertFormat(value: string, allowed: readonly string[], command: string): void {
  if (allowed.includes(value)) return
  process.stderr.write(
    `metrora ${command}: unknown format "${value}". Valid values: ${allowed.join(', ')}.\n`
  )
  process.exit(1)
}

export function assertProvider(value: string, command: string): void {
  const names = allProviderNames()
  if (value === 'all' || names.includes(value)) return
  process.stderr.write(
    `metrora ${command}: unknown provider "${value}". Valid values: all, ${names.join(', ')}.\n`
  )
  process.exit(1)
}

export function assertScope(value: string, allowed: readonly string[], command: string): void {
  if (allowed.includes(value)) return
  process.stderr.write(
    `metrora ${command}: unknown scope "${value}". Valid values: ${allowed.join(', ')}.\n`
  )
  process.exit(1)
}
