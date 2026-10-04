// Known model name variants that providers emit but LiteLLM/fallback don't index under.
// OMP emits 'anthropic--claude-4.6-opus' (double-dash, dot version, tier-last).
// getCanonicalName strips any 'provider/' prefix first, so only the post-strip
// forms need to be listed here.
export const BUILTIN_ALIASES: Record<string, string> = {
  'anthropic--claude-4.6-opus':    'claude-opus-4-6',
  'anthropic--claude-4.6-sonnet':  'claude-sonnet-4-6',
  'anthropic--claude-4.5-opus':    'claude-opus-4-5',
  'anthropic--claude-4.5-sonnet':  'claude-sonnet-4-5',
  'anthropic--claude-4.5-haiku':   'claude-haiku-4-5',
  'claude-sonnet-4.6':             'claude-sonnet-4-6',
  'claude-sonnet-4.5':             'claude-sonnet-4-5',
  'claude-opus-4.7':               'claude-opus-4-7',
  'claude-opus-4.6':               'claude-opus-4-6',
  'claude-opus-4.5':               'claude-opus-4-5',
  'cursor-auto':                    'claude-sonnet-4-5',
  'cursor-agent-auto':             'claude-sonnet-4-5',
  'copilot-auto':                  'claude-sonnet-4-5',
  'copilot-openai-auto':           'gpt-5.3-codex',
  'copilot-anthropic-auto':        'claude-sonnet-4-5',
  'openai-codex:gpt-5.5':          'gpt-5.5',
  'ibm-bob-auto':                  'claude-sonnet-4-5',
  'kiro-auto':                     'claude-sonnet-4-5',
  'quickdesk-auto':                'claude-sonnet-4-5',
  'cline-auto':                    'claude-sonnet-4-5',
  'openclaw-auto':                 'claude-sonnet-4-5',
  'warp-auto-efficient':           'gpt-5.3-codex',
  'warp-auto-powerful':            'claude-opus-4-6',
  'grok-build':                    'grok-build-0.1',
  'GPT-5.3 Codex (low reasoning)': 'gpt-5.3-codex',
  'GPT-5.3 Codex (medium reasoning)': 'gpt-5.3-codex',
  'GPT-5.3 Codex (high reasoning)': 'gpt-5.3-codex',
  'GPT-5.3 Codex (extra high reasoning)': 'gpt-5.3-codex',
  'Claude Sonnet 4.6':             'claude-sonnet-4-6',
  'Claude Sonnet 4.5':             'claude-sonnet-4-5',
  'Claude Haiku 4.5':              'claude-haiku-4-5',
  'Claude Opus 4.6':               'claude-opus-4-6',
  'claude-4-6-sonnet-high':        'claude-sonnet-4-6',
  'claude-4-6-sonnet-low':         'claude-sonnet-4-6',
  'claude-4-6-sonnet-medium':      'claude-sonnet-4-6',
  'claude-4-6-sonnet-high-fast':   'claude-sonnet-4-6',
  'claude-4-7-opus-xhigh':         'claude-opus-4-7',
  'claude-4-7-opus-xhigh-fast':    'claude-opus-4-7',
  'qwen-auto':                     'claude-sonnet-4-5',
  'kimi-auto':                     'kimi-k2-thinking',
  'kimi-code':                     'kimi-k2-thinking',
  'kimi-for-coding':               'kimi-k2-thinking',
  // Kimi Code wires report the bare `k3` id in llm.request.model; without an
  // alias those calls priced at $0 and the provider looked absent in the UI.
  'k3':                            'kimi-k3',
  // Kimi desktop/IDE embedded runtime serves `k3-agent` / `k2d6-agent`.
  'k3-agent':                      'kimi-k3',
  'k2d6-agent':                    'kimi-k2p6',
  'mimo-v2-flash':                 'xiaomi/mimo-v2-flash',
  'kat-coder-pro-v1':              'kwaipilot/kat-coder-pro',
  // DSH logs the route id `deepseek-flash` for the wire model `deepseek-v4-flash`; unmapped it prices at $0.
  'deepseek-flash':                'deepseek-v4-flash',
  // Cursor emits dot-version tier-last names plus tier/reasoning suffixes
  // that LiteLLM does not index (`-high`, `-low`, `-medium`, `-thinking`,
  // `-high-thinking`, `-fast-mode`). Missing aliases here surface as $0 in
  // the dashboard for users on non-Auto models (issue #159). Sources: the
  // display map at `src/providers/cursor.ts:modelDisplayNames`, Cursor's
  // public model docs at https://cursor.com/docs/models, and forum bug
  // reports that quote literal slugs (e.g. forum.cursor.com/t/154933).
  'claude-4-sonnet':                'claude-sonnet-4',
  'claude-4-sonnet-1m':             'claude-sonnet-4',
  'claude-4-sonnet-thinking':       'claude-sonnet-4-5',
  'claude-4.5-sonnet':              'claude-sonnet-4-5',
  'claude-4.5-sonnet-thinking':     'claude-sonnet-4-5',
  'claude-4.6-sonnet':              'claude-sonnet-4-6',
  'claude-4.6-sonnet-high':         'claude-sonnet-4-6',
  'claude-4.6-sonnet-low':          'claude-sonnet-4-6',
  'claude-4.6-sonnet-thinking':     'claude-sonnet-4-6',
  'claude-4.6-sonnet-high-thinking':'claude-sonnet-4-6',
  'claude-4-opus':                  'claude-opus-4',
  'claude-4.5-opus':                'claude-opus-4-5',
  'claude-4.5-opus-high':           'claude-opus-4-5',
  'claude-4.5-opus-low':            'claude-opus-4-5',
  'claude-4.5-opus-medium':         'claude-opus-4-5',
  'claude-4.5-opus-high-thinking':  'claude-opus-4-5',
  'claude-4.6-opus':                'claude-opus-4-6',
  'claude-4.6-opus-fast-mode':      'claude-opus-4-6',
  'claude-4.6-opus-high':           'claude-opus-4-6',
  'claude-4.6-opus-low':            'claude-opus-4-6',
  'claude-4.6-opus-medium':         'claude-opus-4-6',
  'claude-4.6-opus-high-thinking':  'claude-opus-4-6',
  'claude-4.7-opus':                'claude-opus-4-7',
  // Dash form (NOT dot) seen in forum.cursor.com/t/158597.
  'claude-opus-4-7-thinking-high':  'claude-opus-4-7',
  'claude-4.5-haiku':               'claude-haiku-4-5',
  'claude-4.6-haiku':               'claude-haiku-4-5',
  // Cursor house composer models use Cursor-published rates in
  // BUILTIN_PRICE_OVERRIDES; keep them out of this alias map so they do not
  // inherit Claude Sonnet proxy pricing.
  // Cursor's "fast" routing variant of GPT-5 is the same model behind a
  // lower-latency endpoint; price as base GPT-5 until LiteLLM tracks it.
  'gpt-5-fast':                     'gpt-5',
  'gpt-4.1':                        'gpt-4.1',
  'gpt-5.2-low':                    'gpt-5',
  'gpt-5.1-codex-high':             'gpt-5.3-codex',
  // Antigravity Gemini model IDs resolve to preview-priced entries.
  'gemini-3.1-pro':                 'gemini-3.1-pro-preview',
  'gemini-3-flash':                 'gemini-3-flash-preview',
  'gemini-3.1-pro-high':            'gemini-3.1-pro-preview',
  'gemini-3.1-pro-low':             'gemini-3.1-pro-preview',
  'gemini-3-flash-agent':           'gemini-3-flash-preview',
  'gemini-3.5-flash-high':          'gemini-3.5-flash',
  'gemini-3.5-flash-medium':        'gemini-3.5-flash',
  'gemini-3.5-flash-low':           'gemini-3.5-flash',
  'Gemini 3.5 Flash (High)':        'gemini-3.5-flash',
  'Gemini 3.5 Flash (Medium)':      'gemini-3.5-flash',
  'Gemini 3.5 Flash (Low)':         'gemini-3.5-flash',
  'gemini-3-pro':                   'gemini-3-pro-preview',
  'gemini-3.1-flash-image':         'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-lite':          'gemini-3.1-flash-lite-preview',
  // ZCode runs GLM-5.2 through z.ai's start-plan subscription; it isn't in
  // LiteLLM yet. Price as the nearest released sibling (GLM-5.1) until it is.
  'GLM-5.2':                        'glm-5p1',
  // Hermes Agent stores the same model id lowercased (`glm-5.2`) in its
  // sessions table, so it misses the capitalized alias above and goes
  // unpriced. Map the lowercase spelling to the same sibling.
  'glm-5.2':                        'glm-5p1',
}
