param(
  [Parameter(Mandatory = $true)]
  [string]$AcceptanceDirectory,

  [Parameter(Mandatory = $true)]
  [string]$WorkingDirectory,

  [Parameter(Mandatory = $true)]
  [switch]$DedicatedProfileAcknowledged,

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-acceptance-lib.ps1')

if (-not $DedicatedProfileAcknowledged) {
  throw 'P3 requires an explicitly acknowledged dedicated Windows user profile'
}

$baselineCommit = '169992beef06f1f4cddc5dba6bce3b8991ce9fd4'
$baselineVersion = '0.9.18'
$acceptance = (Resolve-Path -LiteralPath $AcceptanceDirectory).Path
$canonical = (Resolve-Path -LiteralPath (Join-Path $acceptance 'canonical-payload')).Path
$context = Get-Content -LiteralPath (Join-Path $acceptance 'ACCEPTANCE_CONTEXT.json') -Raw | ConvertFrom-Json
if (
  $context.kind -ne 'metrora.windows-physical-acceptance-context' -or
  $context.version -ne 1 -or
  $context.candidate.directory -ne 'downloaded-candidate'
) {
  throw 'physical acceptance context is invalid'
}
$repository = Assert-MetroraPhysicalRepositoryAuthority $RepositoryRoot ([string]$context.source.commit)
$candidate = (Resolve-Path -LiteralPath (Join-Path $acceptance $context.candidate.directory)).Path

& git -C $repository cat-file -e "$baselineCommit`^{commit}"
if ($LASTEXITCODE -ne 0) {
  throw 'historical migration baseline commit is unavailable locally'
}

$sentinelPath = Join-Path $acceptance $context.sentinel.file
Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

$working = [IO.Path]::GetFullPath($WorkingDirectory)
if ($working.Contains(' ')) {
  throw 'physical migration working directory must not contain spaces'
}
if (Test-Path -LiteralPath $working) {
  $existing = @(Get-ChildItem -LiteralPath $working -Force -ErrorAction Stop)
  if ($existing.Count -gt 0) {
    throw 'physical migration working directory must be absent or empty'
  }
}
New-Item -ItemType Directory -Path $working -Force | Out-Null
$baseline = Join-Path $working 'migration-baseline'
$originalRunnerTemp = $env:RUNNER_TEMP
$result = $null
$worktreeAdded = $false

try {
  & git -C $repository worktree add --detach $baseline $baselineCommit
  if ($LASTEXITCODE -ne 0) { throw 'failed to create isolated historical worktree' }
  $worktreeAdded = $true

  & node (Join-Path $repository 'scripts\prepare-windows-migration-fixture.mjs') `
    --repository $baseline `
    --version $baselineVersion
  if ($LASTEXITCODE -ne 0) { throw 'failed to prepare historical migration fixture' }

  & npm.cmd --prefix $baseline ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'historical root dependency installation failed' }
  & npm.cmd --prefix (Join-Path $baseline 'app') ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'historical desktop dependency installation failed' }

  & npm.cmd --prefix (Join-Path $baseline 'app') run stage-cli
  if ($LASTEXITCODE -ne 0) { throw 'historical CLI staging failed' }
  & npm.cmd --prefix (Join-Path $baseline 'app') run build
  if ($LASTEXITCODE -ne 0) { throw 'historical desktop build failed' }

  Push-Location (Join-Path $baseline 'app')
  try {
    & npx.cmd --no-install electron-builder --win --x64 --dir --publish never
    if ($LASTEXITCODE -ne 0) { throw 'historical canonical payload build failed' }
  } finally {
    Pop-Location
  }

  $baselineInstallerDirectory = Join-Path $baseline 'app\release\migration-installer'
  & (Join-Path $repository 'scripts\Build-Metrora-Windows-Installer.ps1') `
    -AppDirectory (Join-Path $baseline 'app') `
    -CanonicalPayloadDirectory (Join-Path $baseline 'app\release\win-unpacked') `
    -OutputDirectory $baselineInstallerDirectory `
    -ExpectedVersion $baselineVersion `
    -RepositoryRoot $repository
  if ($LASTEXITCODE -ne 0) { throw 'historical installer build failed' }

  $env:RUNNER_TEMP = $working
  $migrationText = (& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
    -File (Join-Path $repository 'scripts\Test-Metrora-Windows-Migration.ps1') `
    -BaselineInstaller (Join-Path $baselineInstallerDirectory "Metrora-Setup-$baselineVersion.exe") `
    -BaselinePayloadDirectory (Join-Path $baseline 'app\release\win-unpacked') `
    -CandidateDirectory $candidate `
    -CandidatePayloadDirectory $canonical `
    -RepositoryRoot $repository `
    -BaselineVersion $baselineVersion `
    -CandidateVersion $context.candidate.productVersion 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "physical migration lifecycle failed: $migrationText" }
  $jsonLines = @($migrationText -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') })
  if ($jsonLines.Count -eq 0) {
    throw 'physical migration lifecycle returned no result object'
  }
  $migration = $jsonLines[-1] | ConvertFrom-Json
  if ($migration.status -ne 'pass' -or -not $migration.userOwnedStatePreserved) {
    throw 'physical migration lifecycle returned an invalid result'
  }
  Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256
  $result = [ordered]@{
    status = 'pass'
    transitions = @($migration.transitions)
    sentinelPreserved = $true
    fixtureRemoved = $false
  }
}
finally {
  $env:RUNNER_TEMP = $originalRunnerTemp
  if ($worktreeAdded) {
    & git -C $repository worktree remove --force $baseline 2>$null
    & git -C $repository worktree prune 2>$null
  }
  Remove-Item -LiteralPath $working -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $working) {
  throw 'historical physical migration fixture was not removed'
}
Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256
$result.fixtureRemoved = $true
$resultPath = Join-Path $acceptance 'P3_MIGRATION_RESULT.json'
Write-MetroraUtf8Json $resultPath $result
$result | ConvertTo-Json -Compress
