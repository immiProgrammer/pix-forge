# GitHub Releases

## Build checks before releasing

`.github/workflows/check.yml` runs frontend checks and Linux native tests. `.github/workflows/windows.yml` runs frontend and Windows native tests, then builds both Windows x64 installers on pushes to `master`/`main`, pull requests, and manual runs. Download the `pixforge-windows-x64-test` artifact from the completed Actions run to test the installers without publishing a release.

Windows checks and releases share `.github/actions/setup-windows/action.yml` for the same pinned codec dependencies and toolchain setup.

To run the installer build locally on Windows:

```powershell
pnpm install --frozen-lockfile
pnpm test
./scripts/build-windows.ps1 -Bundle all -Locked
```

The installers are written to `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` and `bundle/msi/`. Native tests can be run separately after dot-sourcing `./scripts/windows-env.ps1` using `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`.

## Release workflow

`.github/workflows/release.yml` builds **Windows x64** installers and publishes them to GitHub Releases. It produces:

- The NSIS `.exe` setup installer.
- The `.msi` installer.
- `SHA256SUMS.txt` covering both installers.

The workflow installs pinned vcpkg dependencies (static dav1d and pkgconf), configures Rust/MSVC/NASM, checks MSI prerequisites, runs frontend and native tests, and builds with Cargo's locked dependency resolution. Rust and native codec caches reduce later build times. Build artifacts are retained for 14 days independently of the GitHub Release.

## Publish a version

1. Push this repository, including the workflow, to a GitHub remote. Enable Actions in the repository if needed. No personal access token is required: the publishing job uses the repository's built-in `GITHUB_TOKEN` with `contents: write`.
2. Set the same version in `package.json`, the desktop package in `apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.toml`, and `apps/desktop/src-tauri/tauri.conf.json`. Update `apps/desktop/src-tauri/Cargo.lock` after changing the Rust package version and commit the changes. The workflow rejects mismatched versions.
3. Create and push a version tag on that commit. For the current version:

   ```sh
   git tag v0.1.0
   git push origin HEAD
   git push origin v0.1.0
   ```

4. Follow **Actions → Release Windows**. After tests and both installer builds pass, the publishing job creates a draft, uploads the installers and checksums, and publishes the completed release. Tags containing a prerelease suffix are marked as prereleases.

The tag is the release trigger: pushing an ordinary commit does not publish a release. Tag names must follow `vMAJOR.MINOR.PATCH`, optionally with a prerelease suffix, and match the application version exactly.

## Manual builds and retries

In **Actions → Release Windows → Run workflow**, enter an existing version tag. The workflow checks out that exact tag and validates that its commit and app version match. The tagged commit must contain the release scripts and build configuration.

If a build fails, fix the issue and create a new version/tag. You can rerun a failed workflow to recover from a temporary download or runner failure. A partially uploaded draft can be resumed; matching draft assets are replaced before publishing. Already published releases are never overwritten by this workflow, which also supports repositories using immutable releases.

## Signing and platforms

These builds are unsigned, so Windows may show an unknown-publisher warning. Code signing and updater signatures are not configured. The EXE installer can install WebView2 when needed; the runtime must be available for the app. See [Windows build instructions](WINDOWS-BUILD.md) for installation/runtime details.

This workflow targets Windows x64 only. macOS signing/notarization, Linux packages, and other CPU architectures require additional build jobs and their platform dependencies.

References: [Tauri on GitHub Actions](https://v2.tauri.app/distribute/pipelines/github/), [GitHub Releases API](https://docs.github.com/en/rest/releases/releases).
