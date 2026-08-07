param(
  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
. (Join-Path $repository 'scripts\windows-store-local-test-lib.ps1')

$platform = Get-MetroraWindowsPlatform
if (
  [string]::IsNullOrWhiteSpace([string]$platform.edition) -or
  [string]::IsNullOrWhiteSpace([string]$platform.version) -or
  [string]::IsNullOrWhiteSpace([string]$platform.build) -or
  @('x86', 'x64', 'arm', 'arm64', 'ia64') -notcontains [string]$platform.architecture
) {
  throw 'Windows platform runtime detection returned unexpected values'
}

$temporary = Join-Path $env:TEMP "metrora-store-runtime-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
try {
  $manifest = @'
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="Example.Package" Publisher="CN=LOCAL-TEST" Version="1.0.0.7" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Example App</DisplayName>
    <PublisherDisplayName>Example Publisher</PublisherDisplayName>
    <Logo>assets\StoreLogo.png</Logo>
  </Properties>
  <Applications>
    <Application Id="example.app" Executable="Example.exe" EntryPoint="Windows.FullTrustApplication" />
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
'@
  [IO.File]::WriteAllText(
    (Join-Path $temporary 'AppxManifest.xml'),
    $manifest,
    [Text.UTF8Encoding]::new($false)
  )

  $info = Get-MetroraStoreManifestInfo $temporary
  if (
    $info.IdentityName -ne 'Example.Package' -or
    $info.Publisher -ne 'CN=LOCAL-TEST' -or
    $info.Version -ne '1.0.0.7' -or
    $info.Architecture -ne 'x64' -or
    $info.DisplayName -ne 'Example App' -or
    $info.PublisherDisplayName -ne 'Example Publisher' -or
    $info.ApplicationId -ne 'example.app'
  ) {
    throw 'Store manifest runtime parser returned unexpected values'
  }

  $valid = [pscustomobject]@{ alpha = 1; beta = 2 }
  Assert-MetroraStoreLocalContextKeys $valid @('alpha', 'beta') 'valid object'

  $rejected = $false
  try {
    Assert-MetroraStoreLocalContextKeys $valid @('alpha') 'invalid object'
  } catch {
    $rejected = $true
  }
  if (-not $rejected) {
    throw 'Store context key validation accepted an extra field'
  }

  $artifactManifest = [pscustomobject]@{
    schemaVersion = 1
    sourceCommit = ('a' * 40)
    artifactName = 'Metrora-1.0.0-rc.9-Windows-Store-x64.appx'
    sha256 = ('b' * 64)
    packageVersion = '1.0.0.0'
    architecture = 'x64'
    signed = $false
    submitted = $false
    published = $false
    packagedCliSmoke = 'pass'
    cliRuntimeContainer = 'asar'
    looseCliNodeModules = $false
    futureAdditiveField = 'allowed'
  }
  Assert-MetroraStoreLocalContextKeys $artifactManifest @(
    'schemaVersion', 'sourceCommit', 'artifactName', 'sha256', 'packageVersion',
    'architecture', 'signed', 'submitted', 'published'
  ) 'Store artifact manifest'

  $invalidArtifact = $artifactManifest | ConvertTo-Json -Depth 4 | ConvertFrom-Json
  $invalidArtifact.looseCliNodeModules = $true
  $rejectedArtifact = $false
  try {
    Assert-MetroraStoreLocalContextKeys $invalidArtifact @(
      'schemaVersion', 'sourceCommit', 'artifactName', 'sha256', 'packageVersion',
      'architecture', 'signed', 'submitted', 'published'
    ) 'Store artifact manifest'
  } catch {
    $rejectedArtifact = $true
  }
  if (-not $rejectedArtifact) {
    throw 'Store artifact manifest validation accepted loose CLI node_modules'
  }
}
finally {
  if (Test-Path -LiteralPath $temporary) {
    Remove-Item -LiteralPath $temporary -Recurse -Force
  }
}

Write-Host 'Store local-test runtime helpers passed.'