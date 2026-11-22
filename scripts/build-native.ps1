# Build the native floating-pet renderer.
#
# Windows: requires Visual Studio Developer PowerShell (cl.exe + WIC sdk).
#   & .\scripts\build-native.ps1 -Platform win32
#
# macOS: requires clang++ + AppKit (run on a Mac).
#   pwsh ./scripts/build-native.ps1 -Platform macos -Arch arm64
#
# Outputs into packages/dsh-pet/native/<platform>-<arch>/.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('win32', 'macos')]
  [string]$Platform,
  [string]$Arch = 'auto'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$nativeSrc = Join-Path $repo 'native'
$bundleNative = Join-Path $repo 'packages/dsh-pet/native'

if ($Platform -eq 'win32') {
  if ($Arch -eq 'auto') { $Arch = 'x64' }
  $out = Join-Path $bundleNative "win32-$Arch"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    throw 'cl.exe not found. Run this script from a Visual Studio Developer PowerShell.'
  }
  & cl.exe /nologo /O2 /DUNICODE /D_UNICODE /Fe:"$out\dsh-pet.exe" `
    "$nativeSrc\win\dsh-pet.c" ole32.lib windowscodecs.lib user32.lib gdi32.lib kernel32.lib
  if ($LASTEXITCODE -ne 0) { throw 'Windows native build failed.' }
  Write-Host "Built $out\dsh-pet.exe"
} else {
  if ($Arch -eq 'auto') { $Arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' } }
  $out = Join-Path $bundleNative "darwin-$Arch"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  & clang++ -O2 -std=c++17 -fobjc-arc -framework AppKit -framework Foundation `
    "$nativeSrc/macos/dsh-pet.mm" -o "$out/dsh-pet"
  if ($LASTEXITCODE -ne 0) { throw 'macOS native build failed.' }
  Write-Host "Built $out/dsh-pet"
}
