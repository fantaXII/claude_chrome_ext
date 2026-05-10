#Requires -Version 5.1
<#
.SYNOPSIS
    Registers the Claude Chrome Extension Native Messaging Host on Windows.

.DESCRIPTION
    Creates the native host manifest JSON and registers it in the Windows
    registry so Chrome can find and launch host-wrapper.bat.

.PARAMETER ExtensionId
    The Chrome Extension ID from chrome://extensions (required).
    Example: .\install.ps1 -ExtensionId "abcdefghijklmnopqrstuvwxyz123456"

.PARAMETER Uninstall
    Remove the registration instead of installing.
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$ExtensionId = "",

    [switch]$Uninstall
)

$HostName    = "com.claude.ext.host"
$RegPath     = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
$ManifestDir = "$env:APPDATA\ClaudeExt"

# ── Uninstall ────────────────────────────────────────────────────────────────
if ($Uninstall) {
    Write-Host "Uninstalling Native Host '$HostName'..." -ForegroundColor Yellow
    if (Test-Path $RegPath) {
        Remove-Item -Path $RegPath -Force
        Write-Host "  Registry key removed." -ForegroundColor Green
    } else {
        Write-Host "  Registry key not found (already uninstalled?)" -ForegroundColor Gray
    }
    if (Test-Path "$ManifestDir\$HostName.json") {
        Remove-Item "$ManifestDir\$HostName.json" -Force
        Write-Host "  Manifest file removed." -ForegroundColor Green
    }
    Write-Host "Done." -ForegroundColor Green
    exit 0
}

# ── Validate inputs ──────────────────────────────────────────────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$WrapperBat = Join-Path $ScriptDir "host-wrapper.bat"

if (-not (Test-Path $WrapperBat)) {
    Write-Error "host-wrapper.bat not found at: $WrapperBat"
    Write-Host "Please run this script from the native-host directory." -ForegroundColor Red
    exit 1
}

if (-not $ExtensionId) {
    Write-Host ""
    Write-Host "Extension ID is required." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Steps to get your Extension ID:" -ForegroundColor Cyan
    Write-Host "  1. Open Chrome and go to chrome://extensions"
    Write-Host "  2. Enable 'Developer mode' (top right)"
    Write-Host "  3. Click 'Load unpacked' and select the 'extension' folder"
    Write-Host "  4. Copy the ID shown under the extension name"
    Write-Host ""
    $ExtensionId = Read-Host "Enter Extension ID"
    if (-not $ExtensionId) {
        Write-Error "Extension ID cannot be empty."
        exit 1
    }
}

# Validate Extension ID format: must be exactly 32 lowercase a-p characters
if ($ExtensionId -notmatch '^[a-p]{32}$') {
    Write-Error "Invalid Extension ID format: '$ExtensionId'. Must be exactly 32 characters (a-p only)."
    exit 1
}

# ── Create manifest directory ────────────────────────────────────────────────
if (-not (Test-Path $ManifestDir)) {
    New-Item -ItemType Directory -Path $ManifestDir -Force | Out-Null
}

# ── Write manifest JSON ──────────────────────────────────────────────────────
$ManifestPath = "$ManifestDir\$HostName.json"
$WrapperBatAbs = (Resolve-Path $WrapperBat).Path

$manifest = @{
    name            = $HostName
    description     = "Claude Code Chrome Extension Native Host"
    path            = $WrapperBatAbs
    type            = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 3

$manifest | Set-Content -Path $ManifestPath -Encoding UTF8
Write-Host "Manifest written to: $ManifestPath" -ForegroundColor Green

# ── Register in Windows registry ─────────────────────────────────────────────
if (-not (Test-Path "HKCU:\Software\Google\Chrome")) {
    New-Item -Path "HKCU:\Software\Google\Chrome" -Force | Out-Null
}
if (-not (Test-Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts")) {
    New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts" -Force | Out-Null
}

New-Item -Path $RegPath -Force | Out-Null
Set-ItemProperty -Path $RegPath -Name "(Default)" -Value $ManifestPath
Write-Host "Registry key set: $RegPath" -ForegroundColor Green

# ── Verify ────────────────────────────────────────────────────────────────────
$regVal = (Get-ItemProperty -Path $RegPath -Name "(Default)")."(Default)"
if ($regVal -eq $ManifestPath) {
    Write-Host ""
    Write-Host "Installation complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Summary:" -ForegroundColor Cyan
    Write-Host "  Host name    : $HostName"
    Write-Host "  Wrapper      : $WrapperBatAbs"
    Write-Host "  Manifest     : $ManifestPath"
    Write-Host "  Extension ID : $ExtensionId"
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Restart Chrome completely (close all windows)"
    Write-Host "  2. Open a webpage and click the Claude Code extension icon"
    Write-Host ""
} else {
    Write-Error "Registry verification failed. Expected '$ManifestPath', got '$regVal'"
    exit 1
}
