import {
  METRORA_TOOL_ARGUMENT_MAX_BYTES,
  METRORA_TOOL_CONTRACT_VERSION,
  METRORA_TOOL_DEFINITIONS,
  METRORA_TOOL_OUTPUT_MAX_BYTES,
} from '../tools/contract.js'

export type MetroraMcpInfo = {
  name: 'metrora'
  version: string
  adapterVersion: 'mcp-server-v1'
  contractVersion: string
  transport: 'stdio'
  command: { command: 'metrora'; args: ['mcp', 'serve'] }
  tools: string[]
  readOnly: true
  localOnly: true
  privacy: 'content-minimal'
  limits: { argumentBytes: number; outputBytes: number }
}

export function buildMetroraMcpInfo(version: string): MetroraMcpInfo {
  return {
    name: 'metrora',
    version,
    adapterVersion: 'mcp-server-v1',
    contractVersion: METRORA_TOOL_CONTRACT_VERSION,
    transport: 'stdio',
    command: { command: 'metrora', args: ['mcp', 'serve'] },
    tools: METRORA_TOOL_DEFINITIONS.map(definition => definition.function.name),
    readOnly: true,
    localOnly: true,
    privacy: 'content-minimal',
    limits: { argumentBytes: METRORA_TOOL_ARGUMENT_MAX_BYTES, outputBytes: METRORA_TOOL_OUTPUT_MAX_BYTES },
  }
}

export function renderMetroraMcpInfo(version: string, json: boolean): string {
  const info = buildMetroraMcpInfo(version)
  if (json) return JSON.stringify(info, null, 2) + '\n'
  return [
    'Metrora MCP Server V1',
    'transport: stdio',
    'mode: local, read-only',
    'privacy: content-minimal',
    'contract: ' + info.contractVersion,
    'command: metrora mcp serve',
    'tools: ' + info.tools.join(', '),
  ].join('\n') + '\n'
}
