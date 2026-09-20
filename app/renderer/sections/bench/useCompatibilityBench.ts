import { useCallback, useEffect, useState } from 'react'

import { metrora, normalizeCliError } from '../../lib/ipc'
import type { BenchComparison, BenchEvaluation, BenchModelDiscovery } from '../../lib/metrora-bridge-types'

export type CompatibilityBenchController = {
  history: BenchEvaluation[]
  invalidCount: number
  loading: boolean
  running: boolean
  model: string
  manualEntry: boolean
  discovery: BenchModelDiscovery | null
  discoveryLoading: boolean
  discoveryFailed: boolean
  error: string | null
  leftRunId: string
  rightRunId: string
  comparison: BenchComparison | null
  comparisonLoading: boolean
  setModel: (value: string) => void
  setManualEntry: (value: boolean) => void
  setError: (value: string | null) => void
  setLeftRunId: (value: string) => void
  setRightRunId: (value: string) => void
  refreshDiscovery: () => void
  run: () => void
}

export function useCompatibilityBench(): CompatibilityBenchController {
  const [history, setHistory] = useState<BenchEvaluation[]>([])
  const [invalidCount, setInvalidCount] = useState(0)
  const [model, setModel] = useState('')
  const [manualEntry, setManualEntry] = useState(false)
  const [discovery, setDiscovery] = useState<BenchModelDiscovery | null>(null)
  const [discoveryLoading, setDiscoveryLoading] = useState(true)
  const [discoveryFailed, setDiscoveryFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leftRunId, setLeftRunId] = useState('')
  const [rightRunId, setRightRunId] = useState('')
  const [comparison, setComparison] = useState<BenchComparison | null>(null)
  const [comparisonLoading, setComparisonLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    try {
      const report = await metrora.getBenchHistory()
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
      setError(null)
    } catch (cause) {
      setError(normalizeCliError(cause).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDiscovery = useCallback(async () => {
    setDiscoveryLoading(true)
    try {
      if (typeof metrora.getBenchModelDiscovery !== 'function') throw new Error('model discovery bridge unavailable')
      const report = await metrora.getBenchModelDiscovery()
      setDiscovery(report)
      setDiscoveryFailed(false)
      setModel(current =>
        report.status === 'models-discovered' && !current.trim() ? (report.models[0] ?? '') : current,
      )
    } catch {
      setDiscovery(null)
      setDiscoveryFailed(true)
    } finally {
      setDiscoveryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
    void loadDiscovery()
  }, [loadHistory, loadDiscovery])

  const run = useCallback(async () => {
    const selected = model.trim()
    if (!selected) {
      setError('Select or enter a local Ollama model first.')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const record = await metrora.runBenchTaskPack(selected, 'core-v1')
      setHistory(current => [record, ...current.filter(item => item.runId !== record.runId)].slice(0, 50))
      setLeftRunId(current => current || record.runId)
      setRightRunId(record.runId)
    } catch (cause) {
      setError(normalizeCliError(cause).message)
    } finally {
      setRunning(false)
    }
  }, [model])

  useEffect(() => {
    if (!leftRunId || !rightRunId || leftRunId === rightRunId) {
      setComparison(null)
      setComparisonLoading(false)
      return
    }
    let active = true
    setComparison(null)
    setComparisonLoading(true)
    void metrora
      .getBenchComparison(leftRunId, rightRunId)
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

  return {
    history,
    invalidCount,
    loading,
    running,
    model,
    manualEntry,
    discovery,
    discoveryLoading,
    discoveryFailed,
    error,
    leftRunId,
    rightRunId,
    comparison,
    comparisonLoading,
    setModel,
    setManualEntry,
    setError,
    setLeftRunId,
    setRightRunId,
    refreshDiscovery: () => void loadDiscovery(),
    run: () => void run(),
  }
}
