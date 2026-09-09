const KNOWN_PROVIDER_LABELS: Record<string, string> = {
  api: 'API',
  anthropic: 'Anthropic',
  antigravity: 'Antigravity',
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
  'cursor-agent': 'Cursor Agent',
  deepseek: 'DeepSeek',
  google: 'Google',
  mistral: 'Mistral',
  'mistral-vibe': 'Mistral Vibe',
  openai: 'OpenAI',
  opencode: 'OpenCode',
  pi: 'Pi',
  qwen: 'Qwen',
  zcode: 'ZCode',
  zed: 'Zed',
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

export function formatProviderLabel(value: string): string {
  const known = KNOWN_PROVIDER_LABELS[normalize(value)]
  if (known) return known
  return value
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

export function providerLogoKey(value: string): string {
  const normalizedValue = normalize(value)
  if (normalizedValue.includes('openai') || normalizedValue === 'codex') return 'codex'
  if (normalizedValue.includes('anthropic') || normalizedValue.includes('claude')) return 'claude'
  if (normalizedValue.includes('google') || normalizedValue.includes('gemini')) return 'gemini'
  if (normalizedValue.includes('mistral')) return 'mistral-vibe'
  if (normalizedValue.includes('alibaba') || normalizedValue.includes('qwen')) return 'qwen'
  if (normalizedValue.includes('x.ai') || normalizedValue.includes('grok')) return 'grok'
  return value
}
