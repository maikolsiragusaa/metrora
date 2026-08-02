param(
  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$paths = @(
  'scripts\Build-Metrora-Windows-Installer.ps1',
  'scripts\windows-install-test-lib.ps1',
  'scripts\windows-installed-app-test-lib.ps1',
  'scripts\windows-physical-acceptance-lib.ps1',
  'scripts\windows-physical-artifact-lib.ps1',
  'scripts\windows-physical-context-lib.ps1',
  'scripts\Test-Metrora-Windows-Install.ps1',
  'scripts\Test-Metrora-Windows-Migration.ps1',
  'scripts\Test-Metrora-Windows-Interrupted-Migration.ps1',
  'scripts\Prepare-Metrora-Windows-Physical-Acceptance.ps1',
  'scripts\Start-Metrora-Windows-Physical-Existing-Profile.ps1',
  'scripts\Record-Metrora-Windows-Physical-Existing-Profile.ps1',
  'scripts\Test-Metrora-Windows-Physical-Clean.ps1',
  'scripts\Test-Metrora-Windows-Physical-Migration.ps1',
  'scripts\Complete-Metrora-Windows-Physical-Acceptance.ps1',
  'scripts\Test-Metrora-Windows-Physical-Report-Runtime.ps1'
)

$failures = @()
foreach ($relativePath in $paths) {
  $path = Join-Path $repository $relativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    $failures += "$relativePath`: missing file"
    continue
  }

  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $path,
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null

  foreach ($parseError in @($errors)) {
    $line = $parseError.Extent.StartLineNumber
    $column = $parseError.Extent.StartColumnNumber
    $failures += "$relativePath`:$line`:$column`: $($parseError.Message)"
  }
}

if ($failures.Count -gt 0) {
  throw "Windows release PowerShell syntax validation failed:`n$($failures -join "`n")"
}

Write-Host "PowerShell syntax verified for $($paths.Count) Windows release scripts."
