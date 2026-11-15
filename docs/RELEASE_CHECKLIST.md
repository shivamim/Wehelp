# Release readiness

This is a release candidate for review, not a production certification. Do not merge solely because the source or cross-package exists.

## Implemented and verified here

- [x] Existing repository improved; entry point, Lit framework, layout/theme, prompts, onboarding, shortcuts, resizing and upstream license preserved.
- [x] Non-destructive settings migration and successful/failed secret migration fixtures.
- [x] Isolated/sandboxed renderer and explicit preload operations; unsafe navigation/URLs rejected.
- [x] 41 Node tests covering registry/capabilities/routing/context/settings/PCM/VAD/transcription/request cancellation/dedup/SSE/retries/deadlines/offline/history.
- [x] Actual Electron startup/settings/registry, sanitized DOM, synthetic AudioWorklet and complete track cleanup smoke.
- [x] Real syntax/import checks; clean dependency install and production dependency audit.
- [x] Synthetic historical audio-loop comparison and anonymized runtime metrics/export.
- [x] Windows x64 cross-package and ASAR inventory; no private user data/models/keys in package.
- [x] Automated Windows installer build/artifact workflow defined; no automatic release publication or merge.

## Implemented; manual/platform validation required

- [ ] Live inference and account model discovery with intended Gemini/Groq keys, including transcription finalization, rate limits and interruption.
- [ ] Native Live audio playback, no feedback/echo with selected audio sources, pause/resume, device disconnect and long natural pauses.
- [ ] Real microphone/system capture on Windows/macOS; Stop leaves no OS recording indicator/tracks/processes.
- [ ] Whisper/llama inference, supported GPU acceleration, model loading/cancellation and sustained memory/CPU on target hardware.
- [ ] Windows safeStorage/DPAPI, install/uninstall, shortcuts, tray restore/Quit, launch at login, settings migration and multiple-instance behavior.
- [ ] Exact Windows installer artifact from successful Windows CI, executable launch and signed release validation.
- [ ] Longer manual smoke: code fences/tables/Unicode/long responses, scrolling away, repeated provider switches and a one-hour authorized session.
- [ ] Real cold/warm startup and end-to-end latency baseline/after comparison under documented network/device conditions.

## Explicit remaining work

- [ ] Full request-ID/performance coverage for native Gemini Live output and the preserved external relay.
- [ ] Provider tokenizer-accurate context/throughput where reliable usage data is available; optional off-path summaries.
- [ ] Advanced noise-resistant local VAD/diarization, independently benchmarked image-worker preprocessing and validated GPU-specific runtime profiles.
- [ ] Standalone TTS and extended-thinking Live adapters, if wanted, after capability/SDK/account validation. They are not exposed as supported merely because the model exists.
- [ ] Add verified Linux native inference releases if Linux local inference becomes a supported distribution target.

## Distribution

- [ ] Run the intended Windows workflow to completion and inspect its logs/artifacts.
- [ ] Sign using externally provided credentials; never commit certificates/passwords/API keys.
- [ ] Distribute LICENSE, upstream attribution, third-party licenses and corresponding source/build instructions under GPL-3.0.
- [ ] Review preview-model risk and user-facing data handling before publication.

No production deployment, GitHub release or PR merge was performed by this work.
