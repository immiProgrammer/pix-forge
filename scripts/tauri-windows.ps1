$tauriArgs = $args
. (Join-Path $PSScriptRoot 'windows-env.ps1')
Set-Location -LiteralPath (Join-Path $projectRoot 'apps\desktop')
& node (Join-Path $projectRoot 'apps\desktop\node_modules\@tauri-apps\cli\tauri.js') @tauriArgs
exit $LASTEXITCODE
