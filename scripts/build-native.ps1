# Build the native floating-pet renderer.
#
# Windows: uses the installed Visual Studio Developer PowerShell. Verified on
#   Visual Studio 18 (2026) Community with Windows SDK 10.0.26100.
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
  [string]$Arch = 'auto',
  [string]$VsDevShell = 'auto'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$nativeSrc = Join-Path $repo 'native'
$bundleNative = Join-Path $repo 'packages/dsh-pet/native'

function Initialize-VsEnvironment {
  param([string]$Preferred)
  if ($Preferred -ne 'auto' -and (Test-Path $Preferred)) {
    & $Preferred -Arch amd64 -HostArch amd64 *> $null
    return
  }
  # Look for Launch-VsDevShell.ps1 across common VS installs.
  $roots = @(
    'C:\Program Files\Microsoft Visual Studio',
    'C:\Program Files (x86)\Microsoft Visual Studio'
  )
  $candidates = foreach ($r in $roots) {
    if (Test-Path $r) {
      Get-ChildItem $r -Recurse -Filter 'Launch-VsDevShell.ps1' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'Common7\\Tools' }
    }
  }
  # Prefer Community, then BuildTools, then whatever is first.
  $script = $candidates | Where-Object { $_.FullName -match '\\Community\\' } | Select-Object -First 1
  if (-not $script) { $script = $candidates | Where-Object { $_.FullName -match '\\BuildTools\\' } | Select-Object -First 1 }
  if (-not $script) { $script = $candidates | Select-Object -First 1 }
  if (-not $script) { throw 'Launch-VsDevShell.ps1 not found. Install Visual Studio with the C++ desktop workload.' }
  Write-Host "Using VS DevShell: $($script.FullName)"
  & $script.FullName -Arch amd64 -HostArch amd64 *> $null
  if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    throw 'cl.exe is unavailable after VS environment initialization.'
  }
}

if ($Platform -eq 'win32') {
  if ($Arch -eq 'auto') { $Arch = 'x64' }
  if ($Arch -ne 'x64') { throw 'Only win32-x64 is supported by this build script.' }
  Initialize-VsEnvironment -Preferred $VsDevShell
  $out = Join-Path $bundleNative "win32-$Arch"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  Push-Location $repo
  try {
    $exe = Join-Path $out 'dsh-pet.exe'
    cl /nologo /O2 /utf-8 /DUNICODE /D_UNICODE /Fe:"$exe" `
      "$nativeSrc\win\dsh-pet.c" `
      ole32.lib windowscodecs.lib user32.lib gdi32.lib kernel32.lib
    if ($LASTEXITCODE -ne 0) { throw 'Windows native build failed.' }
    Write-Host "Built $exe ($((Get-Item $exe).Length) bytes)"
  } finally { Pop-Location }
} else {
  if ($Arch -eq 'auto') { $Arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' } }
  $out = Join-Path $bundleNative "darwin-$Arch"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  & clang++ -O2 -std=c++17 -fobjc-arc -framework AppKit -framework Foundation `
    "$nativeSrc/macos/dsh-pet.mm" -o "$out/dsh-pet"
  if ($LASTEXITCODE -ne 0) { throw 'macOS native build failed.' }
  Write-Host "Built $out/dsh-pet"
}
