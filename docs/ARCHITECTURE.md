# Architecture

The entry point remains `src/index.js`; the application remains Electron Forge plus Lit. There is no React/TypeScript rewrite.

## Startup and shutdown

Main process: single-instance lock → non-destructive storage migration → instantiate/inject ApiKeyManager and runtime config getter → register validated IPC → create isolated window → create tray → ready. Capture does not start at application launch. Closing normally minimizes to the tray when enabled; tray Quit shuts down providers/native processes and awaits pending persistence. Existing configuration and Electron user-data paths are retained deliberately for branding compatibility.

Window navigation and new windows are blocked. HTTPS external links use a checked main-process operation. `preload.js` exposes fixed operations and fixed event subscriptions, with callbacks stripped of Electron events. `utils/bridge.js` preserves existing renderer call shapes without exposing arbitrary-channel privileged IPC. Main validates the exact top-frame file URL, settings, IDs, payload sizes, audio format and external URLs.

## Sessions and generation

`engine/request-manager.js` owns a single active request per session, an AbortController, session identity, sequence counter and cancellation. Requests follow PREPARING → CONNECTING → STREAMING → COMPLETED, or FAILED/CANCELLED/TIMED_OUT. The generation engine snapshots context, commits complete user/assistant pairs only on success, and prevents stale requests from updating the active UI/history.

`generation-service.js` orchestrates capability routing, bounded context, network adapters, first useful text, 32 ms delta batching, save and completion. Provider streams never re-send the accumulated answer across IPC. The existing Lit response list and Markdown renderer stay in place; only the currently displayed response updates. Status transitions finalize Markdown even if the final text is unchanged. Completed Markdown is sanitized with DOMPurify; growing blocks append text nodes. Scrolling respects users who have scrolled away.

The old renderer event contract remains for native Live output and the external relay. These legacy paths do not have full request-ID instrumentation; see limitations.

## Audio

`audio/audio-session.js` owns each stream, source, AudioWorkletNode and AudioContext. The worklet converts Float32 samples to signed mono PCM in a typed chunk buffer, with at most four unacknowledged chunks. Overload stops capture and reports an error instead of growing a queue. Binary 24 kHz PCM crosses the internal IPC boundary. The Live boundary converts to 16 kHz PCM and encodes base64 once. Local Whisper keeps its existing 24→16 kHz resampling boundary. Separate microphone and system inputs own independent processing resources.

The worklet supports 20/40/60/100 ms chunks; 100 ms remains the compatibility default. No deprecated ScriptProcessor fallback remains, because the pinned Electron version supports AudioWorklet. Unsupported processor initialization reports failure and releases devices rather than silently falling back.

Provider VAD handles Gemini streaming. Duration-based local endpointing uses 200 ms pre-roll, configurable silence and a 30 second utterance cap. RMS VAD is simple and needs real-room validation. Groq utterance STT uses WAV uploads and bounded in-flight transcription. Native Live audio output uses a bounded playback scheduler cleared on interruption or Stop.

## Models and privacy boundaries

Curated capabilities merge with cached account discovery in `model-registry.js`. Discovery never infers vision/Live/reasoning from an unfamiliar name. Automatic selection prefers documented low-latency candidates and considers observed latency for remaining candidates. Explicit selections are not overwritten. A same-provider fallback is bounded to one attempt before any useful output and needs verified availability. No provider racing or automatic cross-provider fallback occurs.

Offline skips remote discovery, key verification and native downloads/metadata. Cached native model manifests retain downloaded checksums. CPU threading is bounded; GPU-specific tuning beyond the preserved macOS Metal path remains a hardware validation task.

## Persistence and metrics

Configuration/history writes use asynchronous per-file queues, temporary files and atomic renames. Pending values provide read-your-writes behavior; shutdown awaits completion. Version upgrades retain prior configuration, preferences, credentials and history; history IDs cannot escape the history directory. Completed turns are appended asynchronously by main to per-session `.turns.jsonl` journals beside existing JSON metadata. Reading merges legacy JSON turns and journal records. This avoids rewriting full histories on each completion and preserves persisted turns beyond the 200-response in-memory display window. Closing a renderer does not discard an already queued main-process save.

Performance records use a monotonic clock, bounded recent samples and request IDs. The dashboard reads snapshots on demand instead of polling. Exports contain operational timings/model metadata, never content or credentials. Throughput and context counts are conservative estimates rather than provider tokenizer claims.
