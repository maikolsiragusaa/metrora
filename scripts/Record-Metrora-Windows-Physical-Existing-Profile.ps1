param(
  [Parameter(Mandatory = $true)]
  [string]$AcceptanceDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-acceptance-lib.ps1')

$acceptance = (Resolve-Path -LiteralPath $AcceptanceDirectory).Path
$context = Get-Content -LiteralPath (Join-Path $acceptance 'ACCEPTANCE_CONTEXT.json') -Raw | ConvertFrom-Json
if ($context.kind -ne 'metrora.windows-physical-acceptance-context' -or $context.version -ne 1) {
  throw 'physical acceptance context is invalid'
}
$sentinelPath = Join-Path $acceptance $context.sentinel.file
Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

$status = Read-MetroraAcceptanceChoice 'P1 existing-profile result' @('pass', 'fail', 'not-run')
if ($status -eq 'not-run') {
  $result = (New-MetroraNotRunProfiles).existing
} else {
  $result = [ordered]@{
    status = $status
    portableVerified = Read-MetroraAcceptanceBoolean 'Was the exact downloaded portable candidate verified before launch?'
    identityPreserved = Read-MetroraAcceptanceBoolean 'Was the existing endpoint identity preserved?'
    workspacePreserved = Read-MetroraAcceptanceBoolean 'Was the existing Workspace binding preserved?'
    lifecyclePreserved = Read-MetroraAcceptanceBoolean 'Was the production lifecycle state preserved?'
    evidencePreserved = Read-MetroraAcceptanceBoolean 'Was the existing signed/exportable evidence state preserved?'
    reopenPassed = Read-MetroraAcceptanceBoolean 'Did close and reopen preserve the accepted state?'
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
