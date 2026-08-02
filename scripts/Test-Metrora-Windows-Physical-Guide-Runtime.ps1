param(
  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
. (Join-Path $repository 'scripts\windows-physical-guide-lib.ps1')

function Write-TestJson([string]$Path, $Value) {
  $json = "$($Value | ConvertTo-Json -Depth 8)`n"
  [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -ne $Expected) {
    throw "$Message`: expected '$Expected', found '$Actual'"
  }
}

$root = Join-Path $env:RUNNER_TEMP "metrora-physical-guide-$PID"
$acceptance = Join-Path $root 'acceptance'
$failedAcceptance = Join-Path $root 'failed'
$commit = '0123456789abcdef0123456789abcdef01234567'

try {
  Assert-Equal (Get-MetroraPhysicalGuidePhase $acceptance) 'prepare' 'empty phase'

  New-Item -ItemType Directory -Path $acceptance -Force | Out-Null
  Write-TestJson (Join-Path $acceptance 'ACCEPTANCE_CONTEXT.json') ([ordered]@{ kind = 'test' })
  Assert-Equal (Get-MetroraPhysicalGuidePhase $acceptance) 'p1' 'prepared phase'

  $fingerprint = Get-MetroraCurrentProfileFingerprint
  if ($fingerprint -notmatch '^[a-f0-9]{64}$') {
    throw 'current profile fingerprint is invalid'
  }
  Write-MetroraGuideLocalState $acceptance $commit $fingerprint | Out-Null
  $state = Read-MetroraGuideLocalState $acceptance $commit
  Assert-Equal ([string]$state.primaryProfileFingerprint) $fingerprint 'guide state fingerprint'

  Write-TestJson (Join-Path $acceptance 'P1_EXISTING_RESULT.json') ([ordered]@{ status = 'pass' })
  Assert-Equal (Get-MetroraPhysicalGuidePhase $acceptance) 'dedicated' 'P1 phase'

  Write-TestJson (Join-Path $acceptance 'P2_CLEAN_RESULT.json') ([ordered]@{ status = 'pass' })
  Write-TestJson (Join-Path $acceptance 'P3_MIGRATION_RESULT.json') ([ordered]@{ status = 'pass' })
  Assert-Equal (Get-MetroraPhysicalGuidePhase $acceptance) 'finalize' 'completed profile phase'

  Write-TestJson (Join-Path $acceptance 'METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json') ([ordered]@{ status = 'pass' })
  Assert-Equal (Get-MetroraPhysicalGuidePhase $acceptance) 'complete' 'final report phase'

  $continuation = Write-MetroraGuideContinuation $acceptance $repository
  if (-not (Test-Path -LiteralPath $continuation -PathType Leaf)) {
    throw 'continuation CMD was not created'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $acceptance 'CONTINUA-TEST-METRORA.ps1') -PathType Leaf)) {
    throw 'continuation PowerShell script was not created'
  }

  New-Item -ItemType Directory -Path $failedAcceptance -Force | Out-Null
  Write-TestJson (Join-Path $failedAcceptance 'ACCEPTANCE_CONTEXT.json') ([ordered]@{ kind = 'test' })
  Write-TestJson (Join-Path $failedAcceptance 'P1_EXISTING_RESULT.json') ([ordered]@{ status = 'fail' })
  Assert-Equal (Get-MetroraPhysicalGuidePhase $failedAcceptance) 'stopped' 'failed phase'

  Write-Host 'Physical acceptance guide runtime verified.'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
