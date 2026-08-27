import { resolve } from 'node:path'
import { Command } from 'commander'
import { atomicWritePrivateFile } from '../local-state/atomic-file.js'
import { BENCH_RUNNER_ID, type BenchRunV1, type NumericSummaryV1 } from './contract-v1.js'
import { compareBenchEvaluationsV1 } from './compare-v1.js'
import { saveBenchEvaluationV1, scanBenchHistoryV1 } from './history-v1.js'
import { discoverBenchModelsV1, type BenchModelDiscoveryV1 } from './model-discovery-v1.js'
import { runBenchTaskPackV1, type BenchEvaluationV1 } from './task-pack-run-v1.js'
import { runBenchRunV1, validateBenchTimeoutMs } from './run-v1.js'

function parseTimeout(value: string): number {
  const parsed = Number(value)
  return validateBenchTimeoutMs(parsed)
}

function formatSummary(summary: NumericSummaryV1 | null, unit: string): string {
  if (!summary) return 'unavailable'
  const median = Number.isInteger(summary.median) ? String(summary.median) : summary.median.toFixed(2)
  return `${median} ${unit} median (n=${summary.count})`
}

export function renderBenchRunV1(result: BenchRunV1): string {
  const measured = result.aggregate.measured
  const lines = [
    `BenchRunV1 ${result.status}`,
    `  runner: ${result.runner.id}@${result.runner.version}`,
    `  model: ${result.model.selected}${result.model.reported ? ` (reported ${result.model.reported})` : ''}`,
    `  fixture: ${result.fixture.packId}@${result.fixture.version} (${result.fixture.digest.slice(0, 12)})`,
    `  runs: ${result.generation.warmupCount} warmup + ${result.generation.measuredRunCount} measured; ${measured.successful}/${measured.planned} measured successful`,
    `  request latency: ${formatSummary(measured.observed.requestLatencyMs, 'ms')}`,
    `  first content: ${formatSummary(measured.observed.timeToFirstContentMs, 'ms')}`,
    `  output chars: ${formatSummary(measured.observed.outputChars, 'chars')}`,
    `  eval tokens (runtime-reported): ${formatSummary(measured.runtimeReported.evalCount, 'tokens')}`,
    `  Ollama version: ${result.runtime.version ?? 'unavailable'}`,
    `  result digest: ${result.resultDigest}`,
  ]
  if (result.termination.status !== 'none') {
    lines.push(`  termination: ${result.termination.status}`)
  }
  if (result.failures.length > 0) {
    lines.push(`  failure: ${result.failures[0]!.message}`)
  }
  if (result.exclusions.length > 0) {
    lines.push(`  exclusions: ${result.exclusions.length} planned run(s) not started`)
  }
  return lines.join('\n') + '\n'
}

function parseHistoryLimit(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) throw new Error('limit must be an integer from 1 to 50')
  return parsed
}

function renderBenchEvaluation(result: BenchEvaluationV1): string {
  const score = result.aggregate.score.value === null ? 'unavailable (no checks scored)' : (result.aggregate.score.value * 100).toFixed(0) + '% of ' + result.aggregate.score.denominator + ' scored checks'
  return [
    'Core conformance ' + result.status,
    '  runner: ' + result.runner.id + '@' + result.runner.version,
    '  model: ' + result.model.selected,
    '  pack: ' + result.pack.packId + '@' + result.pack.version,
    '  checks: ' + result.aggregate.passed + '/' + result.aggregate.planned + ' passed; ' + result.aggregate.failed + ' failed; ' + result.aggregate.unavailable + ' unavailable; ' + result.aggregate.cancelled + ' cancelled',
    '  scored result: ' + score,
    '  runtime: ' + (result.runtime.version ?? 'unavailable'),
    '  result digest: ' + result.resultDigest,
  ].join('\n') + '\n'
}

export function renderBenchHistory(records: BenchEvaluationV1[]): string {
  if (records.length === 0) return 'No Core conformance history.\n'
  return records.map(record => {
    const checks = record.aggregate.score.value === null
      ? record.aggregate.planned + ' planned; no checks scored; ' + record.aggregate.unavailable + ' unavailable; ' + record.aggregate.cancelled + ' cancelled'
      : record.aggregate.passed + ' passed; ' + record.aggregate.failed + ' failed; ' + record.aggregate.unavailable + ' unavailable; ' + record.aggregate.cancelled + ' cancelled; ' + record.aggregate.planned + ' planned; ' + (record.aggregate.score.value * 100).toFixed(0) + '% of ' + record.aggregate.score.denominator + ' scored checks'
    return record.runId + '  ' + record.model.selected + '  Core conformance ' + record.status + '  ' + checks + '  ' + record.endedAt
  }).join('\n') + '\n'
}

function renderBenchModelDiscovery(result: BenchModelDiscoveryV1): string {
  return [
    'Bench local model discovery ' + result.status,
    '  runtime: ' + result.runtime.id,
    '  models: ' + (result.models.length ? result.models.join(', ') : 'none discovered'),
    '  detail: ' + result.detail,
  ].join('\n') + '\n'
}

export function registerBenchCommands(program: Command): void {
  const bench = program
    .command('bench')
    .description('Run bounded synthetic local runtime evidence; no quality, ranking, or cost scoring')

  bench
    .command('models')
    .description('Discover local Ollama models that the Bench runner can execute')
    .option('--format <format>', 'Output format: table, json', 'table')
    .action(async (options: { format: string }) => {
      const format = options.format.toLowerCase()
      if (format !== 'table' && format !== 'json') {
        process.stderr.write('metrora bench models: --format must be table or json.\n')
        process.exitCode = 2
        return
      }
      try {
        const result = await discoverBenchModelsV1()
        if (format === 'json') process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        else process.stdout.write(renderBenchModelDiscovery(result))
      } catch (error) {
        process.stderr.write('metrora bench models: ' + (error instanceof Error ? error.message : String(error)) + '\n')
        process.exitCode = 2
      }
    })

  bench
    .command('local')
    .description('Run BenchRunV1 against a local Ollama model')
    .requiredOption('--model <model>', 'Explicit local Ollama model name')
    .option('--format <format>', 'Output format: table, json', 'table')
    .option('--output <path>', 'Write the JSON evidence artifact to this local path')
    .option('--timeout-ms <ms>', 'Bound each local request (50-120000 ms)', parseTimeout, 30_000)
    .action(async (options: { model: string; format: string; output?: string; timeoutMs: number }) => {
      const format = options.format.toLowerCase()
      if (format !== 'table' && format !== 'json') {
        process.stderr.write('metrora bench local: --format must be table or json.\n')
        process.exitCode = 2
        return
      }

      const controller = new AbortController()
      const onSigint = () => controller.abort()
      process.once('SIGINT', onSigint)
      let result: BenchRunV1
      try {
        result = await runBenchRunV1({
          model: options.model,
          signal: controller.signal,
          timeoutMs: options.timeoutMs,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`metrora bench local: ${message}\n`)
        process.exitCode = 2
        return
      } finally {
        process.removeListener('SIGINT', onSigint)
      }

      let outputPath: string | undefined
      if (options.output) {
        outputPath = resolve(options.output)
        try {
          await atomicWritePrivateFile(outputPath, JSON.stringify(result, null, 2) + '\n')
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          process.stderr.write(`metrora bench local: could not write evidence artifact: ${message}\n`)
          process.exitCode = 1
        }
      }

      if (format === 'json') process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      else process.stdout.write(renderBenchRunV1(result))
      if (outputPath) process.stderr.write(`BenchRunV1 evidence artifact: ${outputPath}\n`)
      if (result.status !== 'completed') process.exitCode = 1
    })

  bench
    .command('task-pack')
    .description('Run the deterministic local task pack; no ranking, cost, or general quality claim')
    .requiredOption('--model <model>', 'Explicit local Ollama model name')
    .option('--pack <pack>', 'Task pack: core-v1', 'core-v1')
    .option('--format <format>', 'Output format: table, json', 'table')
    .option('--no-save', 'Do not persist the bounded result in local Bench history')
    .option('--run-id <id>', 'Stable run id for automation and desktop calls')
    .option('--timeout-ms <ms>', 'Bound each local request (50-120000 ms)', parseTimeout, 30_000)
    .action(async (options: { model: string; pack: string; format: string; save: boolean; runId?: string; timeoutMs: number }) => {
      const format = options.format.toLowerCase()
      if (format !== 'table' && format !== 'json') { process.stderr.write('metrora bench task-pack: --format must be table or json.\n'); process.exitCode = 2; return }
      const controller = new AbortController()
      const onSigint = () => controller.abort()
      process.once('SIGINT', onSigint)
      let result: BenchEvaluationV1
      try {
        result = await runBenchTaskPackV1({ model: options.model, packId: options.pack, signal: controller.signal, timeoutMs: options.timeoutMs, runId: options.runId })
        if (options.save) await saveBenchEvaluationV1(result)
      } catch (error) {
        process.stderr.write('metrora bench task-pack: ' + (error instanceof Error ? error.message : String(error)) + '\n')
        process.exitCode = 2
        return
      } finally { process.removeListener('SIGINT', onSigint) }
      if (format === 'json') process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      else process.stdout.write(renderBenchEvaluation(result))
      if (result.status !== 'completed') process.exitCode = 1
    })

  bench
    .command('history')
    .description('Read bounded local Bench task-pack history')
    .option('--format <format>', 'Output format: table, json', 'table')
    .option('--limit <n>', 'Maximum records to return (1-50)', parseHistoryLimit, 20)
    .action(async (options: { format: string; limit: number }) => {
      try {
        const scan = await scanBenchHistoryV1()
        const records = scan.records.slice(0, options.limit)
        if (options.format.toLowerCase() === 'json') process.stdout.write(JSON.stringify({ schemaVersion: 'metrora.bench-history-report.v1', records, invalidCount: scan.invalid.length }, null, 2) + '\n')
        else process.stdout.write(renderBenchHistory(records))
      } catch (error) { process.stderr.write('metrora bench history: ' + (error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 1 }
    })

  bench
    .command('compare')
    .description('Compare two compatible local Bench task-pack results')
    .argument('<leftRunId>', 'Earlier or reference run id')
    .argument('<rightRunId>', 'Later or comparison run id')
    .option('--format <format>', 'Output format: json, table', 'table')
    .action(async (leftRunId: string, rightRunId: string, options: { format: string }) => {
      try {
        const scan = await scanBenchHistoryV1()
        const left = scan.records.find(record => record.runId === leftRunId)
        const right = scan.records.find(record => record.runId === rightRunId)
        if (!left || !right) throw new Error('both run ids must exist in local Bench history')
        const comparison = compareBenchEvaluationsV1(left, right)
        if (options.format.toLowerCase() === 'json') process.stdout.write(JSON.stringify(comparison, null, 2) + '\n')
        else process.stdout.write(comparison.compatible ? 'Bench comparison compatible\n  score delta: ' + (comparison.deltas?.score === null ? 'unavailable' : comparison.deltas?.score.toFixed(3)) + '\n  passed delta: ' + comparison.deltas?.passed + '\n' : 'Bench comparison incompatible: ' + comparison.reason + '\n')
        if (!comparison.compatible) process.exitCode = 1
      } catch (error) { process.stderr.write('metrora bench compare: ' + (error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 2 }
    })
}
