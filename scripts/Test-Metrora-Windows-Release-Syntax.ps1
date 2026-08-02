param(
  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$paths = @(
  'scripts\windows-install-test-lib.ps1',
  'scripts\windows-installed-app-test-lib.ps1',
  'scripts\Test-Metrora-Windows-Install.ps1',
  'scripts\Test-Metrora-Windows-Migration.ps1'
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
