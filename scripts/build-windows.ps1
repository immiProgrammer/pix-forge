param(
    [ValidateSet('nsis', 'msi', 'all', 'app')][string]$Bundle = 'all',
    [string]$VcpkgRoot,
    [switch]$Locked
)
. (Join-Path $PSScriptRoot 'windows-env.ps1')
# Keep artifact locations deterministic even if the caller has CARGO_TARGET_DIR set.
$env:CARGO_TARGET_DIR = Join-Path $projectRoot 'apps\desktop\src-tauri\target'
$buildArgs = @('run', 'tauri', 'build', '--target', 'x86_64-pc-windows-msvc')
if ($Bundle -eq 'app') { $buildArgs += '--no-bundle' }
elseif ($Bundle -eq 'all') { $buildArgs += @('--bundles', 'nsis,msi') }
else { $buildArgs += @('--bundles', $Bundle) }
if ($Locked) { $buildArgs += @('--', '--locked') }
& pnpm @buildArgs
if ($LASTEXITCODE -ne 0) { throw "Windows build failed (exit $LASTEXITCODE)." }
Write-Host 'Executable: apps\desktop\src-tauri\target\x86_64-pc-windows-msvc\release\pix-forge.exe'
if ($Bundle -ne 'app') { Write-Host 'Installers: apps\desktop\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\' }
