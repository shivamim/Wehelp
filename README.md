# WeHelp 2.0

Real-time multimodal AI desktop assistant, built on the existing Electron Forge / Lit application. This update preserves the palette, compact layout, onboarding, prompts, shortcuts and saved history while replacing fragile request and audio plumbing.

## Develop

Use Node.js 24 LTS and npm:

```sh
npm ci
npm test
npm run check
npm run benchmark
npm start
```

`npm run check` validates JavaScript syntax and relative module resolution. This is a JavaScript project; it has no TypeScript typecheck script. On Linux Electron may need system GUI libraries and a display. Production builds retain renderer sandboxing; the smoke-test `--no-sandbox` argument is only for restricted CI containers.

## Use

1. Add your own Gemini and/or Groq key on Home. Keys stay in the main process and are encrypted with Electron `safeStorage`. A functional OS credential backend is required; Linux `basic_text` is rejected.
2. Open **Response engine and audio** on Home or Settings. Select Instant, Balanced, Deep, Live Voice or Offline. Model labels distinguish **unverified**, **available** and **unavailable**. Click **Verify model availability** to check your account; this never runs per generation.
3. Select the audio input in Settings. Microphone Only never starts screen/system capture. Text Only uses no audio device or Live connection. Sharing the screen for an image requires a separate explicit request when no screen is already shared.
4. Start a session. Capture permission dialogs explain what is shared. Use **Pause audio**, **Resume audio**, **Cancel answer**, or Stop Session. Cancel in native Live mode ends that Live session; barge-in uses provider interruption events.
5. View **Performance** in Settings. Export anonymized JSON/CSV measurements. Empty values mean no observation exists, not zero latency.

The existing external cloud relay backend remains for compatibility but is not advertised or selected automatically. No transcript, audio, screenshot or key is written to diagnostic logs by default. Conversation history still stores completed text turns locally; delete it in Settings when appropriate. Screenshots and raw audio are not retained by default.

## Pipelines

- Text: selected text provider → streamed deltas → existing renderer.
- Speech assistance: dedicated Gemini streaming transcription → selected text provider, or Groq Whisper utterance transcription → selected text provider. Groq Whisper is **not** represented as a streaming transcription API.
- Native voice: compatible persistent Gemini Live connection → audio playback and output transcription.
- Image: explicitly requested screenshot → compatible selected vision model → streamed response.
- Local: existing verified Whisper / llama.cpp runtimes, lazily started with explicit download confirmation. Strict Offline mode accepts only cached verified resources and makes no remote metadata/model-discovery requests.

New inputs use cancel-and-replace; fallback stays within the selected cloud provider, only in Automatic model selection, before any useful output, and only to a model verified available for the same operation. Explicit provider selection is respected. Local/Offline never silently falls back to cloud.

## Windows

```sh
npm ci
npm start
npm run package -- --platform=win32 --arch=x64
npm run make -- --platform=win32 --arch=x64
```

The unpacked package is `out/WeHelp-win32-x64/WeHelp.exe`. Squirrel installer outputs belong under `out/make/squirrel.windows/x64/`. See [Windows build instructions](docs/WINDOWS_BUILD.md) for signing, native resources, CI artifacts and validation requirements. An unsigned cross-packaged executable is not a Windows-tested installer.

## Engineering documentation

- [Technical audit and stage status](docs/AUDIT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Performance and measured results](docs/PERFORMANCE.md)
- [Models and verification sources](docs/MODELS.md)
- [Configuration and migration](docs/CONFIGURATION.md)
- [Security](docs/SECURITY.md)
- [Release readiness](docs/RELEASE_CHECKLIST.md)
- [Changelog](CHANGELOG.md)

## Attribution and license

WeHelp is a fork of [sohzm/cheating-daddy](https://github.com/sohzm/cheating-daddy), originally authored by Soham Bharambe. The original [GPL-3.0 license](LICENSE) and upstream attribution remain. Distributing a binary requires satisfying GPL source and license obligations, including modifications and build instructions. DOMPurify is vendored under its included Apache-2.0/MPL-2.0 license notice; Electron and bundled dependencies retain their own notices. The package's upstream author field is preserved.
