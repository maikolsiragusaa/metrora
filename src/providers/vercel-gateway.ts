import type { DateRange } from '../types.js'
import type { Provider, SessionSource, SessionParser, ParsedProviderCall } from './types.js'
import { sourceMeteredCostAssignment } from './cost-evidence.js'
import { fetchWithTimeout } from '../fetch-utils.js'

const REPORT_URL = 'https://ai-gateway.vercel.sh/v1/report'

type ReportRow = {
  day?: string
  model?: string
  total_cost?: number
  input_tokens?: number
  output_tokens?: number
  cached_input_tokens?: number
  cache_creation_input_tokens?: number
  reasoning_tokens?: number
  request_count?: number
}

export function getVercelGatewayApiKey(): string | null {
  const key = process.env['AI_GATEWAY_API_KEY'] ?? process.env['VERCEL_OIDC_TOKEN']
  return key?.trim() ? key.trim() : null
}

function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function fetchVercelGatewayReport(
  dateRange: DateRange,
): Promise<ReportRow[]> {
  const key = getVercelGatewayApiKey()
  if (!key) return []

  const params = new URLSearchParams({
    start_date: formatUtcDate(dateRange.start),
    end_date: formatUtcDate(dateRange.end),
    date_part: 'day',
    group_by: 'model',
  })

  try {
    const res = await fetchWithTimeout(`${REPORT_URL}?${params}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      process.stderr.write(
        `metrora: Vercel AI Gateway report failed (HTTP ${res.status}). ` +
          'Requires AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN (Pro/Enterprise for /v1/report). ' +
          `${detail.slice(0, 200)}\n`,
      )
      return []
    }

    const body = (await res.json()) as { results?: ReportRow[] }
    return body.results ?? []
  } catch (err) {
    process.stderr.write(
      `metrora: Vercel AI Gateway report unreachable (${err instanceof Error ? err.message : String(err)}).\n`,
    )
    return []
  }
}

function createParser(
  source: SessionSource,
  seenKeys: Set<string>,
  dateRange?: DateRange,
): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      if (!dateRange) return

      const rows = await fetchVercelGatewayReport(dateRange)
      for (const row of rows) {
        const day = row.day ?? ''
        const model = row.model ?? 'unknown'
        const sourceCost = typeof row.total_cost === 'number' && Number.isFinite(row.total_cost) && row.total_cost >= 0 ? row.total_cost : undefined
        const costUSD = sourceCost ?? 0
        const inputTokens = row.input_tokens ?? 0
        const outputTokens = row.output_tokens ?? 0
        const cacheReadTokens = row.cached_input_tokens ?? 0
        const cacheWriteTokens = row.cache_creation_input_tokens ?? 0
        const reasoningTokens = row.reasoning_tokens ?? 0
        if (sourceCost === undefined && inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0 && reasoningTokens === 0) continue

        const rowKey = `vercel-gateway:${day}:${model}`
        if (seenKeys.has(rowKey)) continue
        seenKeys.add(rowKey)

        // The report is aggregate evidence at day + model grain. Parsed calls
        // have no multiplicity contract, so request_count must not become N
        // synthetic request identities with allocated token/cost precision.
        yield {
          provider: 'vercel-gateway',
          model,
          pricingContext: { gateway: 'vercel-ai-gateway' },
          costIsEstimated: sourceCost === undefined,
          ...(sourceCost !== undefined ? { costAssignment: sourceMeteredCostAssignment(sourceCost, 'billing-export') } : {}),
          inputTokens,
          outputTokens,
          cacheCreationInputTokens: cacheWriteTokens,
          cacheReadInputTokens: cacheReadTokens,
          cachedInputTokens: 0,
          reasoningTokens,
          webSearchRequests: 0,
          costUSD,
          tools: [],
          bashCommands: [],
          timestamp: day ? `${day}T12:00:00.000Z` : '',
          speed: 'standard',
          deduplicationKey: rowKey,
          userMessage: '',
          sessionId: `${day}:${model}`,
          project: source.project,
        }
      }
    },
  }
}

export const vercelGateway: Provider = {
  name: 'vercel-gateway',
  displayName: 'Vercel AI Gateway',
  network: true,

  modelDisplayName(model: string): string {
    const slash = model.indexOf('/')
    return slash >= 0 ? model.slice(slash + 1) : model
  },

  toolDisplayName(rawTool: string): string {
    return rawTool
  },

  async discoverSessions(): Promise<SessionSource[]> {
    if (!getVercelGatewayApiKey()) return []

    return [{
      path: 'vercel-ai-gateway:report',
      project: 'Vercel AI Gateway',
      provider: 'vercel-gateway',
    }]
  },

  createSessionParser(
    source: SessionSource,
    seenKeys: Set<string>,
    dateRange?: DateRange,
  ): SessionParser {
    return createParser(source, seenKeys, dateRange)
  },
}
