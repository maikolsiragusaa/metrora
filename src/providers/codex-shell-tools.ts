// Codex may call MCP through `mcp-cli call <server> <tool>` inside a shell
// command instead of registering the server natively. Keep shell execution
// attributed to Bash while also surfacing the canonical MCP tool name.
const MCP_CLI_CALL = /(?<![\w.-])mcp-cli(?:\s+(?!call\b)[^\s;|&]+)*\s+call\s+(\S+)\s+(\S+)/

export function mcpToolFromShellCommand(command: unknown): string | null {
  const text = typeof command === 'string'
    ? command
    : Array.isArray(command) ? command.filter(value => typeof value === 'string').join(' ') : ''
  if (!text) return null
  const match = MCP_CLI_CALL.exec(text)
  if (!match) return null
  const server = match[1]!.replace(/['"]/g, '')
  const tool = match[2]!.replace(/['"]/g, '')
  if (!server || !tool) return null
  return `mcp__${server}__${tool}`
}
