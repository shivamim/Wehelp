# Changelog

## 2.0.0 — release candidate

- Preserve the existing WeHelp Electron/Lit interface, prompts, shortcuts and history; update product metadata and retain GPL attribution.
- Connect secure credential/runtime initialization, preserve old configuration on schema migration, move stored keys behind an isolated main-process API, and add validated IPC/CSP/HTML sanitization.
- Add request/session identities, cancel-and-replace, ordered delta streaming, bounded timeouts/retries, capability-specific Gemini/Groq adapters, cached account model discovery and user-selected performance profiles.
- Replace ScriptProcessor capture with bounded AudioWorklet PCM transport, independent stream cleanup, endpointing/pre-roll, microphone-only/text-only modes, pause/resume and native Live audio playback.
- Add a performance dashboard, anonymized exports, reproducible credential-free fixtures, Node tests, Electron smoke tests and Windows CI packaging.
- Keep native Whisper/llama downloads verified and user confirmed. Strict Offline requires cached verified resources; local CPU thread usage is bounded.
- Store completed turns in an append-only journal alongside existing history metadata; keep memory/display bounded without deleting persisted turns.

This is a reviewable release candidate. Real account inference, device permissions/quality, native hardware performance, Windows installer execution and signing remain release validation gates. See docs/RELEASE_CHECKLIST.md.
