import fs from 'node:fs'

const appPath = 'app/renderer/App.tsx'
const workflowPath = '.github/workflows/ux1a-scope-patch.yml'
const scriptPath = 'scripts/ux1a-scope-patch.mjs'
let source = fs.readFileSync(appPath, 'utf8')

function replaceOnce(from, to) {
  const first = source.indexOf(from)
  if (first < 0) throw new Error(`Expected App source fragment was not found: ${from.slice(0, 100)}`)
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`App source fragment was not unique: ${from.slice(0, 100)}`)
  source = source.replace(from, to)
}

replaceOnce(
  "import { shortcutLabel } from './lib/shortcuts'",
  "import { shortcutLabel, shortcutRangeLabel } from './lib/shortcuts'",
)

replaceOnce(
  "  const [, setCurrencyTick] = useState(0)\n\n  // Preserve the 2/3-arg call shapes",
  "  const [, setCurrencyTick] = useState(0)\n  const sectionCapabilities = DESKTOP_SECTION_CAPABILITIES[section]\n  const scopedClaudeConfigSource = sectionCapabilities.claudeConfig ? claudeConfigSource : null\n\n  // Preserve the 2/3-arg call shapes",
)

replaceOnce(
  `  const overview = usePolled<MenubarPayload>(
    () => claudeConfigSource
      ? codeburn.getOverview(period, provider, customRange ?? undefined, claudeConfigSource)
      : customRange
      ? codeburn.getOverview(period, provider, customRange)
      : codeburn.getOverview(period, provider),
    [period, provider, customRange?.from, customRange?.to, claudeConfigSource],
    { memoKey: overviewMemoKey(provider, period, customRange, claudeConfigSource) },
  )`,
  `  const overview = usePolled<MenubarPayload>(
    () => scopedClaudeConfigSource
      ? codeburn.getOverview(period, provider, customRange ?? undefined, scopedClaudeConfigSource)
      : customRange
      ? codeburn.getOverview(period, provider, customRange)
      : codeburn.getOverview(period, provider),
    [period, provider, customRange?.from, customRange?.to, scopedClaudeConfigSource],
    { memoKey: overviewMemoKey(provider, period, customRange, scopedClaudeConfigSource) },
  )`,
)

replaceOnce(
  "    if (!overview.data || provider !== 'all' || customRange || claudeConfigSource) return",
  "    if (!overview.data || provider !== 'all' || customRange || scopedClaudeConfigSource) return",
)
replaceOnce(
  "  }, [overview.data, provider, customRange, claudeConfigSource, period, trackEvent])",
  "  }, [overview.data, provider, customRange, scopedClaudeConfigSource, period, trackEvent])",
)
replaceOnce(
  "    if (!ready || overview.data == null || customRange || claudeConfigSource) return",
  "    if (!ready || overview.data == null || customRange || scopedClaudeConfigSource) return",
)
replaceOnce(
  "  }, [ready, period, provider, customRange, claudeConfigSource, detectedProviders, overview.data == null])",
  "  }, [ready, period, provider, customRange, scopedClaudeConfigSource, detectedProviders, overview.data == null])",
)

replaceOnce(
  `  const activeConfigLabel = claudeConfigSource
    ? claudeConfigs?.options.find(option => option.id === claudeConfigSource)?.label ?? null
    : null`,
  `  const activeConfigLabel = scopedClaudeConfigSource
    ? claudeConfigs?.options.find(option => option.id === scopedClaudeConfigSource)?.label ?? null
    : null`,
)

replaceOnce(
  "  const scope = `${customRange ? rangeLabel(customRange) : PERIOD_LABELS[period]} · ${providerLabel}${activeConfigLabel ? ` · ${activeConfigLabel}` : ''}`\n  const sectionCapabilities = DESKTOP_SECTION_CAPABILITIES[section]",
  "  const scope = `${customRange ? rangeLabel(customRange) : PERIOD_LABELS[period]} · ${providerLabel}${activeConfigLabel ? ` · ${activeConfigLabel}` : ''}`",
)

replaceOnce(
  "{ k: `${shortcutLabel('1')}-${shortcutLabel('9').replace(/^.*?(?=9$)/, '')}`, label: 'Navigate' }",
  "{ k: shortcutRangeLabel('1', '9'), label: 'Navigate' }",
)

fs.writeFileSync(appPath, source)
fs.rmSync(workflowPath)
fs.rmSync(scriptPath)
