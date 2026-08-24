import { performance } from 'node:perf_hooks'

import { discoverAllSessionsWithOutcomes, discoverProviderWithOutcome } from '../src/providers/index.ts'
import { ProviderDiscoveryPartialError } from '../src/providers/discovery-outcome.ts'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const source = name => ({ provider: name, path: '/' + name + '.jsonl', project: name + '-project' })
const provider = (name, delayMs, behavior = 'success') => ({
  name,
  displayName: name,
  modelDisplayName: value => value,
  toolDisplayName: value => value,
  discoverSessions: async () => {
    await pause(delayMs)
    if (behavior === 'failure') throw new Error('synthetic failure')
    if (behavior === 'partial') throw new ProviderDiscoveryPartialError([source(name)])
    return [source(name)]
  },
})

async function sequential(providers) {
  const outcomes = []
  for (const item of providers) outcomes.push(await discoverProviderWithOutcome(item))
  return outcomes
}

async function bounded(providers, concurrency) {
  const outcomes = new Array(providers.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      const index = cursor++
      if (index >= providers.length) return
      outcomes[index] = await discoverProviderWithOutcome(providers[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, providers.length) }, worker))
  return outcomes
}

async function timed(operation) {
  const started = performance.now()
  const outcomes = await operation()
  return { ms: Number((performance.now() - started).toFixed(1)), outcomes }
}

const cases = [
  ['small', 2, 8],
  ['medium', 8, 12],
  ['large', 16, 12],
  ['failure', 8, 12, 2, 'failure'],
  ['partial', 8, 12, 3, 'partial'],
]
const measurements = []
for (const [name, count, delayMs, specialIndex, behavior] of cases) {
  const make = () => Array.from({ length: count }, (_, index) => provider('synthetic-' + index, delayMs, index === specialIndex ? behavior : 'success'))
  const serial = await timed(() => sequential(make()))
  const bounded2 = await timed(() => discoverAllSessionsWithOutcomes('all', make()))
  const candidate4 = await timed(() => bounded(make(), 4))
  measurements.push({
    name,
    providers: count,
    sequentialMs: serial.ms,
    bounded2Ms: bounded2.ms,
    candidate4Ms: candidate4.ms,
    bounded2Statuses: bounded2.outcomes.outcomes.map(item => item.status),
    candidate4Statuses: candidate4.outcomes.map(item => item.status),
  })
}

const started = []
let releaseGate
const gate = new Promise(resolve => { releaseGate = resolve })
const controller = new AbortController()
const cancellationProviders = Array.from({ length: 6 }, (_, index) => ({
  ...provider('cancel-' + index, 0),
  discoverSessions: async () => { started.push(index); await gate; return [source('cancel-' + index)] },
}))
const cancellation = discoverAllSessionsWithOutcomes('all', cancellationProviders, controller.signal)
while (started.length < 2) await pause(1)
controller.abort()
const cancellationResult = await cancellation
releaseGate()

console.log(JSON.stringify({ measurements, cancellation: { started, statuses: cancellationResult.outcomes.map(item => item.status) } }, null, 2))
