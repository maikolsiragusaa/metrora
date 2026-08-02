param(
  [Parameter(Mandatory = $true)]
  [string]$AcceptanceDirectory,

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-acceptance-lib.ps1')

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$acceptance = (Resolve-Path -LiteralPath $AcceptanceDirectory).Path
$context = Get-Content -LiteralPath (Join-Path $acceptance 'ACCEPTANCE_CONTEXT.json') -Raw | ConvertFrom-Json
if (
  $context.kind -ne 'metrora.windows-physical-acceptance-context' -or
  $context.version -ne 1 -or
  $context.candidate.directory -ne 'downloaded-candidate'
) {
  throw 'physical acceptance context is invalid'
}

$candidate = (Resolve-Path -LiteralPath (Join-Path $acceptance $context.candidate.directory)).Path
$sentinelPath = Join-Path $acceptance $context.sentinel.file
Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

$verificationText = (& node (Join-Path $repository 'scripts\verify-windows-candidate-layout.mjs') `
  $candidate `
  --expected-commit $context.source.commit 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "existing-profile portable verification failed: $verificationText"
}

$executable = Join-Path $candidate 'portable\Metrora.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw 'verified physical candidate portable executable is missing'
}

$process = Start-Process -FilePath $executable -PassThru -Wait
if ($process.ExitCode -ne 0) {
  throw "physical existing-profile portable exited with code $($process.ExitCode)"
}
Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

$marker = [ordered]@{
  status = 'pass'
  sourceCommit = [string]$context.source.commit
  productVersion = [string]$context.candidate.productVersion
  portableVerified = $true
  launchCompleted = $true
  sentinelPreserved = $true
}
Write-MetroraUtf8Json (Join-Path $acceptance 'P1_PORTABLE_LAUNCH.json') $marker
$marker | ConvertTo-Json -Compress
