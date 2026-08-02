param(
  [Parameter(Mandatory = $true)]
  [string]$AcceptanceDirectory,

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-context-lib.ps1')

function Read-ProfileResult([string]$Path, $Fallback) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $Fallback }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

$state = Get-MetroraPhysicalAcceptanceState $AcceptanceDirectory $RepositoryRoot
$acceptance = $state.Acceptance
$repository = $state.Repository
$sentinelPath = $state.SentinelPath
$context = $state.Context

$defaults = New-MetroraNotRunProfiles
$profiles = [ordered]@{
  existing = Read-ProfileResult (Join-Path $acceptance 'P1_EXISTING_RESULT.json') $defaults.existing
  clean = Read-ProfileResult (Join-Path $acceptance 'P2_CLEAN_RESULT.json') $defaults.clean
  migration = Read-ProfileResult (Join-Path $acceptance 'P3_MIGRATION_RESULT.json') $defaults.migration
}

$report = [ordered]@{
  kind = 'metrora.windows-physical-acceptance-report'
  version = 1
  generatedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  source = [ordered]@{
    repository = [string]$context.source.repository
    commit = [string]$context.source.commit
  }
  candidate = [ordered]@{
    artifactName = [string]$context.candidate.artifactName
    artifactSha256 = [string]$context.candidate.artifactSha256
    productVersion = [string]$context.candidate.productVersion
    releaseManifestSha256 = [string]$context.candidate.releaseManifestSha256
    formatManifestSha256 = [string]$context.candidate.formatManifestSha256
  }
  platform = [ordered]@{
    edition = [string]$context.platform.edition
    version = [string]$context.platform.version
    build = [string]$context.platform.build
    architecture = [string]$context.platform.architecture
  }
  profiles = $profiles
  privacy = [ordered]@{
    containsPrivatePaths = $false
    containsUsernames = $false
    containsPromptsOrResponses = $false
    containsWorkspaceIdentifiers = $false
    containsKeysOrEvidence = $false
  }
  limitations = @(
    'unsigned-candidate'
    'no-official-release'
    'no-update-channel'
    'single-windows-host'
    'historical-fixture-local-only'
  )
}

$reportPath = Join-Path $acceptance 'METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json'
Write-MetroraUtf8Json $reportPath $report
$verification = (& node (Join-Path $repository 'scripts\verify-windows-physical-acceptance-report.mjs') `
  $reportPath `
  --expected-commit $context.source.commit 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $reportPath -Force -ErrorAction SilentlyContinue
  throw "physical acceptance report verification failed: $verification"
}
Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

[ordered]@{
  status = Get-MetroraPhysicalOverallStatus $profiles
  sourceCommit = $context.source.commit
  productVersion = $context.candidate.productVersion
  existingProfile = $profiles.existing.status
  cleanProfile = $profiles.clean.status
  migrationProfile = $profiles.migration.status
  reportVerified = $true
  privateDataIncluded = $false
} | ConvertTo-Json -Compress
