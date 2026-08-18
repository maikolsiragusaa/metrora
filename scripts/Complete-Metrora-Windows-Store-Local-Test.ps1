param(
  [Parameter(Mandatory = $true)]
  [string]$AcceptanceDirectory,

  [Parameter(Mandatory = $true)]
  [ValidateSet('pass', 'fail')]
  [string]$Launch,

  [Parameter(Mandatory = $true)]
  [ValidateSet('pass', 'fail')]
  [string]$IdentityPresentation,

  [Parameter(Mandatory = $true)]
  [ValidateSet('pass', 'fail')]
  [string]$LocalCollection,

  [Parameter(Mandatory = $true)]
  [ValidateSet('pass', 'fail')]
  [string]$NoExternalNode,

  [ValidateSet('pass', 'fail')]
  [string]$ConnectPhoneSurface = 'fail',

  [ValidateSet('pass', 'fail')]
  [string]$ProductionAndroidQrScan = 'fail',

  [ValidateSet('pass', 'fail')]
  [string]$SasMatch = 'fail',

  [ValidateSet('pass', 'fail')]
  [string]$DesktopApproval = 'fail',

  [ValidateSet('pass', 'fail')]
  [string]$AndroidHomeData = 'fail',

  [ValidateSet('pass', 'fail')]
  [string]$AndroidActivitySessions = 'fail',

  [ValidateSet('pass', 'fail')]
  [string]$AndroidAnalyzeFacts = 'fail',

  [ValidateSet('pass', 'fail')]
  [string]$SettingsDeviceSecurity = 'fail',

  [ValidateSet('pass', 'fail')]
  [string]$DisconnectReconnect = 'fail',

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-store-local-test-lib.ps1')

Assert-MetroraStoreAdministrator
$state = Get-MetroraStoreLocalTestState $AcceptanceDirectory $RepositoryRoot
$context = $state.Context
$thumbprint = [string]$context.localTest.certificateThumbprint
$packageFullName = [string]$context.localTest.installedPackageFullName

$packageRemoved = $false
$certificateRemoved = $false
$privateKeyRemoved = $false
$cleanupErrors = @()

try {
  $installed = @(Get-AppxPackage -Name ([string]$context.package.identityName) -ErrorAction SilentlyContinue |
    Where-Object { $_.PackageFullName -eq $packageFullName })
  foreach ($package in $installed) {
    Remove-AppxPackage -Package $package.PackageFullName -ErrorAction Stop
  }
  $remaining = @(Get-AppxPackage -Name ([string]$context.package.identityName) -ErrorAction SilentlyContinue |
    Where-Object { $_.PackageFullName -eq $packageFullName })
  $packageRemoved = $remaining.Count -eq 0
} catch {
  $cleanupErrors += 'package removal failed'
}

try {
  Remove-MetroraStoreLocalCertificate $thumbprint
  $trustedPath = Join-Path 'Cert:\LocalMachine\TrustedPeople' $thumbprint
  $personalPath = Join-Path 'Cert:\CurrentUser\My' $thumbprint
  $certificateRemoved = -not (Test-Path -LiteralPath $trustedPath)
  $privateKeyRemoved = -not (Test-Path -LiteralPath $personalPath)
} catch {
  $cleanupErrors += 'certificate removal failed'
}

  $observations = [ordered]@{
    launch = $Launch
    identityPresentation = $IdentityPresentation
    connectPhoneSurface = $ConnectPhoneSurface
    productionAndroidQrScan = $ProductionAndroidQrScan
    sasMatch = $SasMatch
    desktopApproval = $DesktopApproval
    androidHomeData = $AndroidHomeData
    androidActivitySessions = $AndroidActivitySessions
    androidAnalyzeFacts = $AndroidAnalyzeFacts
    settingsDeviceSecurity = $SettingsDeviceSecurity
    disconnectReconnect = $DisconnectReconnect
    localCollection = $LocalCollection
    noExternalNode = $NoExternalNode
}
$allObservationsPass = @($observations.Values | Where-Object { $_ -ne 'pass' }).Count -eq 0
$cleanupComplete = (
  $packageRemoved -and
  $certificateRemoved -and
  $privateKeyRemoved -and
  $cleanupErrors.Count -eq 0
)
$status = if ($allObservationsPass -and $cleanupComplete) { 'pass' } else { 'fail' }

$report = [ordered]@{
  kind = 'metrora.windows-store-local-test-report'
  version = 2
  status = $status
  generatedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  source = [ordered]@{
    repository = 'maikolsiragusaa/metrora'
    commit = [string]$context.source.commit
  }
  package = [ordered]@{
    artifactName = [string]$context.package.artifactName
    unsignedSha256 = [string]$context.package.unsignedSha256
    testSignedSha256 = [string]$context.package.testSignedSha256
    productVersion = [string]$context.package.productVersion
    desktopBuildVersion = [string]$context.package.desktopBuildVersion
    version = [string]$context.package.version
    architecture = [string]$context.package.architecture
  }
  platform = [ordered]@{
    edition = [string]$context.platform.edition
    version = [string]$context.platform.version
    build = [string]$context.platform.build
    architecture = [string]$context.platform.architecture
  }
  observations = $observations
  cleanup = [ordered]@{
    packageRemoved = $packageRemoved
    certificateRemoved = $certificateRemoved
    privateKeyRemoved = $privateKeyRemoved
  }
  privacy = [ordered]@{
    containsPrivatePaths = $false
    containsUsernames = $false
    containsPromptsOrResponses = $false
    containsPackageIdentityValues = $false
    containsKeysOrCertificates = $false
  }
  limitations = @(
    'local-test-signature'
    'not-store-signed'
    'not-submitted'
    'not-published'
    'single-windows-host'
    'no-update-flight'
  )
}

$reportPath = Join-Path $state.Acceptance 'METRORA-WINDOWS-STORE-LOCAL-TEST.json'
Write-MetroraUtf8Json $reportPath $report

$arguments = @(
  (Join-Path $state.Repository 'scripts\verify-windows-store-local-test-report.mjs'),
  $reportPath,
  '--expected-commit',
  [string]$context.source.commit
)
if ($status -eq 'pass') { $arguments += '--require-pass' }
$verification = (& node @arguments 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Store local-test report verification failed: $verification"
}

if ($cleanupComplete) {
  foreach ($relative in @(
    'STORE_LOCAL_TEST_CONTEXT.json',
    'local-test-signed.appx',
    'unsigned-package',
    'downloaded-artifact'
  )) {
    $path = Join-Path $state.Acceptance $relative
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }
}

if ($status -ne 'pass') {
  $suffix = if ($cleanupComplete) {
    'Cleanup completed; the sanitized FAIL report was preserved.'
  } else {
    'Cleanup is incomplete; preserve the local context and complete removal before deleting the workspace.'
  }
  throw "Store local test failed. $suffix"
}

[ordered]@{
  status = 'pass'
  sourceCommit = [string]$context.source.commit
  packageVersion = [string]$context.package.version
  report = 'METRORA-WINDOWS-STORE-LOCAL-TEST.json'
} | ConvertTo-Json -Compress
