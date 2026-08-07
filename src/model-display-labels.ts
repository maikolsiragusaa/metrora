// Friendly labels that are display-only: they must never imply pricing aliases
// or collapse an unknown future variant into a known sibling.
export const REVIEWED_MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'glm-5p1': 'GLM-5.2',
  'grok-build-0.1': 'Grok Build',
  'grok-composer-2.5-fast': 'Grok Composer 2.5 Fast',
  'grok-4.5': 'Grok 4.5',
  'glm-5p2': 'GLM-5.2',
  'qwen3p7-plus': 'Qwen 3.7 Plus',
  'qwen3.7-max': 'Qwen 3.7 Max',
  'kimi-k2p7-code': 'Kimi K2.7 Code',
  'mimo-v2.5-pro': 'MiMo v2.5 Pro',
  'minimax-m3': 'MiniMax M3',
  'MiniMax-M3': 'MiniMax M3',
})
