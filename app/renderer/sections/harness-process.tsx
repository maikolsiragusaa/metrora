import { useState } from 'react'

import { MetroraMark } from '../components/MetroraMark'
import { metrora } from '../lib/ipc'
import type {
  HarnessApprovalProjection,
  HarnessConversationMessage,
  HarnessProcessItem,
  HarnessToolProjection,
  HarnessWorkspace,
  MetroraHarnessRuntimeEvent,
} from '../../electron/harness-runtime-types'

export function processItemsFromEvent(current: HarnessProcessItem[], event: MetroraHarnessRuntimeEvent): HarnessProcessItem[] {
  const incoming = event.process
  if (!incoming) return current
  const terminalToolStatuses = new Set<HarnessToolProjection['status']>(['completed', 'failed', 'interrupted', 'denied'])
  const mergeTool = (previous: HarnessToolProjection, next: HarnessToolProjection): HarnessToolProjection => {
    const merged = { ...previous, ...next }
    if (terminalToolStatuses.has(previous.status) && !terminalToolStatuses.has(next.status)) merged.status = previous.status
    return merged
  }
  if (incoming.kind === 'tool') {
    const index = current.findIndex(item => item.kind === 'tool' && item.item.callId === incoming.item.callId)
    if (index < 0) return [...current, incoming]
    return current.map((item, itemIndex) => itemIndex === index && item.kind === 'tool' ? { kind: 'tool', item: mergeTool(item.item, incoming.item) } : item)
  }
  if (incoming.kind === 'approval') {
    const index = current.findIndex(item => item.kind === 'approval' && item.item.approvalId === incoming.item.approvalId)
    if (index < 0) return [...current, incoming]
    return current.map((item, itemIndex) => itemIndex === index && item.kind === 'approval' ? { kind: 'approval', item: { ...item.item, ...incoming.item } } : item)
  }
  if (incoming.kind === 'agent') {
    const index = current.findIndex(item => item.kind === 'agent' && item.item.agentId === incoming.item.agentId)
    if (index < 0) return [...current, incoming]
    return current.map((item, itemIndex) => itemIndex === index && item.kind === 'agent' ? { kind: 'agent', item: { ...item.item, ...incoming.item } } : item)
  }
  return [...current, incoming]
}

function statusLabel(status: HarnessToolProjection['status']): string {
  return status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status === 'interrupted' ? 'Interrupted' : status === 'denied' ? 'Denied' : status === 'running' ? 'Running' : 'Queued'
}

function toolIcon(kind: HarnessToolProjection['kind']): string {
  return kind === 'filesystem' ? '▧' : kind === 'search' ? '⌕' : kind === 'terminal' ? '›_' : kind === 'git' ? '⑂' : kind === 'web' ? '↗' : kind === 'metrora' ? '◈' : kind === 'mcp' ? '⌘' : kind === 'subagent' ? '◎' : '·'
}

export function EmptyHarnessState({ workspace }: { workspace: HarnessWorkspace | null }) {
  return <div className="harness-empty"><div className="harness-empty-headline"><span className="harness-empty-mark"><MetroraMark size={34} /></span><h2>{workspace ? 'How can I help with your Workspace?' : 'Start a coding Session'}</h2><span className="harness-preview-badge">Metrora</span></div><p>{workspace ? 'Ask the selected Agent to inspect files, use Metrora evidence, make bounded edits, run tests, and explain the result.' : 'Open a local Workspace, select a runtime and model, then start a durable coding Session.'}</p></div>
}

export function ConversationMessage({ message, showReasoning }: { message: HarnessConversationMessage; showReasoning: boolean }) {
  if (message.role === 'user') return <div className="harness-user-message"><span>You</span><p>{message.text}</p></div>
  return <article className="harness-assistant-message"><div className="harness-message-heading"><MetroraMark size={20} /><strong>Harness Agent</strong>{message.interrupted && <span className="harness-interrupted">Interrupted</span>}</div>{message.reasoning && showReasoning && <details className="harness-reasoning"><summary>Reasoning</summary><p>{message.reasoning}</p></details>}{message.process?.length ? <ProcessFold items={message.process} active={false} onApprovalResolved={() => {}} /> : null}<p className="harness-answer">{message.text || 'The Agent completed this turn without a final text response.'}</p></article>
}

export function ProcessFold({ items, active, onApprovalResolved }: { items: HarnessProcessItem[]; active: boolean; onApprovalResolved: (id: string) => void }) {
  const toolCount = items.filter(item => item.kind === 'tool').length
  const editCount = items.filter(item => item.kind === 'tool' && ['write', 'edit'].includes(item.item.name)).length
  const commandCount = items.filter(item => item.kind === 'tool' && item.item.kind === 'terminal').length
  const label = active ? 'Live process' : `${toolCount ? `Used ${toolCount} Tool${toolCount === 1 ? '' : 's'}` : 'Process'}${editCount ? ` · edited ${editCount}` : ''}${commandCount ? ` · ran ${commandCount} command${commandCount === 1 ? '' : 's'}` : ''}`
  return <details className="harness-process-fold" open={active}><summary><span>{label}</span><small>{active ? 'Active' : 'Show details'}</small></summary><div className="harness-process-list">{items.map(item => item.kind === 'tool' ? <ToolCard key={`tool-${item.item.callId}`} item={item.item} /> : item.kind === 'approval' ? <ApprovalCard key={`approval-${item.item.approvalId}`} item={item.item} onResolved={onApprovalResolved} /> : item.kind === 'agent' ? <div className="harness-agent-card" key={`agent-${item.item.agentId}`}><span>◎</span><div><strong>{item.item.task}</strong><small>{item.item.state} · Agent {item.item.agentId.slice(0, 8)}</small>{item.item.result && <p>{item.item.result}</p>}</div></div> : item.kind === 'reasoning' ? <div className="harness-reasoning-line" key={item.id}><span>Reasoning</span><p>{item.text}</p></div> : <div className="harness-status-line" key={item.id}>{item.text}</div>)}</div></details>
}

function ToolCard({ item }: { item: HarnessToolProjection }) {
  const details = item.details
  return <div className={`harness-tool-card ${item.status}`} data-kind={item.kind} data-status={item.status}><div className="harness-tool-icon">{toolIcon(item.kind)}</div><div className="harness-tool-body"><div className="harness-tool-head"><div className="harness-tool-name"><strong>{item.name}</strong>{item.source && <small>MCP · {item.source.serverName} · {item.source.toolName}</small>}</div><span className={`harness-tool-status ${item.status}`}><i aria-hidden="true" />{statusLabel(item.status)}</span></div><p>{item.inputSummary}</p>{item.path && <code>{item.path}</code>}{item.command && <code>{item.command}</code>}{item.resultSummary && <small>{item.resultSummary}{item.exitCode !== undefined && item.exitCode !== null ? ` · exit ${item.exitCode}` : ''}</small>}{details && <details className="harness-tool-details"><summary>Show details</summary><ToolDetails details={details} /></details>}</div></div>
}

function ToolDetails({ details }: { details: NonNullable<HarnessToolProjection['details']> }) {
  if (details.kind === 'read') return <div className="harness-code-preview"><small>{details.path} · {details.totalLines} lines</small><pre>{details.lines.map(line => `${String(line.number).padStart(4, ' ')} │ ${line.text}`).join('\n')}</pre></div>
  if (details.kind === 'search') return <div className="harness-search-preview"><small>{details.total} result{details.total === 1 ? '' : 's'}{details.truncated ? ' · output capped' : ''}</small>{details.paths?.map(path => <code key={path}>{path}</code>)}{details.files?.map(file => <div key={file.path}><code>{file.path}</code>{file.matches.map(match => <p key={`${file.path}:${match.lineNumber}`}><b>{match.lineNumber}</b> {match.line}</p>)}</div>)}</div>
  if (details.kind === 'diff') return <div className="harness-diff-preview">{details.diffs.map(diff => <div key={diff.path}><small>{diff.path}</small><pre>{diff.oldText !== null && diff.oldText.split('\n').slice(0, 240).map((line, index) => <span className="removed" key={`old-${index}`}>- {line}{'\n'}</span>)}{diff.newText.split('\n').slice(0, 240).map((line, index) => <span className="added" key={`new-${index}`}>+ {line}{'\n'}</span>)}</pre></div>)}</div>
  if (details.kind === 'terminal') return <div className="harness-terminal-preview"><pre>{details.output || '(no output)'}</pre>{details.signal ? <small>signal {details.signal}</small> : details.exitCode !== undefined ? <small>exit {details.exitCode ?? 'unknown'}</small> : null}</div>
  return <div className="harness-web-preview">{details.title && <strong>{details.title}</strong>}{details.url && <code>{details.url}</code>}{details.excerpt && <p>{details.excerpt}</p>}</div>
}

function ApprovalCard({ item, onResolved }: { item: HarnessApprovalProjection; onResolved: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const resolve = async (allow: boolean) => {
    setBusy(true)
    try { const accepted = allow ? await metrora.harnessApprove(item.approvalId) : await metrora.harnessDeny(item.approvalId); if (accepted) onResolved(item.approvalId) }
    finally { setBusy(false) }
  }
  return <div className={`harness-approval-card ${item.state}`}><div><strong>Shield · {item.toolName}</strong><span>{item.risk.replaceAll('-', ' ')}</span></div><p>{item.action}</p>{item.workspacePath && <code>{item.workspacePath}</code>}{item.command && <code>{item.command}</code>}{item.state === 'proposed' ? <div className="harness-approval-actions"><button type="button" onClick={() => void resolve(true)} disabled={busy}>Approve</button><button type="button" className="quiet" onClick={() => void resolve(false)} disabled={busy}>Deny</button></div> : <small>{item.state}</small>}</div>
}
