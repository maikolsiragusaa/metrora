from pathlib import Path


def replace(path: Path, replacements: list[tuple[str, str]]) -> None:
    if not path.exists():
        return
    original = path.read_text(encoding='utf-8')
    updated = original
    for old, new in replacements:
        updated = updated.replace(old, new)
    if updated != original:
        path.write_text(updated, encoding='utf-8')


diagnostic_replacements = [
    ('`codeburn: ', '`metrora: '),
    ('"codeburn: ', '"metrora: '),
    ("'codeburn: ", "'metrora: "),
    ('\\rcodeburn: ', '\\rmetrora: '),
    ('codeburn model-alias', 'metrora model-alias'),
    ('codeburn model-savings', 'metrora model-savings'),
    ('npx codeburn@latest', 'npx metrora@latest'),
]
for root in (Path('src'), Path('tests')):
    for path in root.rglob('*.ts'):
        replace(path, diagnostic_replacements)

visible_runtime_files = [
    'src/overview.ts',
    'src/doctor.ts',
    'src/optimize.ts',
    'src/mcp/server.ts',
    'src/export.ts',
    'src/dashboard.tsx',
    'src/web-dashboard.ts',
    'src/sync/auth.ts',
    'src/codex-throughput.ts',
    'src/sharing/host.ts',
    'src/providers/cursor.ts',
]
for name in visible_runtime_files:
    replace(Path(name), [('CodeBurn', 'Metrora')])

visible_test_files = [
    'tests/overview.test.ts',
    'tests/doctor.test.ts',
    'tests/optimize.test.ts',
    'tests/optimize-apply.test.ts',
    'tests/export.test.ts',
    'tests/dashboard.test.ts',
    'tests/web-dashboard.test.ts',
    'tests/codex-throughput.test.ts',
    'tests/mcp-server.test.ts',
    'tests/sharing/host.test.ts',
    'src/mcp/server.test.ts',
]
for name in visible_test_files:
    replace(Path(name), [('CodeBurn', 'Metrora')])

ps = Path('tools/windows-portable/Run-Metrora-Baseline.ps1')
text = ps.read_text(encoding='utf-8')
text = text.replace(
    "      $startInfo.RedirectStandardOutput = $true\n      $startInfo.RedirectStandardError = $true\n",
    "      $startInfo.RedirectStandardOutput = $true\n      $startInfo.RedirectStandardError = $true\n      $startInfo.StandardOutputEncoding = $utf8NoBom\n      $startInfo.StandardErrorEncoding = $utf8NoBom\n",
)
text = text.replace(
    "      $stderrTemp = [System.IO.Path]::GetTempFileName()\n      $electronWasPresent",
    "      $stderrTemp = [System.IO.Path]::GetTempFileName()\n      $outputEncodingPrevious = $OutputEncoding\n      $consoleOutputEncodingPrevious = [Console]::OutputEncoding\n      $errorActionPreferencePrevious = $ErrorActionPreference\n      $electronWasPresent",
)
text = text.replace(
    "        $env:NO_COLOR = '1'\n        $lines = & $Executable @Arguments 2> $stderrTemp\n",
    "        $env:NO_COLOR = '1'\n        $OutputEncoding = $utf8NoBom\n        [Console]::OutputEncoding = $utf8NoBom\n        $ErrorActionPreference = 'Continue'\n        $lines = & $Executable @Arguments 2> $stderrTemp\n",
)
text = text.replace(
    "      } finally {\n        Restore-EnvironmentValue -Name 'ELECTRON_RUN_AS_NODE'",
    "      } finally {\n        $OutputEncoding = $outputEncodingPrevious\n        [Console]::OutputEncoding = $consoleOutputEncodingPrevious\n        $ErrorActionPreference = $errorActionPreferencePrevious\n        Restore-EnvironmentValue -Name 'ELECTRON_RUN_AS_NODE'",
)
text = text.replace(
    "  if ($command.Source) { return $command.Source }\n  if ($command.Path) { return $command.Path }\n  return $command.Name\n",
    "  $resolved = if ($command.Source) { $command.Source } elseif ($command.Path) { $command.Path } else { $command.Name }\n  if ($resolved -and [System.IO.Path]::GetExtension($resolved) -ieq '.ps1') {\n    $cmdSibling = [System.IO.Path]::ChangeExtension($resolved, '.cmd')\n    if (Test-Path -LiteralPath $cmdSibling) {\n      return (Resolve-Path -LiteralPath $cmdSibling).Path\n    }\n  }\n  return $resolved\n",
)
ps.write_text(text, encoding='utf-8')

boundary = Path('scripts/check-brand-boundary.mjs')
text = boundary.read_text(encoding='utf-8')
text = text.replace(
    "import { execFileSync } from 'node:child_process'\n",
    "import { execFileSync } from 'node:child_process'\nimport { readFileSync } from 'node:fs'\n",
)
marker = "console.log('Metrora brand boundary is clean; Qovrion remains only in explicit compatibility/provenance files.')"
addition = r'''
const runtimeVisibleFiles = [
  'src/overview.ts',
  'src/doctor.ts',
  'src/optimize.ts',
  'src/mcp/server.ts',
  'src/export.ts',
  'src/dashboard.tsx',
  'src/web-dashboard.ts',
  'src/sync/auth.ts',
  'src/codex-throughput.ts',
  'src/sharing/host.ts',
  'src/providers/cursor.ts',
]
const runtimeBrandViolations = []
for (const path of files.filter(path => path.startsWith('src/') && /\.(?:ts|tsx)$/.test(path))) {
  const content = readFileSync(path, 'utf8')
  content.split(/\r?\n/).forEach((line, index) => {
    if (/codeburn:\s/i.test(line)) runtimeBrandViolations.push(`${path}:${index + 1}:${line.trim()}`)
  })
}
for (const path of runtimeVisibleFiles) {
  const content = readFileSync(path, 'utf8')
  content.split(/\r?\n/).forEach((line, index) => {
    if (/\bCodeBurn\b/.test(line)) runtimeBrandViolations.push(`${path}:${index + 1}:${line.trim()}`)
  })
}
if (runtimeBrandViolations.length) {
  console.error(`Legacy runtime branding escaped the compatibility boundary:\n${runtimeBrandViolations.join('\n')}`)
  process.exit(1)
}
'''
if addition.strip() not in text:
    text = text.replace(marker, addition + '\n' + marker)
boundary.write_text(text, encoding='utf-8')

Path('tests/runtime-brand.test.ts').write_text(
    """import { describe, expect, it } from 'vitest'\n\nimport { renderOverview } from '../src/overview.js'\n\ndescribe('Metrora runtime branding', () => {\n  it('uses the Metrora identity in the plain-text overview', () => {\n    const output = renderOverview([], { label: 'Lifetime', color: false })\n    expect(output).toContain('Metrora  Lifetime')\n    expect(output).not.toContain('CodeBurn')\n  })\n})\n""",
    encoding='utf-8',
)
