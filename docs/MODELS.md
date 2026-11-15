# Model support

Documentation was checked on 2026-11-15. Account-specific access still needs authenticated discovery and live validation. The installed SDK is pinned to `@google/genai` 3.3.0; `languageCodes`, Live transcription completion, session resumption and realtime-input configuration exist in its declarations. Unknown model IDs do not gain inferred capabilities.

| Operation                      | Curated models                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Gemini text/vision             | gemini-3.8-flash, gemini-3.1-flash-lite, gemini-2.5-flash, gemini-2.5-pro, gemini-4-carbon, gemini-4-argon, gemini-4-hydrogen |
| Gemini native Live             | gemini-3.8-live, gemini-3.1-flash-live-preview, gemini-2.5-flash-native-audio-preview-12-2025                                 |
| Gemini streaming transcription | gemini-3.5-transcribe-live                                                                                                    |
| Groq text                      | llama-3.1-8b-instant, llama-3.3-70b-versatile, openai/gpt-oss-20b, openai/gpt-oss-120b, qwen/qwen3.8-27b                      |
| Groq vision                    | qwen/qwen3.8-27b                                                                                                              |
| Groq utterance transcription   | whisper-large-v3-turbo, whisper-large-v3                                                                                      |
| Legacy Groq selection          | qwen/qwen3.6-27b retained, unverified until discovery confirms access                                                         |
| Local                          | Existing configured GGUF + multimodal projector, Whisper tiny.en/base.en/small.en and verified native runtimes                |

This is a maintained subset of provider offerings, not a claim to support every current model. Extended-thinking Live and TTS-only models are deliberately excluded until separate adapters and capability tests exist. Native Live already supplies speech output; standalone TTS is not exposed. Preview offerings can be removed by providers. Existing 2.5 entries are compatibility candidates and need current account confirmation.

Gemini transcription uses TEXT modality plus input transcription, without unused audio generation, system prompts or search tools. Native voice uses AUDIO plus input/output transcription and compatible persistent sessions. Unsupported diarization options and unconditional proactiveAudio were removed. Live response audio is forwarded for scheduled playback; interruption clears scheduled output. Modern text/vision requests use the Gemini REST SSE interface with separate system instructions, not a Live round trip.

Groq adapters apply reasoning_effort=low/medium/high only to GPT-OSS; Qwen can additionally disable reasoning with none. Non-reasoning models receive no reasoning controls. Vision choices are separate from text choices. HTTP errors include status-specific messages; abrupt streams fail without committing partial history.

Model availability uses provider list endpoints, cached for 15 minutes and deduplicated while in flight. Refresh is user initiated and disabled Offline. A successful list response verifies account visibility, not inference entitlement or measured speed. Curated metadata is merged only for recognized IDs.

## Official sources

- [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models)
- [Gemini Live overview](https://ai.google.dev/gemini-api/docs/live)
- [Gemini Live capabilities](https://aistudio.google.com/docs/live-api/capabilities)
- [Gemini Live transcription](https://aistudio.google.com/docs/live-api/live-transcribe)
- [Groq models](https://console.groq.com/docs/models)
- [Groq reasoning](https://console.groq.com/docs/reasoning)
- [Groq vision](https://console.groq.com/docs/vision)
- [Groq speech-to-text](https://console.groq.com/docs/speech-to-text)
