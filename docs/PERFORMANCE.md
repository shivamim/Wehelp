# Performance and validation

## Reproduce

```sh
npm ci
npm test
npm run check
npm run benchmark
node benchmarks/pipeline.js --output benchmark-results.json
```

For the real Electron fixture, use a disposable `WEHELP_DATA_DIR` and run `npx electron scripts/electron-smoke.cjs`. Linux CI can use `xvfb-run -a`; the restricted development container used a separate Xorg dummy display and `--no-sandbox`. The application's production renderer sandbox flags stay enabled.

## Measured synthetic comparison

Environment: Linux x64, Node v24.22.1, AMD EPYC 9V74 80-Core Processor. The baseline algorithm is copied from repository revision `6dda0fe3d3cf3e8fe0a692556f90cc2ab69021ad`. Optimized source is the working-tree release candidate over `1aec5a60e7760e9bf514724b2727b0a0a9909608`. Both run in the same Node realm with one warmup and seven measurements. No network/API, device input, actual UI rendering or local model inference is included in these numbers.

Input: 60 seconds of synthetic mono 24 kHz PCM. The baseline exercises the original spread/splice/PCM/internal base64 algorithm; the comparison exercises the actual worklet processor with acknowledged buffer recycling in a host fixture. It does not simulate the cost of transferring buffers between OS processes or the browser audio scheduling thread.

| Algorithm                      | P50 CPU time | P95 CPU time |
| ------------------------------ | -----------: | -----------: |
| Original capture/encoding loop |    45.850 ms |    95.615 ms |
| Worklet fixture, 20 ms chunks  |     7.197 ms |     9.275 ms |
| Worklet fixture, 40 ms chunks  |     5.497 ms |     8.115 ms |
| Worklet fixture, 60 ms chunks  |     6.978 ms |     8.337 ms |
| Worklet fixture, 100 ms chunks |     8.379 ms |    10.807 ms |

The 100 ms fixture used 37.472 ms less CPU time (81.7% less) in this run. This is a reduction in synthetic audio preparation overhead, **not** a claim that real assistant answers arrive that percentage faster. Timings vary with host load and JIT warmup. The 100 ms transport default is retained because this CPU-only test does not establish the best cloud endpointing/quality tradeoff.

The mocked generation fixture reports an immediate simulated render acknowledgement. Its timings are useful for regression detection only and must not be quoted as provider latency. See [raw fixture results](benchmark-results.json) for all observations and the explicit disclaimer.

## Electron observation

The actual Electron 45.3.2 fixture loaded the existing interface, opened settings/model registry, confirmed Node/process are unavailable in the renderer, exercised sanitized malicious HTML, captured synthetic WebAudio through a real AudioWorklet, acknowledged chunks and confirmed every synthetic stream track ended after Stop. It also navigated out of the assistant view to test listener cleanup. One observed JavaScript-entry-to-page-load measurement was 472.160 ms; this is a single Linux-container observation, not a before/after startup guarantee or Windows result.

## Runtime instrumentation

Main uses monotonic timestamps and bounded request records. The dashboard provides current provider/model, last/average/P50/P95/P99 request-to-visible latency, approximate throughput, RSS, CPU estimate, event-loop P95, active session/request counts, reconnections and audio backlog/transport duration. Audio initialization/processing metadata and HTTP-header/provider-first-token/total timings are available in metrics/exports. Renderer acknowledges visible text after Lit update and two animation frames, only while the response is actually displayed.

Connection, first-useful-text, stream-idle and total request deadlines are separate. Healthy headers do not remove stream protection. Completed/cancelled/failed requests are distinguishable. Exported samples contain model/type/status/timing identifiers and character counts, never audio, screenshots, transcript, prompts, responses or API keys.

Provider token counts are estimated from characters. Context limits are conservative UTF-8 estimates with separate image estimates. Native Live/relay output and some speech-start/end paths do not have complete request-level measurements yet; missing values remain null. End-of-speech→visible cannot be claimed without a reliable observed speech endpoint. Do not substitute transcript-arrival time for physical end of speech.

## Acceptance status

- Automated fixtures: 41 tests passed at the final validation checkpoint; see CI for subsequent changes.
- Syntax and relative import checks passed. No nonexistent typecheck script was claimed.
- Actual Electron isolated-window/settings/worklet/HTML/cleanup smoke passed.
- `npm ci` completed. Electron's lazy binary download required the environment's proxy-aware downloader and a writable temporary cache in this sandbox.
- Production dependency audit returned zero reported vulnerabilities at the checkpoint.
- Windows x64 Forge cross-package completed; executable and ASAR inventory verified.
- No real Gemini/Groq keys, authorized microphone/system devices, downloaded Whisper/llama models, GPU hardware, Windows installer runtime or code-signing identity were available for performance validation.

## Real-account benchmark procedure

Measure cold and warm runs separately for each selected model/account/region/network. Save the performance JSON/CSV after short/long prompts, long history, short/long speech, natural pauses, images, UI scrolling and extended sessions. Repeat with slow/disconnected streams and rate limiting using the mocked network suite. Record hardware, input source, network/region and model version. Compare first useful visible text and end-of-speech→visible, not merely tokens/sec.

Release targets remain UI feedback around 50 ms, warm sub-second text onset when provider/network permit, and live speech onset around 0.8–2 seconds under favorable conditions. Those are engineering targets, **not verified outcomes**. Physical-device quality, paid-provider timing, sustained CPU/memory and Windows behavior remain open release gates.
