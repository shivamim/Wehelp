# Repository audit and implementation status

Baseline: commit `6dda0fe3d3cf3e8fe0a692556f90cc2ab69021ad`; initial fix PR head `1aec5a60e7760e9bf514724b2727b0a0a9909608`. Audit covered the main/renderer entry points, storage, provider/relay/native utilities, preload/window code, audio/debug utilities, incremental renderer, all view/app components, assets/entry references, package lock, Forge config, license and repository conventions. CSS and existing Lit components were preserved; aspirational React/shadcn/TypeScript notes did not justify a framework rewrite.

## Concrete findings

| Severity | Finding in baseline                                                                                                             | Resolution                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Critical | ApiKeyManager and runtime getters existed but were never injected; old plaintext fallback remained reachable                    | Initialize/inject before provider IPC/window; fail closed without manager; safeStorage setters and renderer metadata-only reads    |
| Critical | Schema mismatch reset removed the entire settings/history directory                                                             | Non-destructive v2 merge, backup legacy config, preserve other files                                                               |
| Critical | Node-enabled renderer, empty preload, permissive inline scripts, raw AI HTML sink                                               | Sandboxed isolated renderer, allowlisted preload, validated sender/payloads, restrictive CSP and DOMPurify                         |
| High     | Microphone-only still requested display/system capture; microphone context/stream escaped cleanup                               | Independent AudioSession resource ownership; no screen capture in mic-only; track/node/context stop tests                          |
| High     | ScriptProcessor, repeated array spread/splice and internal base64 round trips                                                   | AudioWorklet typed PCM, binary IPC, bounded acknowledgements, encoding at provider boundary                                        |
| High     | Groq text referenced undefined streamId and launched on first transcription fragment                                            | New request-specific generation engine; finalized transcription assembler and regression tests                                     |
| High     | Typed input sent to Groq and Gemini together                                                                                    | Direct selected text adapter; no unrelated Live request                                                                            |
| High     | HTTP timeout ended at headers; SSE ignored abrupt disconnects/provider errors/cancellation                                      | Header deadline plus first-useful-text, idle and overall deadlines; explicit SSE failures and abort propagation                    |
| High     | Shared generation state allowed overlap/stale response/history corruption                                                       | Request identity, session identity, sequence numbers, cancel-and-replace and success-only history commits                          |
| High     | Input transcription requested unsupported diarization fields, all Live models got proactive audio, TTS appeared in Live catalog | Curated capabilities; separate transcription/native voice setup; TTS excluded                                                      |
| High     | Session payload/transcript logs and relay token URL logs retained sensitive data                                                | Raw transport logging disabled; native/debug audio opt-in only; metadata metrics/export                                            |
| Medium   | Window/tray lifecycle and shortcut listeners duplicated on recreation                                                           | Single instance, conventional tray, explicit Quit cleanup, per-window handler replacement, duplicate shortcut registration removed |
| Medium   | Arbitrary session IDs could escape history paths; external URLs unrestricted                                                    | IPC and storage ID validation; HTTPS-only external URLs                                                                            |
| Medium   | Synchronous full settings/history writes on generation completion                                                               | Async atomic settings queue and append-only completed-turn journal; old JSON histories remain readable                             |
| Medium   | UMD streaming renderer imported as a default ES export; missing AdvancedView export                                             | Side-effect renderer import plus existing global; remove disconnected missing export; automated module resolution checks           |
| Medium   | Existing finalization could skip Markdown when final text did not change                                                        | Finalize on status transition as well as text changes; sanitize both formatting and sink                                           |
| Medium   | Update checks ran twice, contacted upstream unrelated package at launch and violated Offline privacy                            | Remove automatic remote update fetches; preserve local version display and explicit release links                                  |
| Medium   | Unbounded UI responses/context and speech accumulation                                                                          | Bounded display/context/request samples, pre-roll, 30-second utterances; persisted turns remain intact                             |
| Medium   | Native spawn errors/readiness checks and cancellation races                                                                     | Capture spawn errors, bounded readiness fetch, killed-process check, epoch guards and cancellation                                 |
| Medium   | No tests or useful baseline; typecheck script did not exist                                                                     | Node unit/integration fixtures, Electron smoke, syntax/import check, synthetic benchmark and honest platform gates                 |
| Medium   | Product/installer branding still upstream                                                                                       | WeHelp metadata and visible labels, original icons/attribution/license retained                                                    |

## Stage status

1. **Audit / instrumentation:** implemented bounded monotonic metrics/dashboard/export, synthetic historical audio baseline and mocked generation fixture. Real-provider/device baseline is blocked by absent authorized test keys/devices; no fabricated latency claims.
2. **Initialization / credentials / settings:** implemented and covered by migration/secure-store tests. Actual Windows/macOS secure backends require platform validation.
3. **Session / request cancellation:** implemented for HTTP/local generation and speech pipelines. Legacy native Live text/relay events retain compatibility; full request-ID instrumentation for those paths remains an explicit limitation.
4. **Gemini / Groq models:** official documentation reviewed; curated capability registry and cached discovery, text/vision/STT/native voice adapters implemented. Live smoke/account access requires keys. Standalone TTS and extended-thinking Live are intentionally not exposed without verified adapters.
5. **AudioWorklet:** implemented; real Electron worklet synthetic-stream test and resource cleanup passed. Real microphone/system/device quality and endpoint tuning require physical platform tests.
6. **Streaming / context:** implemented incremental deltas, safe final Markdown, scroll guard and estimated token budgets. Provider tokenizer-accurate counts and asynchronous conversation summaries are not claimed.
7. **Network / local inference:** bounded retries/deadlines, same-provider pre-output fallback, cooldown observations, offline verified caches and CPU limits implemented. GPU runtime validation and local model speed/quality benchmarks require supported hardware/model downloads.
8. **Electron security:** implemented and smoke tested for isolated renderer/preload, sanitized DOM and CSP. Windows/macOS security regression testing remains necessary.
9. **Desktop / lifecycle / branding:** conventional tray, explicit controls, positioning/shortcuts preserved, startup/always-on-top preferences, WeHelp branding. Platform tray/startup/install behavior requires validation.
10. **Tests / benchmarks:** runnable tests and fixture benchmarks implemented; see PERFORMANCE.md for exact run results and limits. No paid API tests were silently run.
11. **Windows packaging:** cross-packaged executable built; ASAR inventory inspected. Real Windows installer execution, signing and native inference verification remain open. CI supplies a Windows build/artifact job; its result must be checked after push.

## Remaining release risks

- Provider list visibility does not prove inference/Live entitlement; preview IDs can disappear. Do a real smoke test with the intended account before release.
- Gemini native audio feedback, double-input echo, natural pauses, accents/noise and long sessions need physical audio testing. RMS VAD is deliberately simple; it is not a trained speech detector or diarizer.
- Performance routing uses verified availability, supported operation, explicit preferences, observed latency/errors/cooldown and local memory/CPU hints; it does not claim an accurate provider quota API or automatic validated GPU selection.
- Image preprocessing preserves the existing asynchronous canvas path. Dedicated image workers, standalone speech synthesis, summary generation and advanced GPU-specific runtime tuning are not represented as completed features.
- Linux native runtime downloads were not supported by the existing platform release catalog. They remain explicitly unsupported rather than inventing unverified binaries.
- Existing external relay is preserved but not contacted or automatically selected. Its legacy event/state contract needs separate service-side integration validation.
- No Windows OS or signing identity was available. Cross-packaging is not release certification.

## Repository conventions

Prettier ran; unrelated formatting-only changes were excluded where possible. `npm run check` is a real syntax/import check, not a fictional typecheck. GPL-3.0 and upstream author attribution are retained. No release/merge was performed.
