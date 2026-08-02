param(
  [Parameter(Mandatory = $true)]
  [string]$AcceptanceDirectory,

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-acceptance-lib.ps1')

$acceptance = (Resolve-Path -LiteralPath $AcceptanceDirectory).Path
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
$sentinelPath = Join-Path $acceptance $context.sentinel.file
Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

$verificationText = (& node (Join-Path $repository 'scripts\verify-windows-candidate-layout.mjs') `
  $candidate `
  --expected-commit $context.source.commit 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "existing-profile portable verification failed: $verificationText"
}

$markerPath = Join-Path $acceptance 'P1_PORTABLE_LAUNCH.json'
$priorLaunchCount = 0
if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
  $prior = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
  if (
    $prior.status -ne 'pass' -or
    $prior.sourceCommit -ne $context.source.commit -or
    $prior.productVersion -ne $context.candidate.productVersion -or
    -not $prior.portableVerified -or
    -not $prior.sentinelPreserved -or
    -not [int]::TryParse([string]$prior.launchCount, [ref]$priorLaunchCount) -or
    $priorLaunchCount -lt 1 -or
    $priorLaunchCount -gt 9
  ) {
    throw 'existing-profile launch marker is invalid'
  }
}

$executable = Join-Path $candidate 'portable\Metrora.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw 'verified physical candidate portable executable is missing'
}
if (@(Get-Process -Name 'Metrora' -ErrorAction SilentlyContinue).Count -gt 0) {
  throw 'close every running Metrora process before starting a physical portable launch'
}

$process = Start-Process -FilePath $executable -PassThru -Wait
if ($process.ExitCode -ne 0) {
  throw "physical existing-profile portable exited with code $($process.ExitCode)"
}
Start-Sleep -Seconds 1
if (@(Get-Process -Name 'Metrora' -ErrorAction SilentlyContinue).Count -gt 0) {
  throw 'a Metrora process remained after the verified portable was closed'
}
Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

$marker = [ordered]@{
  status = 'pass'
  sourceCommit = [string]$context.source.commit
  productVersion = [string]$context.candidate.productVersion
  portableVerified = $true
  launchCount = $priorLaunchCount + 1
  sentinelPreserved = $true
}
Write-MetroraUtf8Json $markerPath $marker
$marker | ConvertTo-Json -Compress
