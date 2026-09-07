import { useState } from 'react'

import { OpenCodeHost } from '../components/OpenCodeHost'
import { metrora } from '../lib/ipc'

const IMPORT_CONFIRMATION_KEY = 'metrora.opencode-session-import.confirmed.v1'

function hasImportConfirmation(): boolean {
  try { return window.localStorage.getItem(IMPORT_CONFIRMATION_KEY) === '1' } catch { return false }
}

function confirmImport(): boolean {
  if (hasImportConfirmation()) return true
  if (!window.confirm('Import new OpenCode sessions into Metrora’s private OpenCode store? Existing Metrora sessions will be left unchanged.')) return false
  try { window.localStorage.setItem(IMPORT_CONFIRMATION_KEY, '1') } catch { /* confirmation can remain in-memory for this action */ }
  return true
}

function resultMessage(result: Awaited<ReturnType<typeof metrora.importOpenCodeSessions>>): string {
  if (result.newSessions === 0 && result.imported === 0 && result.skipped === 0 && result.failed === 0) {
    if (result.reason === 'standalone-not-found') return 'Standalone OpenCode export runtime was not found.'
    if (result.reason === 'export-unavailable') return 'Standalone OpenCode export is unavailable.'
    if (result.reason === 'incompatible-export') return 'OpenCode export format was not compatible.'
    if (result.reason === 'import-failed') return 'OpenCode sessions could not be imported.'
    if (result.reason === 'cancelled') return 'OpenCode import was cancelled.'
  }
  if (result.imported === 0 && result.newSessions === 0) return 'No new OpenCode sessions found.'

  const imported = `${result.imported} new session${result.imported === 1 ? '' : 's'}`
  const present = `${result.alreadyPresent} already present`
  const skipped = result.skipped > 0 ? `, ${result.skipped} skipped` : ''
  const failed = result.failed > 0 ? `, ${result.failed} failed` : ''
  return `OpenCode import: ${imported}; ${present}${skipped}${failed}.`
}

/** Code keeps the execution surface in the upstream OpenCode WebContentsView host. */
export function Code() {
  const [restartToken, setRestartToken] = useState(0)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)

  const importSessions = async () => {
    if (importing || !confirmImport()) return
    setImporting(true)
    setImportMessage(null)
    try {
      const result = await metrora.importOpenCodeSessions()
      setImportMessage(resultMessage(result))
      if (result.newSessions > 0) setRestartToken(value => value + 1)
    } catch {
      setImportMessage('OpenCode session import is unavailable.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="code-section" aria-label="Code">
      <div className="code-section__header">
        <div><span className="eyebrow">Code</span><strong>OpenCode workspace</strong></div>
        <div className="code-section__tools">
          {importMessage ? <span className="code-import-status" role="status" aria-live="polite">{importMessage}</span> : null}
          <button className="code-import-button" type="button" onClick={() => { void importSessions() }} disabled={importing}>
            {importing ? 'Importing…' : 'Import new OpenCode sessions'}
          </button>
          <span>Powered by upstream OpenCode</span>
        </div>
      </div>
      <OpenCodeHost restartToken={restartToken} />
    </section>
  )
}
