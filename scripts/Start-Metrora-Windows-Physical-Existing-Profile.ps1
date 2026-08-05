param(
  [Parameter(Mandatory = $true)]
  [string]$AcceptanceDirectory,

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-context-lib.ps1')

$state = Get-MetroraPhysicalAcceptanceState $AcceptanceDirectory $RepositoryRoot
$acceptance = $state.Acceptance
$context = $state.Context
$candidate = $state.Candidate
$sentinelPath = $state.SentinelPath

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
