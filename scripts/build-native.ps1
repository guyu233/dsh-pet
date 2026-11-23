# Build the native floating-pet renderer.
#
# Windows: Rust (MSVC target), release profile tuned for small size.
#   & .\scripts\build-native.ps1 -Platform win32
#   Verified toolchain: rustc 1.98.1 / x86_64-pc-windows-msvc + VS 2022 MSVC.
#
# macOS: ObjC/AppKit renderer (source in native/macos); needs clang++ on a Mac.
#   pwsh ./scripts/build-native.ps1 -Platform macos -Arch arm64
#
# Output: packages/dsh-pet/native/<platform>-<arch>/dsh-pet[.exe]

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('win32', 'macos')]
  [string]$Platform,
  [string]$Arch = 'auto'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$bundleNative = Join-Path $repo 'packages/dsh-pet/native'

if ($Platform -eq 'win32') {
  $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
  $env:PATH = "$cargoBin;$env:PATH"
  # Ensure the MSVC linker (link.exe) is on PATH via vcvars64.
  $vcvars = @(
    'C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat',
    'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $vcvars) { throw 'vcvars64.bat not found; install VS C++ build tools.' }

  $cmd = "call `"$vcvars`" && cd /d `"$repo\native-rs`" && cargo build --release"
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { throw 'Rust release build failed.' }

  $out = Join-Path $bundleNative 'win32-x64'
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  Copy-Item (Join-Path $repo 'native-rs\target\release\dsh-pet.exe') (Join-Path $out 'dsh-pet.exe') -Force
  $exe = Get-Item (Join-Path $out 'dsh-pet.exe')
  Write-Host "Built $($exe.FullName) ($([math]::Round($exe.Length/1KB,1)) KB)"
} else {
  if ($Arch -eq 'auto') { $Arch = 'arm64' }
  $out = Join-Path $bundleNative "darwin-$Arch"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  & clang++ -O2 -std=c++17 -fobjc-arc -framework AppKit -framework Foundation `
    "$repo/native/macos/dsh-pet.mm" -o "$out/dsh-pet"
  if ($LASTEXITCODE -ne 0) { throw 'macOS native build failed.' }
  Write-Host "Built $out/dsh-pet"
}
