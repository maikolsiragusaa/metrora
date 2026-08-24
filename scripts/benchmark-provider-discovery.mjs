import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { discoverAllSessionsWithOutcomes, discoverProviderWithOutcome } from '../src/providers/index.ts'
import { ProviderDiscoveryPartialError } from '../src/providers/discovery-outcome.ts'

const REAL_IO_ITERATIONS = 5
const REAL_IO_SCALES = [
  { name: 'small', providers: 4, sessionsPerProvider: 24 },
  { name: 'medium', providers: 8, sessionsPerProvider: 64 },
  { name: 'large', providers: 12, sessionsPerProvider: 128 },
]
const FIXTURE_PROVIDER_PREFIX = 'fixture-discovery-'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const round = value => Number(value.toFixed(1))
const source = (name, filePath, project) => ({ provider: name, path: filePath, project })

function timerProvider(name, delayMs, behavior = 'success') {
  return {
    name,
    displayName: name,
    modelDisplayName: value => value,
    toolDisplayName: value => value,
    discoverSessions: async () => {
      await pause(delayMs)
      if (behavior === 'failure') throw new Error('synthetic failure')
      if (behavior === 'partial') throw new ProviderDiscoveryPartialError([source(name, '/' + name + '.jsonl', name + '-project')])
      return [source(name, '/' + name + '.jsonl', name + '-project')]
    },
  }
}

async function sequential(providers) {
  const outcomes = []
  for (const item of providers) outcomes.push(await discoverProviderWithOutcome(item))
  return outcomes
}

async function boundedLocal(providers, concurrency) {
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
  const value = await operation()
  return { ms: performance.now() - started, value }
}

function outcomeSignature(outcomes) {
  return outcomes.map(item => item.provider + ':' + item.status + ':' + item.sources.map(sourceValue => sourceValue.path + '|' + sourceValue.project).sort().join(',')).join('|')
}

function ordered(providers) {
  return [...providers].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}

function makeFileProvider(name, providerRoot, sessionsPerProvider) {
  return {
    name,
    displayName: name,
    modelDisplayName: value => value,
    toolDisplayName: value => value,
    discoverSessions: async () => {
      const entries = await readdir(providerRoot, { withFileTypes: true })
      const sessionDirectory = entries.find(entry => entry.isDirectory() && entry.name === 'sessions')
      if (!sessionDirectory) return []

      for (const entry of entries.filter(item => item.isFile() && (item.name === 'sessions.db' || item.name === 'sessions.db-wal'))) {
        const metadataPath = join(providerRoot, entry.name)
        const metadata = await stat(metadataPath)
        if (!metadata.isFile()) throw new Error('fixture metadata is not a file')
        await readFile(metadataPath)
      }

      const sessionRoot = join(providerRoot, sessionDirectory.name)
      const sessionEntries = (await readdir(sessionRoot, { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
        .sort((left, right) => left.name.localeCompare(right.name))
      const sources = []
      for (const entry of sessionEntries) {
        const filePath = join(sessionRoot, entry.name)
        const metadata = await stat(filePath)
        if (!metadata.isFile()) continue
        const content = await readFile(filePath, 'utf8')
        const record = JSON.parse(content)
        if (record.provider !== name || record.sessionIndex < 0 || record.sessionIndex >= sessionsPerProvider) continue
        sources.push(source(name, filePath, record.project))
      }
      return sources
    },
  }
}

async function createRealFixture(scale, iteration) {
  const root = await mkdtemp(join(tmpdir(), 'metrora-provider-discovery-'))
  const providers = []
  try {
    await Promise.all(Array.from({ length: scale.providers }, async (_, index) => {
      const name = FIXTURE_PROVIDER_PREFIX + scale.name + '-' + index
      const providerRoot = join(root, name)
      const sessionRoot = join(providerRoot, 'sessions')
      await mkdir(sessionRoot, { recursive: true })
      await writeFile(join(providerRoot, 'sessions.db'), JSON.stringify({ format: 'sqlite-fixture', provider: name, iteration, rows: scale.sessionsPerProvider }), 'utf8')
      await writeFile(join(providerRoot, 'sessions.db-wal'), JSON.stringify({ format: 'sqlite-wal-fixture', provider: name, frames: scale.sessionsPerProvider }), 'utf8')
      await Promise.all(Array.from({ length: scale.sessionsPerProvider }, (_, sessionIndex) => {
        const record = {
          provider: name,
          project: name + '-project-' + (sessionIndex % 4),
          sessionIndex,
          usage: { inputTokens: 100 + sessionIndex, outputTokens: 40 + (sessionIndex % 7) },
        }
        return writeFile(join(sessionRoot, 'session-' + String(sessionIndex).padStart(4, '0') + '.jsonl'), JSON.stringify(record) + '\n', 'utf8')
      }))
      providers.push(makeFileProvider(name, providerRoot, scale.sessionsPerProvider))
    }))
    return { root, providers }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

async function measureRealIoScale(scale) {
  const measurements = []
  for (let iteration = 0; iteration < REAL_IO_ITERATIONS; iteration += 1) {
    const fixture = await createRealFixture(scale, iteration)
    try {
      const providers = ordered(fixture.providers)
      const firstBounded = iteration % 2 === 1
      const first = firstBounded
        ? await timed(() => discoverAllSessionsWithOutcomes('all', providers))
        : await timed(() => sequential(providers))
      const second = firstBounded
        ? await timed(() => sequential(providers))
        : await timed(() => discoverAllSessionsWithOutcomes('all', providers))
      const serial = firstBounded ? second : first
      const bounded2 = firstBounded ? first : second
      const serialOutcomes = serial.value.outcomes ?? serial.value
      const boundedOutcomes = bounded2.value.outcomes
      measurements.push({
        iteration: iteration + 1,
        first: firstBounded ? 'bound-2' : 'sequential',
        sequentialMs: round(serial.ms),
        bounded2Ms: round(bounded2.ms),
        correctness: outcomeSignature(serialOutcomes) === outcomeSignature(boundedOutcomes),
        sourceCount: bounded2.value.sources.length,
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  }
  const sequentialMedianMs = round(median(measurements.map(item => item.sequentialMs)))
  const bounded2MedianMs = round(median(measurements.map(item => item.bounded2Ms)))
  const improvementPercent = round((1 - bounded2MedianMs / sequentialMedianMs) * 100)
  return {
    scale: scale.name,
    providers: scale.providers,
    sessionsPerProvider: scale.sessionsPerProvider,
    iterations: REAL_IO_ITERATIONS,
    measurements,
    sequentialMedianMs,
    bounded2MedianMs,
    improvementPercent,
    meaningfulGain: bounded2MedianMs < sequentialMedianMs * 0.9,
    correctness: measurements.every(item => item.correctness),
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

async function runTimerSanity() {
  const cases = [
    ['small', 2, 8],
    ['medium', 8, 12],
    ['large', 16, 12],
    ['failure', 8, 12, 2, 'failure'],
    ['partial', 8, 12, 3, 'partial'],
  ]
  const measurements = []
  for (const [name, count, delayMs, specialIndex, behavior] of cases) {
    const serial = await timed(() => sequential(Array.from({ length: count }, (_, index) => timerProvider('timer-' + name + '-' + index, delayMs, index === specialIndex ? behavior : 'success'))))
    const bounded2 = await timed(() => discoverAllSessionsWithOutcomes('all', Array.from({ length: count }, (_, index) => timerProvider('timer-' + name + '-' + index, delayMs, index === specialIndex ? behavior : 'success'))))
    const candidate4 = await timed(() => boundedLocal(Array.from({ length: count }, (_, index) => timerProvider('timer-' + name + '-' + index, delayMs, index === specialIndex ? behavior : 'success')), 4))
    measurements.push({ name, providers: count, sequentialMs: round(serial.ms), bounded2Ms: round(bounded2.ms), candidate4Ms: round(candidate4.ms) })
  }
  return { purpose: 'scheduler sanity only; not production authorization evidence', measurements }
}

async function runCancellationCheck() {
  const started = []
  let releaseGate
  const gate = new Promise(resolve => { releaseGate = resolve })
  const controller = new AbortController()
  const providers = Array.from({ length: 6 }, (_, index) => ({
    ...timerProvider('cancel-' + index, 0),
    discoverSessions: async () => {
      started.push(index)
      await gate
      return [source('cancel-' + index, '/cancel-' + index + '.jsonl', 'cancel-project')]
    },
  }))
  const pending = discoverAllSessionsWithOutcomes('all', providers, controller.signal)
  while (started.length < 2) await pause(1)
  controller.abort()
  const result = await pending
  releaseGate()
  return { started, statuses: result.outcomes.map(item => item.status), noAdditionalProvidersLaunched: started.length === 2 }
}

const realIo = []
for (const scale of REAL_IO_SCALES) realIo.push(await measureRealIoScale(scale))
const meaningfulScales = realIo.filter(item => item.meaningfulGain).length
const correctness = realIo.every(item => item.correctness)
const retainProductionBound2 = correctness && meaningfulScales >= 2
const decision = retainProductionBound2
  ? 'RETAIN_PRODUCTION_CONCURRENCY_2'
  : 'NO_PRODUCTION_CHANGE_INSUFFICIENT_REAL_IO_GAIN'

console.log(JSON.stringify({
  benchmark: 'provider-discovery-real-io-v1',
  methodology: {
    physicalCorpus: 'temporary directories with readdir, stat, SQLite/WAL-style metadata reads, and JSONL session file reads',
    comparison: 'sequential versus the production bound of two on the same corpus per iteration',
    iterations: REAL_IO_ITERATIONS,
    scales: REAL_IO_SCALES,
    meaningfulGainRule: 'at least 10% median improvement on at least two of three scales with matching outcomes',
  },
  decision,
  realIo,
  timerSanity: await runTimerSanity(),
  cancellation: await runCancellationCheck(),
}, null, 2))
