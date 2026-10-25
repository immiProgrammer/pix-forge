$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Build Windows installers on Windows.' }
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
if (-not $VcpkgRoot) {
    if ($env:VCPKG_ROOT -and (Test-Path -LiteralPath (Join-Path $env:VCPKG_ROOT 'installed\x64-windows-static-md\lib\pkgconfig\dav1d.pc'))) {
        $VcpkgRoot = $env:VCPKG_ROOT
    } else {
        $VcpkgRoot = 'C:\Dev\vcpkg'
    }
}
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path -LiteralPath $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }
foreach ($tool in @('node', 'pnpm', 'rustc', 'cargo')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing $tool. Follow docs/WINDOWS-BUILD.md, then reopen PowerShell." }
}
# Initialize the installed MSVC/Windows SDK environment in this process.
if (-not (Get-Command cl -ErrorAction SilentlyContinue)) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio 2022 C++ Build Tools and the Windows SDK (see docs/WINDOWS-BUILD.md).' }
    $vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vsPath) { throw 'No Visual Studio installation with the x64 C++ tools was found.' }
    $env:PATH = "$(Split-Path -Parent $vswhere);$env:PATH"
    Import-Module (Join-Path $vsPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
    Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'
}
$env:VCPKG_ROOT = $VcpkgRoot
$codecPrefix = Join-Path $VcpkgRoot 'installed\x64-windows-static-md'
$pkgconf = Join-Path $codecPrefix 'tools\pkgconf\pkgconf.exe'
$codecMetadata = Join-Path $codecPrefix 'lib\pkgconfig\dav1d.pc'
if (-not (Test-Path -LiteralPath $pkgconf) -or -not (Test-Path -LiteralPath $codecMetadata)) {
    throw "Static dav1d/pkgconf not found under $codecPrefix. Run the vcpkg commands in docs/WINDOWS-BUILD.md."
}
$env:PKG_CONFIG = $pkgconf
$env:PKG_CONFIG_PATH = Join-Path $codecPrefix 'lib\pkgconfig'
$env:PKG_CONFIG_ALL_STATIC = '1'
$env:SYSTEM_DEPS_DAV1D_LINK = 'static'
# pkgconf can itself require its vcpkg runtime libraries.
$env:PATH = "$(Join-Path $codecPrefix 'bin');$(Split-Path -Parent $pkgconf);$env:PATH"
if (-not (Get-Command nasm -ErrorAction SilentlyContinue)) {
    foreach ($nasmDir in @("$env:ProgramFiles\NASM", "$env:LOCALAPPDATA\bin\NASM")) {
        if (Test-Path -LiteralPath (Join-Path $nasmDir 'nasm.exe')) { $env:PATH = "$nasmDir;$env:PATH"; break }
    }
}
if (-not (Get-Command nasm -ErrorAction SilentlyContinue)) { throw 'NASM is missing. Install NASM.NASM and add its directory to PATH.' }
& $pkgconf --atleast-version=1.3.0 dav1d
if ($LASTEXITCODE -ne 0) { throw 'dav1d >= 1.3.0 is required.' }
