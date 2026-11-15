# Windows x64 distribution

## Reproduce on Windows

Use a Windows x64 machine, Node.js 24 LTS, npm and the checked-in lockfile. Install required Windows build tools if native dependency rebuilding asks for them. Do not configure API keys in a release-build workspace.

```powershell
npm ci
npm test
npm run check
npm run benchmark
npm start
npm run package -- --platform=win32 --arch=x64
npm run make -- --platform=win32 --arch=x64
```

Electron 45 installs its binary lazily when first used. `npx install-electron` can explicitly prepare it. CI handles this through the normal Forge invocation.

Paths:

- Packaged app: `out/WeHelp-win32-x64/WeHelp.exe`
- Installer: `out/make/squirrel.windows/x64/` (setup executable, RELEASES and NuGet package)
- GitHub Actions artifact: **WeHelp-Windows-x64** from the Validate WeHelp workflow, after its Windows make job succeeds.

The Windows package name/product/shortcut metadata use WeHelp 2.0.0. Existing configuration directories are retained to preserve installed users' settings and history. Existing icon artwork is retained in .ico/.png/.icns formats; no unrelated visual redesign was performed.

## Results in this environment

A Linux → Windows x64 Forge package completed successfully and produced the expected executable and ASAR. The ASAR inventory included `src/index.js` and `src/preload.js`; tests/docs/scripts/benchmarks/private logs were excluded. This validates cross-packaging, not executable launch on Windows. No Windows OS, Wine, signing identity or installer execution was available. A Windows Squirrel installer was therefore not claimed as tested. The workflow builds it on a real Windows runner and uploads artifacts after success.

## Signing

Provide signing credentials only through the build environment/CI secrets, never source code. Configure `makers[0].config.certificateFile` and `certificatePassword` via `WEHELP_SIGN_CERT` and `WEHELP_SIGN_PASSWORD`. Unsigned packages can trigger SmartScreen; release only after your signing and installer validation policy is satisfied. This project does not publish or upload a release automatically.

## Native resources

Main/renderer code and runtime dependencies are in ASAR. The existing macOS system-audio helper remains an extra resource for macOS compatibility. Whisper/llama binaries and large models remain outside the application in its existing configuration cache; verified downloads occur only when the user starts Local AI and approves missing downloads. Never embed personal models or credentials into the installer by copying the configuration directory into resources.

## Windows release verification

Validate clean install/uninstall, Start Menu/desktop shortcuts, first launch/onboarding, old-settings migration, encrypted credentials, text/voice/vision pipelines with authorized keys, microphone-only/system-only/both modes, Stop releasing devices, tray restore/Quit, user-controlled startup/always-on-top, native inference startup/cancellation, long-session resource behavior, and signed artifact integrity. Verify artifact paths from the actual make output rather than inventing filenames.

Distribute LICENSE, upstream attribution, third-party notices and corresponding modified source/build instructions under GPL-3.0 obligations.
