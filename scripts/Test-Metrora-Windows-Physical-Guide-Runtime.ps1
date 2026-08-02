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

function Assert-Throws([scriptblock]$Action, [string]$Message) {
  $threw = $false
  try { & $Action } catch { $threw = $true }
  if (-not $threw) { throw "$Message`: expected an exception" }
}

$root = Join-Path $env:RUNNER_TEMP "metrora-physical-guide-$PID"
$acceptance = Join-Path $root 'acceptance'
$failedAcceptance = Join-Path $root 'failed'
$invalidAcceptance = Join-Path $root 'invalid'
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
  $differentFingerprint = 'f' * 64
  if ($differentFingerprint -eq $fingerprint) { $differentFingerprint = 'e' * 64 }

  Assert-MetroraGuideProfileRole $fingerprint 'primary' $fingerprint | Out-Null
  Assert-MetroraGuideProfileRole $fingerprint 'dedicated' $differentFingerprint | Out-Null
  Assert-Throws { Assert-MetroraGuideProfileRole $fingerprint 'dedicated' $fingerprint | Out-Null } 'same profile dedicated refusal'
  Assert-Throws { Assert-MetroraGuideProfileRole $fingerprint 'primary' $differentFingerprint | Out-Null } 'different profile primary refusal'

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
  $continuationScript = Join-Path $acceptance 'CONTINUA-TEST-METRORA.ps1'
  if (-not (Test-Path -LiteralPath $continuationScript -PathType Leaf)) {
    throw 'continuation PowerShell script was not created'
  }
  $cmdText = Get-Content -LiteralPath $continuation -Raw
  if ($cmdText -notmatch 'CONTINUA-TEST-METRORA\.ps1' -or $cmdText -notmatch 'exit /b %EXITCODE%') {
    throw 'continuation CMD content is invalid'
  }

  New-Item -ItemType Directory -Path $failedAcceptance -Force | Out-Null
  Write-TestJson (Join-Path $failedAcceptance 'ACCEPTANCE_CONTEXT.json') ([ordered]@{ kind = 'test' })
  Write-TestJson (Join-Path $failedAcceptance 'P1_EXISTING_RESULT.json') ([ordered]@{ status = 'fail' })
  Assert-Equal (Get-MetroraPhysicalGuidePhase $failedAcceptance) 'stopped' 'failed phase'

  New-Item -ItemType Directory -Path $invalidAcceptance -Force | Out-Null
  Write-TestJson (Join-Path $invalidAcceptance 'ACCEPTANCE_CONTEXT.json') ([ordered]@{ kind = 'test' })
  Write-TestJson (Join-Path $invalidAcceptance 'P1_EXISTING_RESULT.json') ([ordered]@{ status = 'unknown' })
  Assert-Throws { Get-MetroraPhysicalGuidePhase $invalidAcceptance | Out-Null } 'unknown status refusal'

  Write-Host 'Physical acceptance guide runtime verified.'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
