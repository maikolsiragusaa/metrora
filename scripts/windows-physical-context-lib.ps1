Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-acceptance-lib.ps1')

function Assert-MetroraPhysicalContextKeys($Value, [string[]]$Expected, [string]$Label) {
  if ($null -eq $Value -or $Value -isnot [psobject]) {
    throw "$Label must be an object"
  }
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  if (($actual -join [char]0) -ne ($wanted -join [char]0)) {
    throw "$Label fields are invalid"
  }
}

function Get-MetroraPhysicalAcceptanceState([string]$AcceptanceDirectory, [string]$RepositoryRoot) {
  $acceptance = (Resolve-Path -LiteralPath $AcceptanceDirectory).Path
  $contextPath = Join-Path $acceptance 'ACCEPTANCE_CONTEXT.json'
  if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) {
    throw 'physical acceptance context is missing'
  }
  $context = Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json

  Assert-MetroraPhysicalContextKeys $context @('kind', 'version', 'source', 'candidate', 'platform', 'sentinel') 'context'
  Assert-MetroraPhysicalContextKeys $context.source @('repository', 'commit') 'context.source'
  Assert-MetroraPhysicalContextKeys $context.candidate @(
    'directory',
    'archive',
    'artifactName',
    'artifactSha256',
    'archiveEntryCount',
    'archiveUncompressedBytes',
    'productVersion',
    'releaseManifestSha256',
    'formatManifestSha256',
    'canonicalFileCount',
    'canonicalInventorySha256'
  ) 'context.candidate'
  Assert-MetroraPhysicalContextKeys $context.platform @('edition', 'version', 'build', 'architecture') 'context.platform'
  Assert-MetroraPhysicalContextKeys $context.sentinel @('file', 'sha256') 'context.sentinel'

  if (
    $context.kind -ne 'metrora.windows-physical-acceptance-context' -or
    $context.version -ne 1 -or
    $context.source.repository -ne 'maikolsiragusaa/metrora' -or
    $context.source.commit -notmatch '^[a-f0-9]{40}$' -or
    $context.candidate.directory -ne 'downloaded-candidate' -or
    $context.candidate.archive -ne 'declared-artifact.zip' -or
    $context.sentinel.file -ne 'METRORA-PHYSICAL-ACCEPTANCE-SENTINEL.bin'
  ) {
    throw 'physical acceptance context authority is invalid'
  }
  foreach ($digest in @(
    $context.candidate.artifactSha256,
    $context.candidate.releaseManifestSha256,
    $context.candidate.formatManifestSha256,
    $context.candidate.canonicalInventorySha256,
    $context.sentinel.sha256
  )) {
    if ($digest -notmatch '^[a-f0-9]{64}$') {
      throw 'physical acceptance context contains an invalid digest'
    }
  }
  if (
    $context.candidate.productVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' -or
    $context.candidate.canonicalFileCount -lt 1 -or
    $context.candidate.archiveEntryCount -lt 1 -or
    $context.candidate.archiveUncompressedBytes -lt 1
  ) {
    throw 'physical acceptance context contains invalid candidate metadata'
  }

  $repository = Assert-MetroraPhysicalRepositoryAuthority $RepositoryRoot ([string]$context.source.commit)
  $archive = (Resolve-Path -LiteralPath (Join-Path $acceptance $context.candidate.archive)).Path
  $candidate = (Resolve-Path -LiteralPath (Join-Path $acceptance $context.candidate.directory)).Path
  $canonical = (Resolve-Path -LiteralPath (Join-Path $acceptance 'canonical-payload')).Path
  $sentinelPath = Join-Path $acceptance $context.sentinel.file

  if ((Get-MetroraFileSha256 $archive) -ne $context.candidate.artifactSha256) {
    throw 'physical acceptance declared artifact digest changed'
  }
  Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

  $currentPlatform = Get-MetroraWindowsPlatform
  foreach ($field in @('edition', 'version', 'build', 'architecture')) {
    if ([string]$currentPlatform[$field] -ne [string]$context.platform.$field) {
      throw 'physical acceptance moved to a different Windows platform'
    }
  }

  $verificationText = (& node (Join-Path $repository 'scripts\verify-windows-physical-candidate-state.mjs') `
    $candidate `
    --canonical $canonical `
    --expected-commit $context.source.commit `
    --repository-root $repository 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "prepared physical candidate state verification failed: $verificationText"
  }
  $verification = $verificationText | ConvertFrom-Json
  if (
    $verification.status -ne 'pass' -or
    $verification.sourceCommit -ne $context.source.commit -or
    $verification.productVersion -ne $context.candidate.productVersion -or
    $verification.releaseManifestSha256 -ne $context.candidate.releaseManifestSha256 -or
    $verification.formatManifestSha256 -ne $context.candidate.formatManifestSha256 -or
    $verification.canonicalFileCount -ne $context.candidate.canonicalFileCount -or
    $verification.canonicalInventorySha256 -ne $context.candidate.canonicalInventorySha256
  ) {
    throw 'prepared physical candidate state contradicts its context'
  }

  return [pscustomobject]@{
    Acceptance = $acceptance
    Repository = $repository
    Archive = $archive
    Candidate = $candidate
    Canonical = $canonical
    SentinelPath = $sentinelPath
    Context = $context
  }
}
