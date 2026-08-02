param(
  [Parameter(Mandatory = $true)]
  [string]$AcceptanceDirectory
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
$sentinelPath = Join-Path $acceptance $context.sentinel.file
Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

$markerPath = Join-Path $acceptance 'P1_PORTABLE_LAUNCH.json'
$portableVerified = $false
$verifiedReopen = $false
if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
  $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
  $launchCount = 0
  $portableVerified = (
    $marker.status -eq 'pass' -and
    $marker.sourceCommit -eq $context.source.commit -and
    $marker.productVersion -eq $context.candidate.productVersion -and
    $marker.portableVerified -eq $true -and
    $marker.sentinelPreserved -eq $true -and
    [int]::TryParse([string]$marker.launchCount, [ref]$launchCount) -and
    $launchCount -ge 1
  )
  $verifiedReopen = $portableVerified -and $launchCount -ge 2
}

$status = Read-MetroraAcceptanceChoice 'P1 existing-profile result' @('pass', 'fail', 'not-run')
if ($status -eq 'not-run') {
  $result = (New-MetroraNotRunProfiles).existing
} else {
  if ($status -eq 'pass' -and (-not $portableVerified -or -not $verifiedReopen)) {
    throw 'P1 PASS requires two launches through the verified portable launcher'
  }
  $result = [ordered]@{
    status = $status
    portableVerified = $portableVerified
    identityPreserved = Read-MetroraAcceptanceBoolean 'Was the existing endpoint identity preserved?'
    workspacePreserved = Read-MetroraAcceptanceBoolean 'Was the existing Workspace binding preserved?'
    lifecyclePreserved = Read-MetroraAcceptanceBoolean 'Was the production lifecycle state preserved?'
    evidencePreserved = Read-MetroraAcceptanceBoolean 'Was the existing signed/exportable evidence state preserved?'
    reopenPassed = if ($verifiedReopen) {
      Read-MetroraAcceptanceBoolean 'Did the second verified launch preserve the accepted state?'
    } else {
      $false
    }
    recoveryMode = Read-MetroraAcceptanceChoice 'How was recovery handled?' @('not-required', 'explicit-only', 'failed')
    duplicateProductionCount = Read-MetroraAcceptanceCount 'Duplicate production count observed'
    duplicateBatchCount = Read-MetroraAcceptanceCount 'Duplicate signed-batch count observed'
    invalidCount = Read-MetroraAcceptanceCount 'Invalid evidence record count observed'
    quarantinedCount = Read-MetroraAcceptanceCount 'Quarantined evidence record count observed'
  }
}

Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256
$resultPath = Join-Path $acceptance 'P1_EXISTING_RESULT.json'
Write-MetroraUtf8Json $resultPath $result
$result | ConvertTo-Json -Compress
