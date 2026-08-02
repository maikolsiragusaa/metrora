param(
  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-acceptance-lib.ps1')

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$rootBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$root = Join-Path $rootBase "metrora-physical-report-runtime-$PID"
New-Item -ItemType Directory -Path $root -Force | Out-Null

try {
  $commit = (& git -C $repository rev-parse HEAD 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') {
    throw 'unable to resolve runtime report source commit'
  }
  $digest = 'a' * 64
  $sentinelName = 'METRORA-PHYSICAL-ACCEPTANCE-SENTINEL.bin'
  $sentinelPath = Join-Path $root $sentinelName
  [IO.File]::WriteAllBytes($sentinelPath, [Text.Encoding]::UTF8.GetBytes('physical-runtime-sentinel'))
  $sentinelDigest = Get-MetroraFileSha256 $sentinelPath

  $context = [ordered]@{
    kind = 'metrora.windows-physical-acceptance-context'
    version = 1
    source = [ordered]@{
      repository = 'maikolsiragusaa/metrora'
      commit = $commit
    }
    candidate = [ordered]@{
      artifactName = "metrora-windows-candidate-$commit.zip"
      artifactSha256 = $digest
      productVersion = '0.9.19'
      releaseManifestSha256 = $digest
      formatManifestSha256 = $digest
      canonicalFileCount = 1
      canonicalInventorySha256 = $digest
    }
    platform = Get-MetroraWindowsPlatform
    sentinel = [ordered]@{
      file = $sentinelName
      sha256 = $sentinelDigest
    }
  }
  Write-MetroraUtf8Json (Join-Path $root 'ACCEPTANCE_CONTEXT.json') $context

  Write-MetroraUtf8Json (Join-Path $root 'P1_EXISTING_RESULT.json') ([ordered]@{
    status = 'pass'
    portableVerified = $true
    identityPreserved = $true
    workspacePreserved = $true
    lifecyclePreserved = $true
    evidencePreserved = $true
    reopenPassed = $true
    recoveryMode = 'not-required'
    duplicateProductionCount = 0
    duplicateBatchCount = 0
    invalidCount = 0
    quarantinedCount = 0
  })
  Write-MetroraUtf8Json (Join-Path $root 'P2_CLEAN_RESULT.json') ([ordered]@{
    status = 'pass'
    registrationCount = 1
    shortcutCount = 1
    cliVersion = '0.9.19'
    firstLaunchPassed = $true
    uninstallPassed = $true
    sentinelPreserved = $true
  })
  Write-MetroraUtf8Json (Join-Path $root 'P3_MIGRATION_RESULT.json') ([ordered]@{
    status = 'pass'
    transitions = @(
      'installed-0.9.18'
      'upgraded-0.9.19'
      'reinstalled-0.9.19'
      'uninstalled-for-rollback'
      'rolled-back-0.9.18'
      're-upgraded-0.9.19'
      'uninstalled'
    )
    sentinelPreserved = $true
    fixtureRemoved = $true
  })

  $completionText = (& (Join-Path $repository 'scripts\Complete-Metrora-Windows-Physical-Acceptance.ps1') `
    -AcceptanceDirectory $root `
    -RepositoryRoot $repository 2>&1 | Out-String).Trim()
  $completion = $completionText | ConvertFrom-Json
  if ($completion.status -ne 'pass' -or -not $completion.reportVerified) {
    throw 'physical report runtime did not produce a verified PASS'
  }
  $reportPath = Join-Path $root 'METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json'
  if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) {
    throw 'physical report runtime did not write its final report'
  }

  [IO.File]::WriteAllBytes($sentinelPath, [Text.Encoding]::UTF8.GetBytes('mutated'))
  $rejected = $false
  try {
    Assert-MetroraPhysicalSentinel $sentinelPath $sentinelDigest
  } catch {
    $rejected = $true
  }
  if (-not $rejected) {
    throw 'physical sentinel mutation was not rejected'
  }

  [ordered]@{
    status = 'pass'
    reportVerified = $true
    sentinelMutationRejected = $true
    privateDataIncluded = $false
  } | ConvertTo-Json -Compress
}
finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
