# Changelog

## 2.0.3 — optional screen-sharing privacy

- Add an opt-in Windows capture-exclusion toggle under Response engine and audio → Screen-sharing privacy.
- Apply it immediately, preserve it across restart, and validate boolean settings through the restricted IPC bridge.
- Keep the app visible locally and retain ordinary capture/session controls. Do not claim universal Google Meet invisibility.

## 2.0.2 — capture permission repair

- Handle Electron display-capture permission separately from camera/microphone media permission.
- Keep display sharing behind a trusted-frame check and explicit consent dialog; camera requests remain denied.
- Pair permission checks with request handling, preserve microphone confirmation, and recheck the frame after consent.
- Show input-specific permission guidance on Home.
- Add permission-policy regression tests and real Electron display-capture consent/cancellation smoke coverage.

## 2.0.1 — session startup repair

- Wait for secure key persistence before Start, including keyboard starts without blur.
- Show an explicit saved-key message after clearing password fields.
- Surface actual Live/model errors on Home instead of silently returning or replacing them with a generic status.
- Show startup progress, disable duplicate starts, and re-enable Start after failure.
- Add regression tests for pending key saves, secure-store failures and provider handshake errors; Electron smoke now verifies the Home error is visible.

## 2.0.0 — release candidate

- Preserve the existing WeHelp Electron/Lit interface, prompts, shortcuts and history; update product metadata and retain GPL attribution.
- Connect secure credential/runtime initialization, preserve old configuration on schema migration, move stored keys behind an isolated main-process API, and add validated IPC/CSP/HTML sanitization.
- Add request/session identities, cancel-and-replace, ordered delta streaming, bounded timeouts/retries, capability-specific Gemini/Groq adapters, cached account model discovery and user-selected performance profiles.
- Replace ScriptProcessor capture with bounded AudioWorklet PCM transport, independent stream cleanup, endpointing/pre-roll, microphone-only/text-only modes, pause/resume and native Live audio playback.
- Add a performance dashboard, anonymized exports, reproducible credential-free fixtures, Node tests, Electron smoke tests and Windows CI packaging.
- Keep native Whisper/llama downloads verified and user confirmed. Strict Offline requires cached verified resources; local CPU thread usage is bounded.
- Store completed turns in an append-only journal alongside existing history metadata; keep memory/display bounded without deleting persisted turns.

This is a reviewable release candidate. Real account inference, device permissions/quality, native hardware performance, Windows installer execution and signing remain release validation gates. See docs/RELEASE_CHECKLIST.md.
