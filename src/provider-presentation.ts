// Provider presentation data for the terminal dashboard: one palette color and
// one display name per provider id, shared by the charts and the header strip.
export const PROVIDER_COLORS: Record<string, string> = {
  claude: '#FF8C42',
  codex: '#5BF5A0',
  cursor: '#00B4D8',
  'ibm-bob': '#0F62FE',
  opencode: '#A78BFA',
  pi: '#F472B6',
  kimi: '#B6E34A',
  kimicode: '#A3E635',
  dsh: '#4D6BFE',
  all: '#FF8C42',
}

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  all: 'All',
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  'ibm-bob': 'IBM Bob',
  opencode: 'OpenCode',
  pi: 'Pi',
  kimi: 'Kimi',
  kimicode: 'Kimi Code',
  dsh: 'DeepSeek Harness',
}
