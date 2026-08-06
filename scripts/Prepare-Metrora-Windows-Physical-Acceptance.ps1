param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactArchive,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedCommit,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-context-lib.ps1')
. (Join-Path $PSScriptRoot 'windows-physical-artifact-lib.ps1')

$migrationBaselineCommit = '80c3a5a1a116a0bc2fd5352b9fee2afc58207f15'
$migrationBaselineVersion = '0.9.19'
$migrationBaselineFileVersion = '0.9.19'

if ($ExpectedCommit -notmatch '^[a-f0-9]{40}$') {
  throw 'ExpectedCommit must be a full lowercase Git SHA-1'
}
$repository = Assert-MetroraPhysicalRepositoryAuthority $RepositoryRoot $ExpectedCommit

& git -C $repository cat-file -e "$migrationBaselineCommit`^{commit}"
if ($LASTEXITCODE -ne 0) {
  throw 'physical migration baseline commit is unavailable locally'
}

$archive = (Resolve-Path -LiteralPath $ArtifactArchive).Path
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
  throw 'ArtifactArchive must be a file'
}

$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) {
  $existing = @(Get-ChildItem -LiteralPath $output -Force -ErrorAction Stop)
  if ($existing.Count -gt 0) {
    throw 'physical acceptance output directory must be absent or empty'
  }
}
New-Item -ItemType Directory -Path $output -Force | Out-Null

$artifactName = [IO.Path]::GetFileName($archive)
$artifactSha256 = Get-MetroraFileSha256 $archive
$declaredArchiveName = 'declared-artifact.zip'
$declaredArchive = Join-Path $output $declaredArchiveName
Copy-Item -LiteralPath $archive -Destination $declaredArchive -Force
if ((Get-MetroraFileSha256 $declaredArchive) -ne $artifactSha256) {
  throw 'copied physical artifact digest does not match the downloaded ZIP'
}

$candidate = Join-Path $output 'downloaded-candidate'
$extraction = Expand-MetroraBoundedArtifactArchive $declaredArchive $candidate
$canonical = Join-Path $output 'canonical-payload'
$preparationText = (& node (Join-Path $repository 'scripts\prepare-windows-physical-candidate.mjs') `
  $candidate `
  --output $canonical `
  --expected-commit $ExpectedCommit `
  --repository-root $repository 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "physical candidate preparation failed: $preparationText"
}
$preparation = $preparationText | ConvertFrom-Json
if ($preparation.status -ne 'pass' -or $preparation.sourceCommit -ne $ExpectedCommit) {
  throw 'physical candidate preparation returned an invalid authority'
}
if ([string]$preparation.productVersion -eq $migrationBaselineVersion) {
  throw 'physical candidate version must differ from the migration baseline version'
}

$candidateFileVersion = (& node (Join-Path $repository 'scripts\resolve-metrora-build-version.mjs') `
  $preparation.productVersion 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $candidateFileVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?$') {
  throw 'physical candidate file version could not be resolved from version authority'
}
if ($candidateFileVersion -eq $migrationBaselineFileVersion) {
  throw 'physical candidate file version must differ from the migration baseline file version'
}

$platform = Get-MetroraWindowsPlatform
if ($platform.architecture -ne 'x64') {
  throw "physical acceptance requires Windows x64, found $($platform.architecture)"
}

$sentinelName = 'METRORA-PHYSICAL-ACCEPTANCE-SENTINEL.bin'
$sentinelPath = Join-Path $output $sentinelName
$sentinelBytes = [byte[]]::new(64)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $rng.GetBytes($sentinelBytes)
} finally {
  $rng.Dispose()
}
[IO.File]::WriteAllBytes($sentinelPath, $sentinelBytes)
$sentinelSha256 = Get-MetroraFileSha256 $sentinelPath

$context = [ordered]@{
  kind = 'metrora.windows-physical-acceptance-context'
  version = 2
  source = [ordered]@{
    repository = 'maikolsiragusaa/metrora'
    commit = $ExpectedCommit
  }
  migrationBaseline = [ordered]@{
    commit = $migrationBaselineCommit
    productVersion = $migrationBaselineVersion
    fileVersion = $migrationBaselineFileVersion
  }
  candidate = [ordered]@{
    directory = 'downloaded-candidate'
    archive = $declaredArchiveName
    artifactName = $artifactName
    artifactSha256 = $artifactSha256
    archiveEntryCount = [int]$extraction.EntryCount
    archiveUncompressedBytes = [int64]$extraction.UncompressedBytes
    productVersion = [string]$preparation.productVersion
    fileVersion = $candidateFileVersion
    releaseManifestSha256 = [string]$preparation.releaseManifestSha256
    formatManifestSha256 = [string]$preparation.formatManifestSha256
    canonicalFileCount = [int]$preparation.canonicalFileCount
    canonicalInventorySha256 = [string]$preparation.canonicalInventorySha256
  }
  platform = $platform
  sentinel = [ordered]@{
    file = $sentinelName
    sha256 = $sentinelSha256
  }
}
$contextPath = Join-Path $output 'ACCEPTANCE_CONTEXT.json'
Write-MetroraUtf8Json $contextPath $context
Get-MetroraPhysicalAcceptanceState $output $repository | Out-Null

$report = [ordered]@{
  kind = 'metrora.windows-physical-acceptance-report'
  version = 2
  generatedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  source = $context.source
  migrationBaseline = $context.migrationBaseline
  candidate = [ordered]@{
    artifactName = $context.candidate.artifactName
    artifactSha256 = $context.candidate.artifactSha256
    productVersion = $context.candidate.productVersion
    fileVersion = $context.candidate.fileVersion
    releaseManifestSha256 = $context.candidate.releaseManifestSha256
    formatManifestSha256 = $context.candidate.formatManifestSha256
  }
  platform = $context.platform
  profiles = New-MetroraNotRunProfiles
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
$draftPath = Join-Path $output 'PHYSICAL_ACCEPTANCE_REPORT.draft.json'
Write-MetroraUtf8Json $draftPath $report

$verification = (& node (Join-Path $repository 'scripts\verify-windows-physical-acceptance-report.mjs') `
  $draftPath `
  --expected-commit $ExpectedCommit 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "physical acceptance draft verification failed: $verification"
}

[ordered]@{
  status = 'prepared'
  sourceCommit = $ExpectedCommit
  migrationBaselineVersion = $migrationBaselineVersion
  productVersion = $context.candidate.productVersion
  canonicalFileCount = $context.candidate.canonicalFileCount
  archiveEntryCount = $context.candidate.archiveEntryCount
  artifactSha256 = $artifactSha256
  sentinelSha256 = $sentinelSha256
  next = 'Use only the prepared acceptance workspace for P1, P2 and P3.'
} | ConvertTo-Json -Compress
