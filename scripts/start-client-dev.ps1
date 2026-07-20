[CmdletBinding()]
param(
  [string]$PrivateKeyFile = "",
  [string]$PublicKeyFile = "",
  [string]$Username = "dev_local",
  [string]$Plan = "member",
  [int]$TtlMinutes = 43200,
  [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$launcherFile = Join-Path $projectRoot "main_ui_node_desktop.js"

if ([string]::IsNullOrWhiteSpace($PrivateKeyFile)) {
  $PrivateKeyFile = Join-Path $projectRoot "tmp\client_license_private.pem"
}
if ([string]::IsNullOrWhiteSpace($PublicKeyFile)) {
  $PublicKeyFile = Join-Path $projectRoot "keys\client_license_public.pem"
}

$resolvedPrivateKeyFile = (Resolve-Path -LiteralPath $PrivateKeyFile).Path
$resolvedPublicKeyFile = (Resolve-Path -LiteralPath $PublicKeyFile).Path
$resolvedLauncherFile = (Resolve-Path -LiteralPath $launcherFile).Path
$nodeCommand = Get-Command node -ErrorAction Stop

$env:CLIENT_AUTH_MODE = "dev_auto_bundle"
$env:CLIENT_DEV_LICENSE_PRIVATE_KEY_FILE = $resolvedPrivateKeyFile
$env:CONTROL_PLANE_PUBLIC_KEY_FILE = $resolvedPublicKeyFile
$env:CLIENT_DEV_LICENSE_USERNAME = [string]$Username
$env:CLIENT_DEV_LICENSE_PLAN = [string]$Plan
$env:CLIENT_DEV_LICENSE_TTL_MINUTES = [string]([Math]::Max($TtlMinutes, 1))

if ($NoLaunch) {
  Write-Host "CLIENT_AUTH_MODE=$env:CLIENT_AUTH_MODE"
  Write-Host "CLIENT_DEV_LICENSE_PRIVATE_KEY_FILE=$env:CLIENT_DEV_LICENSE_PRIVATE_KEY_FILE"
  Write-Host "CONTROL_PLANE_PUBLIC_KEY_FILE=$env:CONTROL_PLANE_PUBLIC_KEY_FILE"
  Write-Host "CLIENT_DEV_LICENSE_USERNAME=$env:CLIENT_DEV_LICENSE_USERNAME"
  Write-Host "CLIENT_DEV_LICENSE_PLAN=$env:CLIENT_DEV_LICENSE_PLAN"
  Write-Host "CLIENT_DEV_LICENSE_TTL_MINUTES=$env:CLIENT_DEV_LICENSE_TTL_MINUTES"
  Write-Host "launcher=$resolvedLauncherFile"
  exit 0
}

Push-Location $projectRoot
try {
  & $nodeCommand.Source $resolvedLauncherFile
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
