import { useState } from 'react'

import { quotaProviderConnect } from '../lib/quota-providers'
import type { QuotaProvider } from '../lib/types'

/** Inline "Connect" affordance for a disconnected or access-denied provider.
 * Metrora never performs provider login here: it gives bounded provider-owned
 * guidance and lets the user explicitly refresh after signing in. */
export function ConnectAffordance({ provider, connection, onRefresh }: {
  provider: QuotaProvider['provider']
  connection: 'disconnected' | 'accessDenied'
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const login = quotaProviderConnect(provider)
  const message = connection === 'accessDenied'
    ? 'Credential access is needed. Grant access in the provider or operating-system prompt, then Refresh.'
    : login.connectMessage

  return (
    <div className="quota-connect">
      <span className="quota-connection-note">{message}</span>
      <button type="button" className="set-text-button quota-connect-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>Connect</button>
      {open && (
        <div className="quota-connect-guide">
          <p className="quota-connection-note">Use the provider's own sign-in flow, then Refresh:</p>
          {login.command ? (
            <p className="quota-connect-cmd"><code className="set-mono">{login.command}</code>{login.commandHint ? <span className="quota-connect-cmd-hint"> {login.commandHint}</span> : null}</p>
          ) : (
            <p className="quota-connection-note">{login.connectMessage}</p>
          )}
          {connection === 'accessDenied' && <p className="quota-connection-note">Already signed in? Approve the provider or operating-system access prompt, then try again.</p>}
          <button type="button" className="set-text-button" onClick={onRefresh}>Refresh</button>
        </div>
      )}
    </div>
  )
}