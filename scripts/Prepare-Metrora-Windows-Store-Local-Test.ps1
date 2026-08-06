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

. (Join-Path $PSScriptRoot 'windows-store-local-test-lib.ps1')

Assert-MetroraStoreAdministrator
$repository = Assert-MetroraPhysicalRepositoryAuthority $RepositoryRoot $ExpectedCommit
$archive = (Resolve-Path -LiteralPath $ArtifactArchive).Path
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
  throw 'Store artifact archive must be a file'
}

$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) {
  $existing = @(Get-ChildItem -LiteralPath $output -Force -ErrorAction Stop)
  if ($existing.Count -gt 0) {
    throw 'Store local-test output directory must be absent or empty'
  }
}
New-Item -ItemType Directory -Path $output -Force | Out-Null

$declaredArchive = Join-Path $output 'declared-artifact.zip'
Copy-Item -LiteralPath $archive -Destination $declaredArchive -Force
$declaredArchiveSha256 = Get-MetroraFileSha256 $declaredArchive

$downloaded = Join-Path $output 'downloaded-artifact'
Expand-MetroraBoundedArtifactArchive $declaredArchive $downloaded | Out-Null

$packages = @(Get-ChildItem -LiteralPath $downloaded -Recurse -File -Filter '*.appx')
if ($packages.Count -ne 1) {
  throw "expected exactly one AppX package, found $($packages.Count)"
}
$manifests = @(Get-ChildItem -LiteralPath $downloaded -Recurse -File -Filter 'STORE_PACKAGE_MANIFEST.json')
if ($manifests.Count -ne 1) {
  throw "expected exactly one Store package manifest, found $($manifests.Count)"
}

$artifactManifest = Get-Content -LiteralPath $manifests[0].FullName -Raw | ConvertFrom-Json
Assert-MetroraStoreLocalContextKeys $artifactManifest @(
  'schemaVersion', 'sourceCommit', 'artifactName', 'sha256', 'packageVersion',
  'architecture', 'signed', 'submitted', 'published'
) 'Store artifact manifest'
if (
  [int]$artifactManifest.schemaVersion -ne 1 -or
  [string]$artifactManifest.sourceCommit -ne $ExpectedCommit -or
  [string]$artifactManifest.artifactName -ne $packages[0].Name -or
  [string]$artifactManifest.sha256 -notmatch '^[a-f0-9]{64}$' -or
  [string]$artifactManifest.packageVersion -notmatch '^\d+\.\d+\.\d+\.\d+$' -or
  [string]$artifactManifest.architecture -ne 'x64' -or
  [bool]$artifactManifest.signed -or
  [bool]$artifactManifest.submitted -or
  [bool]$artifactManifest.published
) {
  throw 'Store artifact manifest authority is invalid'
}

$unsigned = Join-Path $output 'unsigned-candidate.appx'
Copy-Item -LiteralPath $packages[0].FullName -Destination $unsigned -Force
$unsignedSha256 = Get-MetroraFileSha256 $unsigned
if ($unsignedSha256 -ne [string]$artifactManifest.sha256) {
  throw 'Store package digest does not match its artifact manifest'
}

$inspection = Join-Path $output 'unsigned-package'
Expand-MetroraBoundedArtifactArchive $unsigned $inspection | Out-Null
if (Test-Path -LiteralPath (Join-Path $inspection 'AppxSignature.p7x')) {
  throw 'the submission candidate must remain unsigned'
}
$manifest = Get-MetroraStoreManifestInfo $inspection

$desktopPackage = Get-Content -LiteralPath (Join-Path $repository 'app\package.json') -Raw | ConvertFrom-Json
$appx = $desktopPackage.build.appx
if (
  $manifest.IdentityName -cne [string]$appx.identityName -or
  $manifest.Publisher -cne [string]$appx.publisher -or
  $manifest.PublisherDisplayName -cne [string]$appx.publisherDisplayName -or
  $manifest.DisplayName -cne [string]$appx.displayName -or
  $manifest.ApplicationId -cne [string]$appx.applicationId -or
  $manifest.Version -cne [string]$artifactManifest.packageVersion -or
  $manifest.Architecture -cne 'x64'
) {
  throw 'Store package manifest does not match the reviewed build authority'
}

$existingPackage = @(Get-AppxPackage -Name $manifest.IdentityName -ErrorAction SilentlyContinue)
if ($existingPackage.Count -gt 0) {
  throw 'a package with the Store identity is already installed for this Windows user'
}

$platform = Get-MetroraWindowsPlatform
if ($platform.architecture -ne 'x64') {
  throw "Store local testing requires Windows x64, found $($platform.architecture)"
}

$signTool = Find-MetroraStoreSignTool
$signed = Join-Path $output 'local-test-signed.appx'
Copy-Item -LiteralPath $unsigned -Destination $signed -Force

$temporaryRoot = Join-Path $env:TEMP "metrora-store-local-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
$pfxPath = Join-Path $temporaryRoot 'local-test.pfx'
$cerPath = Join-Path $temporaryRoot 'local-test.cer'
$passwordBytes = [byte[]]::new(32)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $rng.GetBytes($passwordBytes)
} finally {
  $rng.Dispose()
}
$passwordPlain = [Convert]::ToBase64String($passwordBytes)
$password = ConvertTo-SecureString $passwordPlain -AsPlainText -Force
$certificate = $null
$installed = $null
$prepared = $false

try {
  $certificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $manifest.Publisher `
    -FriendlyName 'Metrora Store local acceptance' `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature `
    -KeyExportPolicy Exportable `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3') `
    -NotAfter (Get-Date).AddDays(7)

  Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $password | Out-Null
  Export-Certificate -Cert $certificate -FilePath $cerPath -Type CERT | Out-Null
  Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null

  $signOutput = (& $signTool sign /fd SHA256 /f $pfxPath /p $passwordPlain $signed 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "local Store package signing failed: $signOutput"
  }
  $verifyOutput = (& $signTool verify /pa /v $signed 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "local Store package signature verification failed: $verifyOutput"
  }

  Add-AppxPackage -Path $signed -ForceApplicationShutdown
  $matches = @(Get-AppxPackage -Name $manifest.IdentityName -ErrorAction Stop)
  if ($matches.Count -ne 1) {
    throw 'the local test package did not install as one current-user package'
  }
  $installed = $matches[0]

  $signedSha256 = Get-MetroraFileSha256 $signed
  if ($signedSha256 -eq $unsignedSha256) {
    throw 'local test signing did not change the package digest'
  }

  $context = [ordered]@{
    kind = 'metrora.windows-store-local-test-context'
    version = 1
    source = [ordered]@{
      repository = 'maikolsiragusaa/metrora'
      commit = $ExpectedCommit
    }
    package = [ordered]@{
      artifactName = $packages[0].Name
      unsignedFile = 'unsigned-candidate.appx'
      unsignedSha256 = $unsignedSha256
      signedFile = 'local-test-signed.appx'
      testSignedSha256 = $signedSha256
      version = $manifest.Version
      architecture = $manifest.Architecture
      identityName = $manifest.IdentityName
      publisher = $manifest.Publisher
      applicationId = $manifest.ApplicationId
    }
    platform = $platform
    localTest = [ordered]@{
      certificateThumbprint = $certificate.Thumbprint
      installedPackageFullName = [string]$installed.PackageFullName
    }
  }
  Write-MetroraUtf8Json (Join-Path $output 'STORE_LOCAL_TEST_CONTEXT.json') $context

  Start-Process 'explorer.exe' "shell:AppsFolder\$($installed.PackageFamilyName)!$($manifest.ApplicationId)"
  $prepared = $true
}
finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
  if (-not $prepared) {
    if ($installed) {
      Remove-AppxPackage -Package $installed.PackageFullName -ErrorAction SilentlyContinue
    }
    if ($certificate) {
      Remove-MetroraStoreLocalCertificate $certificate.Thumbprint
    }
  }
}

[ordered]@{
  status = 'installed-for-local-test'
  sourceCommit = $ExpectedCommit
  artifactArchiveSha256 = $declaredArchiveSha256
  unsignedPackageSha256 = $unsignedSha256
  packageVersion = $manifest.Version
  next = 'Inspect the launched app, then run Complete-Metrora-Windows-Store-Local-Test.ps1.'
} | ConvertTo-Json -Compress
