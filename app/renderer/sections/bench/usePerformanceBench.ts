import { useCallback, useEffect, useState } from 'react'

import type { PerformanceComparisonV1 } from '../../../../src/bench/performance-compare-v1'
import type { PerformanceRunV1 } from '../../../../src/bench/performance-contract-v1'
import { metrora, normalizeCliError } from '../../lib/ipc'
import type { PerformanceBenchRequest, PerformanceHistoryReport } from '../../lib/metrora-bridge-types'

export type PerformanceBenchController = {
  history: PerformanceRunV1[]
  invalidCount: number
  loading: boolean
  running: boolean
  executablePath: string
  modelPath: string
  error: string | null
  leftRunId: string
  rightRunId: string
  comparison: PerformanceComparisonV1 | null
  comparisonLoading: boolean
  setExecutablePath: (value: string) => void
  setModelPath: (value: string) => void
  setError: (value: string | null) => void
  setLeftRunId: (value: string) => void
  setRightRunId: (value: string) => void
  chooseFile: (kind: 'llama-bench' | 'gguf') => void
  run: () => void
  cancel: () => void
}

export function usePerformanceBench(): PerformanceBenchController {
  const [history, setHistory] = useState<PerformanceRunV1[]>([])
  const [invalidCount, setInvalidCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [executablePath, setExecutablePath] = useState('')
  const [modelPath, setModelPath] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [leftRunId, setLeftRunId] = useState('')
  const [rightRunId, setRightRunId] = useState('')
  const [comparison, setComparison] = useState<PerformanceComparisonV1 | null>(null)
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const reader = metrora.getPerformanceBenchHistory
    if (typeof reader !== 'function') {
      setLoading(false)
      return
    }
    void reader()
      .then((report: PerformanceHistoryReport) => {
        if (!active) return
        setHistory(report.records)
        setInvalidCount(report.invalidCount)
        setLeftRunId(current =>
          current && report.records.some(record => record.runId === current)
            ? current
            : (report.records[1]?.runId ?? report.records[0]?.runId ?? ''),
        )
        setRightRunId(current =>
          current && report.records.some(record => record.runId === current)
            ? current
            : (report.records[0]?.runId ?? ''),
        )
      })
      .catch(cause => {
        if (active) setError(normalizeCliError(cause).message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!leftRunId || !rightRunId || leftRunId === rightRunId) {
      setComparison(null)
      setComparisonLoading(false)
      return
    }
    const reader = metrora.getPerformanceBenchComparison
    if (typeof reader !== 'function') {
      setComparison(null)
      setComparisonLoading(false)
      return
    }
    let active = true
    setComparison(null)
    setComparisonLoading(true)
    void reader(leftRunId, rightRunId)
      .then(value => {
        if (active) setComparison(value)
      })
      .catch(cause => {
        if (active) setError(normalizeCliError(cause).message)
      })
      .finally(() => {
        if (active) setComparisonLoading(false)
      })
    return () => {
      active = false
    }
  }, [leftRunId, rightRunId])

  const chooseFile = useCallback(
    async (kind: 'llama-bench' | 'gguf') => {
      if (typeof metrora.chooseFile !== 'function') {
        setError('This desktop build does not expose the native file picker.')
        return
      }
      try {
        const selected = await metrora.chooseFile(kind)
        if (selected) {
          if (kind === 'llama-bench') setExecutablePath(selected)
          else setModelPath(selected)
          setError(null)
        }
      } catch (cause) {
        setError(normalizeCliError(cause).message)
      }
    },
    [],
  )

  const run = useCallback(async () => {
    if (!executablePath || !modelPath) {
      setError('Choose an existing llama-bench executable and .gguf model first.')
      return
    }
    if (typeof metrora.runPerformanceBench !== 'function') {
      setError('This desktop build does not expose native Performance Bench.')
      return
    }
    const id = `performance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    setRequestId(id)
    setRunning(true)
    setError(null)
    const request: PerformanceBenchRequest = {
      executablePath,
      modelPath,
      repetitions: 3,
      promptTokens: 512,
      generationTokens: 128,
      batchSize: 2048,
      ubatchSize: 512,
      threads: null,
      gpuLayers: -1,
      flashAttention: 'auto',
      splitMode: 'none',
      mainGpu: null,
      warmup: true,
      timeoutMs: 10 * 60_000,
    }
    try {
      const record = await metrora.runPerformanceBench(id, request)
      setHistory(current => [record, ...current.filter(item => item.runId !== record.runId)].slice(0, 50))
      setLeftRunId(current => current || record.runId)
      setRightRunId(record.runId)
    } catch (cause) {
      if (!/cancel|abort/i.test(normalizeCliError(cause).message)) setError(normalizeCliError(cause).message)
    } finally {
      setRequestId(current => (current === id ? null : current))
      setRunning(false)
    }
  }, [executablePath, modelPath])

  const cancel = useCallback(async () => {
    if (!requestId || typeof metrora.cancelPerformanceBench !== 'function') return
    try {
      await metrora.cancelPerformanceBench(requestId)
    } catch {
      /* terminal UI state remains cancelled */
    }
  }, [requestId])

  return {
    history,
    invalidCount,
    loading,
    running,
    executablePath,
    modelPath,
    error,
    leftRunId,
    rightRunId,
    comparison,
    comparisonLoading,
    setExecutablePath,
    setModelPath,
    setError,
    setLeftRunId,
    setRightRunId,
    chooseFile: (kind: 'llama-bench' | 'gguf') => void chooseFile(kind),
    run: () => void run(),
    cancel: () => void cancel(),
  }
}
