param(
  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-acceptance-lib.ps1')
. (Join-Path $PSScriptRoot 'windows-physical-artifact-lib.ps1')

function Add-TestZipEntry($Archive, [string]$Name, [string]$Content) {
  $entry = $Archive.CreateEntry($Name)
  $stream = $entry.Open()
  $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
  try {
    $writer.Write($Content)
  } finally {
    $writer.Dispose()
  }
}

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$rootBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$root = Join-Path $rootBase "metrora-physical-report-runtime-$PID"
New-Item -ItemType Directory -Path $root -Force | Out-Null

try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $validArchivePath = Join-Path $root 'valid-artifact.zip'
  $validArchive = [IO.Compression.ZipFile]::Open($validArchivePath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    Add-TestZipEntry $validArchive 'portable/Metrora.exe' 'bounded-payload'
  } finally {
    $validArchive.Dispose()
  }
  $validDestination = Join-Path $root 'valid-extraction'
  $validExtraction = Expand-MetroraBoundedArtifactArchive $validArchivePath $validDestination
  if (
    $validExtraction.EntryCount -ne 1 -or
    (Get-Content -LiteralPath (Join-Path $validDestination 'portable\Metrora.exe') -Raw) -ne 'bounded-payload'
  ) {
    throw 'bounded artifact extraction did not preserve the valid archive entry'
  }

  $maliciousArchivePath = Join-Path $root 'malicious-artifact.zip'
  $maliciousArchive = [IO.Compression.ZipFile]::Open($maliciousArchivePath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    Add-TestZipEntry $maliciousArchive '../escape.txt' 'must-not-escape'
  } finally {
    $maliciousArchive.Dispose()
  }
  $maliciousRejected = $false
  try {
    Expand-MetroraBoundedArtifactArchive $maliciousArchivePath (Join-Path $root 'malicious-extraction') | Out-Null
  } catch {
    $maliciousRejected = $true
  }
  if (-not $maliciousRejected -or (Test-Path -LiteralPath (Join-Path $root 'escape.txt'))) {
    throw 'bounded artifact extraction did not reject traversal'
  }

  $commit = (& git -C $repository rev-parse HEAD 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') {
    throw 'unable to resolve runtime report source commit'
  }
  Assert-MetroraPhysicalRepositoryAuthority $repository $commit | Out-Null

  $digest = 'a' * 64
  $sentinelPath = Join-Path $root 'METRORA-PHYSICAL-ACCEPTANCE-SENTINEL.bin'
  [IO.File]::WriteAllBytes($sentinelPath, [Text.Encoding]::UTF8.GetBytes('physical-runtime-sentinel'))
  $sentinelDigest = Get-MetroraFileSha256 $sentinelPath
  Assert-MetroraPhysicalSentinel $sentinelPath $sentinelDigest

  $report = [ordered]@{
    kind = 'metrora.windows-physical-acceptance-report'
    version = 2
    generatedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    source = [ordered]@{
      repository = 'maikolsiragusaa/metrora'
      commit = $commit
    }
    migrationBaseline = [ordered]@{
      commit = '80c3a5a1a116a0bc2fd5352b9fee2afc58207f15'
      productVersion = '0.9.19'
    }
    candidate = [ordered]@{
      artifactName = "metrora-windows-candidate-$commit.zip"
      artifactSha256 = $digest
      productVersion = '1.0.0-rc.7'
      releaseManifestSha256 = $digest
      formatManifestSha256 = $digest
    }
    platform = Get-MetroraWindowsPlatform
    profiles = [ordered]@{
      existing = [ordered]@{
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
      }
      clean = [ordered]@{
        status = 'pass'
        registrationCount = 1
        shortcutCount = 1
        cliVersion = '1.0.0-rc.7'
        firstLaunchPassed = $true
        uninstallPassed = $true
        sentinelPreserved = $true
      }
      migration = [ordered]@{
        status = 'pass'
        transitions = @(
          'installed-0.9.19'
          'upgraded-1.0.0-rc.7'
          'reinstalled-1.0.0-rc.7'
          'uninstalled-for-rollback'
          'rolled-back-0.9.19'
          're-upgraded-1.0.0-rc.7'
          'uninstalled'
        )
        sentinelPreserved = $true
        fixtureRemoved = $true
      }
    }
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
  $reportPath = Join-Path $root 'METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json'
  Write-MetroraUtf8Json $reportPath $report
  $verification = (& node (Join-Path $repository 'scripts\verify-windows-physical-acceptance-report.mjs') `
    $reportPath `
    --expected-commit $commit 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "physical runtime report verification failed: $verification"
  }

  [IO.File]::WriteAllBytes($sentinelPath, [Text.Encoding]::UTF8.GetBytes('mutated'))
  $sentinelRejected = $false
  try {
    Assert-MetroraPhysicalSentinel $sentinelPath $sentinelDigest
  } catch {
    $sentinelRejected = $true
  }
  if (-not $sentinelRejected) {
    throw 'physical sentinel mutation was not rejected'
  }

  [ordered]@{
    status = 'pass'
    validArchiveExtracted = $true
    traversalArchiveRejected = $true
    repositoryAuthorityVerified = $true
    reportVerified = $true
    sentinelMutationRejected = $true
    privateDataIncluded = $false
  } | ConvertTo-Json -Compress
}
finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
