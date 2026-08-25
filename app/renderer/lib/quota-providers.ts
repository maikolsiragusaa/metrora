import type { ProviderName, ProviderQuotaSource } from '../../electron/quota/types'

type ProviderPresentation = {
  name: string
  owner: string
  connectMessage: string
  command?: string
  commandHint?: string
}

const PROVIDERS: Record<ProviderName, ProviderPresentation> = {
  claude: {
    name: 'Claude',
    owner: 'Anthropic',
    connectMessage: 'Not connected. Log in with the Claude CLI.',
    command: 'claude',
    commandHint: 'then type /login',
  },
  codex: {
    name: 'Codex',
    owner: 'OpenAI',
    connectMessage: 'Not connected. Log in with the Codex CLI.',
    command: 'codex login',
  },
  copilot: {
    name: 'GitHub Copilot',
    owner: 'GitHub',
    connectMessage: 'Not connected. Sign in to GitHub Copilot in your editor, then Refresh.',
  },
  kimi: {
    name: 'Kimi Code',
    owner: 'Moonshot AI',
    connectMessage: 'Not connected. Sign in with the Kimi Code CLI, then Refresh.',
    command: 'kimi',
  },
  antigravity: {
    name: 'Antigravity',
    owner: 'Google',
    connectMessage: 'Not connected. Open Antigravity and sign in, then Refresh.',
  },
}

export function isQuotaProviderName(provider: string): provider is ProviderName {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider)
}

export function quotaProviderDisplayName(provider: string): string {
  return isQuotaProviderName(provider) ? PROVIDERS[provider].name : provider
}

export function quotaProviderName(provider: ProviderName): string {
  return PROVIDERS[provider].name
}

export function quotaProviderOwner(provider: ProviderName): string {
  return PROVIDERS[provider].owner
}

export function quotaProviderConnect(provider: ProviderName): ProviderPresentation {
  return PROVIDERS[provider]
}

export function quotaSourceLabel(source: ProviderQuotaSource | undefined): string {
  if (!source) return 'Provider-reported'
  const base = source.kind === 'provider-api' ? 'Provider API'
    : source.kind === 'provider-cli' ? 'Provider CLI'
    : source.kind === 'provider-loopback' ? 'Local provider service'
    : 'Provider client API'
  const suffix = source.stability === 'documented' ? 'Documented'
    : source.stability === 'experimental' ? 'Experimental'
    : 'Provider-owned'
  return `${base} · ${suffix}`
}
