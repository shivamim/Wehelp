# Changed-file summary

Every changed or added file in this release candidate is listed below. Existing LICENSE, author attribution, icons, theme variables and untouched application views remain in the repository.

| File | Purpose |
| --- | --- |
| `.github/workflows/validate.yml` | Linux/Windows tests and Electron smoke, Windows Squirrel make and artifact upload. |
| `CHANGELOG.md` | Release-candidate behavior and validation limits. |
| `README.md` | Setup, usage, supported pipelines, validation and license attribution. |
| `benchmarks/pipeline.js` | Historical audio comparison and mocked generation benchmark. |
| `docs/ARCHITECTURE.md` | Engineering documentation, observed results or explicit release gates; see the document title. |
| `docs/AUDIT.md` | Engineering documentation, observed results or explicit release gates; see the document title. |
| `docs/CHANGED_FILES.md` | Engineering documentation, observed results or explicit release gates; see the document title. |
| `docs/CONFIGURATION.md` | Engineering documentation, observed results or explicit release gates; see the document title. |
| `docs/MODELS.md` | Engineering documentation, observed results or explicit release gates; see the document title. |
| `docs/PERFORMANCE.md` | Engineering documentation, observed results or explicit release gates; see the document title. |
| `docs/RELEASE_CHECKLIST.md` | Engineering documentation, observed results or explicit release gates; see the document title. |
| `docs/SECURITY.md` | Engineering documentation, observed results or explicit release gates; see the document title. |
| `docs/WINDOWS_BUILD.md` | Engineering documentation, observed results or explicit release gates; see the document title. |
| `docs/benchmark-results.json` | Engineering documentation, observed results or explicit release gates; see the document title. |
| `forge.config.js` | WeHelp product/installer metadata, ASAR exclusions, license resource and external signing settings. |
| `package-lock.json` | Reproducible dependency updates. |
| `package.json` | WeHelp 2.0.0 metadata, Electron/SDK/security dependencies and real validation scripts. |
| `scripts/check.js` | Runnable syntax/import check or actual Electron smoke harness. |
| `scripts/electron-smoke.cjs` | Runnable syntax/import check or actual Electron smoke harness. |
| `src/assets/DOMPurify-LICENSE.txt` | DOMPurify license notice. |
| `src/assets/purify.min.js` | Vendored pinned DOMPurify runtime for local-only CSP. |
| `src/audio/audio-session.js` | Bounded typed PCM capture, endpointing, conversion or native voice playback. |
| `src/audio/audio-worklet.js` | Bounded typed PCM capture, endpointing, conversion or native voice playback. |
| `src/audio/endpoint.js` | Bounded typed PCM capture, endpointing, conversion or native voice playback. |
| `src/audio/pcm.js` | Bounded typed PCM capture, endpointing, conversion or native voice playback. |
| `src/audio/voice-output.js` | Bounded typed PCM capture, endpointing, conversion or native voice playback. |
| `src/components/app/AppHeader.js` | Preload bridge migration, WeHelp labels, explicit release link and no remote launch polling. |
| `src/components/app/CheatingDaddyApp.js` | Request-ID/delta handling, visible render acknowledgement, safe startup/session UI and bridge migration. |
| `src/components/index.js` | Remove unresolved disconnected AdvancedView export. |
| `src/components/views/AssistantView.js` | Safe final Markdown, side-effect UMD import, pause/cancel/capture indication and listener/scroll cleanup. |
| `src/components/views/CustomizeView.js` | Bridge migration, embedded engine/performance settings and text-only audio option. |
| `src/components/views/EngineSettings.js` | Capability-filtered models, performance/routing/audio controls, local hardware hints and metric exports. |
| `src/components/views/FeedbackView.js` | Keep feedback available through an explicit external browser action under the stricter CSP. |
| `src/components/views/HelpView.js` | Point the project website link to WeHelp while retaining the upstream link. |
| `src/components/views/MainView.js` | Secure key replacement/deletion/errors, compatible engine selectors, local-mode synchronization and branding. |
| `src/components/views/OnboardingView.js` | WeHelp visible branding; onboarding flow preserved. |
| `src/engine/context-manager.js` | Modular tested request/model/context/network/performance engine service. |
| `src/engine/generation-service.js` | Modular tested request/model/context/network/performance engine service. |
| `src/engine/model-registry.js` | Modular tested request/model/context/network/performance engine service. |
| `src/engine/model-router.js` | Modular tested request/model/context/network/performance engine service. |
| `src/engine/network.js` | Modular tested request/model/context/network/performance engine service. |
| `src/engine/performance-monitor.js` | Modular tested request/model/context/network/performance engine service. |
| `src/engine/request-manager.js` | Modular tested request/model/context/network/performance engine service. |
| `src/engine/transcription.js` | Modular tested request/model/context/network/performance engine service. |
| `src/index.html` | Local-only scripts/CSP, sanitizer load, valid module ordering and WeHelp title. |
| `src/index.js` | Startup injection, validated IPC, capture status, tray lifecycle, shutdown and secure credential views. |
| `src/preload.js` | Fixed isolated operations and event subscriptions. |
| `src/providers/gemini.js` | Capability-specific cloud streaming/transcription adapter. |
| `src/providers/groq.js` | Capability-specific cloud streaming/transcription adapter. |
| `src/security/ipc-validation.js` | Trusted-sender and operation-specific IPC validation. |
| `src/storage.js` | Schema-preserving migration, fail-closed credentials, async atomic settings and append-only history. |
| `src/utils/apiKeys.js` | OS-backed encryption, safe migration, key-rotation-aware verification and deletion. |
| `src/utils/bridge.js` | Renderer compatibility facade over fixed preload operations with listener cleanup. |
| `src/utils/cloud.js` | Preserve relay compatibility; remove token URL/transcript console logging. |
| `src/utils/gemini.js` | Live/transcription lifecycle, provider boundary, direct generation routing, bounded waits and cleanup. |
| `src/utils/localai.js` | Preserved native inference, cancellation/epoch guards, streaming IDs, context budgets and VAD. |
| `src/utils/native-ai-runtime.js` | Verified cached Offline preparation, spawn/readiness handling and opt-in native logs. |
| `src/utils/renderer.js` | AudioWorklet resource ownership, binary IPC, microphone/text-only flows, pause and playback. |
| `src/utils/streamingRenderer.js` | Sanitize HTML sink and keep growing content as incremental text. |
| `src/utils/transportLogger.js` | Disable sensitive transport payload persistence; keep compatibility API. |
| `src/utils/window.js` | Isolated window, capture authorization, navigation controls and shortcut/lifecycle cleanup. |
| `tests/audio-worklet.test.js` | Deterministic credential-free regression/integration tests. |
| `tests/engine.test.js` | Deterministic credential-free regression/integration tests. |
| `tests/network.test.js` | Deterministic credential-free regression/integration tests. |
| `tests/storage.test.js` | Deterministic credential-free regression/integration tests. |
| `docs/windows-package-validation.json` | Observed ASAR/executable/license inventory, with Windows runtime/installer explicitly untested. |
