import {
  TOKENS_PER_SKILL_DEF,
  TOKENS_PER_AGENT_DEF,
  TOKENS_PER_COMMAND_DEF,
} from '../optimize.js'
import type { ActionKind } from './types.js'

export const HONEST_FOOTER =
  'Estimates are scaled to the measured window for comparability; the at-apply estimate is kept in --json. '
  + 'MCP, defer and archive realized figures are derived from per-session baselines times observed session state, not independently metered token deltas. '
  + 'Each fix measures only its own metric; effects are never attributed across signals. '
  + 'Guard rows are correlation, not attribution. Realized numbers are rounded down.'

export const MCP_KINDS = new Set<ActionKind>(['mcp-remove', 'mcp-project-scope'])

export const ARCHIVE_DEF_TOKENS: Partial<Record<ActionKind, number>> = {
  'archive-skill': TOKENS_PER_SKILL_DEF,
  'archive-agent': TOKENS_PER_AGENT_DEF,
  'archive-command': TOKENS_PER_COMMAND_DEF,
}
