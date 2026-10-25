# Windows builds

Run these commands on **64-bit Windows**. The app includes an AVIF decoder, so this setup includes its native dav1d dependency. The scripts link dav1d statically; there is no separate dav1d DLL to ship. Rust's default MSVC runtime remains dynamic. The native Windows development build and five Rust tests have been verified, including WebP/AVIF/JPEG/PNG encode/decode smoke tests. Installer packaging is a separate build step.

## 1. Install tools once

Run in PowerShell. Visual Studio installation may request elevation; wait for it to finish.

```powershell
winget install --exact --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
winget install --exact --id Git.Git --accept-package-agreements --accept-source-agreements
winget install --exact --id Rustlang.Rustup --accept-package-agreements --accept-source-agreements
winget install --exact --id NASM.NASM --accept-package-agreements --accept-source-agreements
winget install --exact --id Microsoft.VisualStudio.2022.BuildTools --accept-package-agreements --accept-source-agreements --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Close and reopen PowerShell to pick up PATH changes, then:

```powershell
rustup default stable-x86_64-pc-windows-msvc
rustup target add x86_64-pc-windows-msvc
node --version
rustc --version
cargo --version
```

The Visual Studio C++ workload must include an MSVC x64 compiler and a Windows 10/11 SDK. If NASM is not on PATH, the build script checks `C:\Program Files\NASM` and `%LOCALAPPDATA%\bin\NASM`; otherwise add your NASM installation directory to PATH.

## 2. Install the AVIF decoder once

```powershell
New-Item -ItemType Directory -Path C:\Dev -Force | Out-Null
git clone https://github.com/microsoft/vcpkg.git C:\Dev\vcpkg
& C:\Dev\vcpkg\bootstrap-vcpkg.bat -disableMetrics
& C:\Dev\vcpkg\vcpkg.exe install dav1d:x64-windows-static-md pkgconf:x64-windows-static-md
```

If vcpkg already exists, skip cloning and bootstrapping. The `x64-windows-static-md` triplet uses static codec libraries with the dynamic MSVC runtime, matching Rust's default MSVC runtime. vcpkg handles dav1d's build-time Meson/Ninja dependencies. Tauri downloads its WiX/NSIS tools during the first installer build, so first builds need network access.

For a different vcpkg location, set this in each build shell:

```powershell
$env:VCPKG_ROOT = 'D:\tools\vcpkg'
```

## 3. Build PixForge

For a native development window with hot reload, run `pnpm tauri dev`.
On Windows the launcher automatically adds Rust and NASM to its PATH, initializes
the Visual Studio C++ environment, and configures static dav1d/pkgconf from
`C:\Dev\vcpkg` (or `VCPKG_ROOT`). No manual environment block is needed for each
terminal. The same environment setup is shared by installer builds.

```powershell
Set-Location C:\code\pix-forge
pnpm install --frozen-lockfile
pnpm test

# NSIS installer: PixForge_0.1.0_x64-setup.exe
pnpm dist:exe

# MSI installer: PixForge_0.1.0_x64_en-US.msi
pnpm dist:msi

# Build both installers in one run
pnpm dist:windows

# Standalone application executable, without an installer
pnpm dist:app
```

The build script initializes MSVC, validates NASM/dav1d, configures pkg-config and invokes Tauri. `pnpm build` alone produces the web frontend, not a Windows executable.

Outputs (names can include the installer language):

```text
apps\desktop\src-tauri\target\x86_64-pc-windows-msvc\release\pix-forge.exe
apps\desktop\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\*-setup.exe
apps\desktop\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\*.msi
```

Open the installer output folder:

```powershell
Invoke-Item .\apps\desktop\src-tauri\target\x86_64-pc-windows-msvc\release\bundle
```

The standalone executable requires WebView2 and the Microsoft Visual C++ runtime on the destination machine. Prefer the installer for distribution. The installer downloads the WebView2 bootstrapper if needed; it is not a fully offline installer. These are unsigned builds unless you configure a Windows code-signing certificate.

## MSI optional Windows component

Tauri's WiX MSI build requires the VBScript optional capability. If MSI bundling fails in `light.exe` and VBScript is disabled, run **PowerShell as Administrator**:

```powershell
Get-WindowsCapability -Online | Where-Object Name -Like 'VBSCRIPT*'
Get-WindowsCapability -Online | Where-Object Name -Like 'VBSCRIPT*' | Add-WindowsCapability -Online
```

Reboot if Windows requests it, then retry `pnpm dist:msi`. NSIS `.exe` builds do not require this MSI-specific component.

References: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [Windows installers and VBScript](https://v2.tauri.app/distribute/windows-installer/), [custom window titlebar](https://v2.tauri.app/learn/window-customization/), [vcpkg static-MD triplet](https://github.com/microsoft/vcpkg/blob/master/triplets/x64-windows-static-md.cmake), [dav1d system dependency](https://github.com/rust-av/dav1d-rs/blob/master/dav1d-sys/Cargo.toml).
