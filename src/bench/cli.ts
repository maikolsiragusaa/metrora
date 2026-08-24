import { resolve } from 'node:path'
import { Command } from 'commander'
import { atomicWritePrivateFile } from '../local-state/atomic-file.js'
import { BENCH_RUNNER_ID, type BenchRunV1, type NumericSummaryV1 } from './contract-v1.js'
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

export function registerBenchCommands(program: Command): void {
  const bench = program
    .command('bench')
    .description('Run bounded synthetic local runtime evidence; no quality, ranking, or cost scoring')

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
}
