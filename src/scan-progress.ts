export const PROGRESS_LINE_PREFIX = 'METRORA_PROGRESS '

export type ScanProgressEvent =
  | { kind: 'providers'; providers: string[]; cold?: boolean }
  | { kind: 'provider'; provider: string; state: 'start' | 'done' | 'skipped'; files?: number }
  | { kind: 'tick'; provider: string; done: number; total: number }
  | { kind: 'stage'; stage: string; done?: number; total?: number }

export function emitScanProgress(event: ScanProgressEvent): void {
  if (process.env['METRORA_PROGRESS'] !== '1') return
  try { process.stderr.write(`${PROGRESS_LINE_PREFIX}${JSON.stringify(event)}\n`) } catch { /* stderr closed */ }
}

export function createStageProgress(stage: string, total: number): () => void {
  let done = 0
  if (total > 0) emitScanProgress({ kind: 'stage', stage, done: 0, total })
  return () => {
    done += 1
    emitScanProgress({ kind: 'stage', stage, done, total })
  }
}
