Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-acceptance-lib.ps1')
. (Join-Path $PSScriptRoot 'windows-physical-artifact-lib.ps1')

function Find-MetroraStoreSignTool {
  $command = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (-not (Test-Path -LiteralPath $kitsRoot -PathType Container)) {
    throw 'Windows SDK SignTool is required for local Store package testing'
  }

  $candidates = @(Get-ChildItem -LiteralPath $kitsRoot -Directory -ErrorAction Stop |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
  if ($candidates.Count -lt 1) {
    throw 'Windows SDK SignTool x64 was not found'
  }
  return $candidates[0]
}

function Get-MetroraStoreManifestInfo([string]$PackageDirectory) {
  $directory = (Resolve-Path -LiteralPath $PackageDirectory).Path
  $manifestPath = Join-Path $directory 'AppxManifest.xml'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Store package manifest is missing'
  }

  [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
  $identity = $manifest.Package.Identity
  $properties = $manifest.Package.Properties
  $application = $manifest.Package.Applications.Application
  if (
    -not $identity.Name -or
    -not $identity.Publisher -or
    -not $identity.Version -or
    -not $identity.ProcessorArchitecture -or
    -not $properties.PublisherDisplayName -or
    -not $properties.DisplayName -or
    -not $application.Id
  ) {
    throw 'Store package manifest identity is incomplete'
  }

  return [pscustomobject]@{
    IdentityName = [string]$identity.Name
    Publisher = [string]$identity.Publisher
    Version = [string]$identity.Version
    Architecture = [string]$identity.ProcessorArchitecture
    PublisherDisplayName = [string]$properties.PublisherDisplayName
    DisplayName = [string]$properties.DisplayName
    ApplicationId = [string]$application.Id
  }
}

function Assert-MetroraStoreLocalContextKeys($Value, [string[]]$Expected, [string]$Label) {
  if ($null -eq $Value -or $Value -isnot [psobject]) {
    throw "$Label must be an object"
  }
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  if (($actual -join [char]0) -ne ($wanted -join [char]0)) {
    throw "$Label fields are invalid"
  }
}

function Get-MetroraStoreLocalTestState([string]$AcceptanceDirectory, [string]$RepositoryRoot) {
  $acceptance = (Resolve-Path -LiteralPath $AcceptanceDirectory).Path
  $contextPath = Join-Path $acceptance 'STORE_LOCAL_TEST_CONTEXT.json'
  if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) {
    throw 'Store local-test context is missing'
  }
  $context = Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json

  Assert-MetroraStoreLocalContextKeys $context @(
    'kind', 'version', 'source', 'package', 'platform', 'localTest'
  ) 'context'
  Assert-MetroraStoreLocalContextKeys $context.source @('repository', 'commit') 'context.source'
  Assert-MetroraStoreLocalContextKeys $context.package @(
    'artifactName', 'unsignedFile', 'unsignedSha256', 'signedFile', 'testSignedSha256',
    'version', 'architecture', 'identityName', 'publisher', 'applicationId'
  ) 'context.package'
  Assert-MetroraStoreLocalContextKeys $context.platform @(
    'edition', 'version', 'build', 'architecture'
  ) 'context.platform'
  Assert-MetroraStoreLocalContextKeys $context.localTest @(
    'certificateThumbprint', 'installedPackageFullName'
  ) 'context.localTest'

  if (
    $context.kind -ne 'metrora.windows-store-local-test-context' -or
    [int]$context.version -ne 1 -or
    $context.source.repository -ne 'maikolsiragusaa/metrora' -or
    $context.source.commit -notmatch '^[a-f0-9]{40}$' -or
    $context.package.unsignedFile -ne 'unsigned-candidate.appx' -or
    $context.package.signedFile -ne 'local-test-signed.appx' -or
    $context.package.unsignedSha256 -notmatch '^[a-f0-9]{64}$' -or
    $context.package.testSignedSha256 -notmatch '^[a-f0-9]{64}$' -or
    $context.package.unsignedSha256 -eq $context.package.testSignedSha256 -or
    $context.package.version -notmatch '^\d+\.\d+\.\d+\.\d+$' -or
    $context.package.architecture -ne 'x64' -or
    $context.platform.architecture -ne 'x64' -or
    $context.localTest.certificateThumbprint -notmatch '^[A-F0-9]{40}$'
  ) {
    throw 'Store local-test context authority is invalid'
  }

  $repository = Assert-MetroraPhysicalRepositoryAuthority $RepositoryRoot ([string]$context.source.commit)
  $unsigned = (Resolve-Path -LiteralPath (Join-Path $acceptance $context.package.unsignedFile)).Path
  $signed = (Resolve-Path -LiteralPath (Join-Path $acceptance $context.package.signedFile)).Path
  if ((Get-MetroraFileSha256 $unsigned) -ne $context.package.unsignedSha256) {
    throw 'unsigned Store candidate digest changed'
  }
  if ((Get-MetroraFileSha256 $signed) -ne $context.package.testSignedSha256) {
    throw 'local test-signed Store package digest changed'
  }

  return [pscustomobject]@{
    Acceptance = $acceptance
    Repository = $repository
    Context = $context
    Unsigned = $unsigned
    Signed = $signed
  }
}

function Remove-MetroraStoreLocalCertificate([string]$Thumbprint) {
  foreach ($store in @('Cert:\CurrentUser\TrustedPeople', 'Cert:\CurrentUser\My')) {
    $path = Join-Path $store $Thumbprint
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Force
    }
  }
}
