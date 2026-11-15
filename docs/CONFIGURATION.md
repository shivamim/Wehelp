# Configuration and migrations

The schema version is 2. Existing per-OS `cheating-daddy-config` directories stay authoritative to preserve all installed user data. Electron's former user-data directory is likewise retained. `WEHELP_DATA_DIR` can explicitly select a separate data directory (used by automated tests). No history is removed because a config version changes. A legacy config is backed up as `config.json.v1-backup`; malformed files leave history/preferences intact and receive defaults.

| Setting               | Default                       | Meaning                                          |
| --------------------- | ----------------------------- | ------------------------------------------------ |
| performanceMode       | balanced                      | instant / balanced / deep / live-voice / offline |
| responseProvider      | auto                          | auto / gemini / groq / local                     |
| responseStyle         | standard                      | concise / standard / detailed                    |
| geminiLiveModel       | gemini-3.1-flash-live-preview | Compatible native Live ID                        |
| geminiChatModel       | auto                          | Shared Gemini text/vision selection              |
| groqModel             | auto                          | Groq text selection                              |
| groqImageModel        | auto                          | Groq vision selection                            |
| transcriptionProvider | gemini                        | gemini streaming or groq utterance upload        |
| transcriptionModel    | gemini-3.5-transcribe-live    | Capability checked against provider              |
| audioChunkMs          | 100                           | 20 / 40 / 60 / 100                               |
| endpointSilenceMs     | 700                           | 400–2000 ms accepted; UI presets                 |
| disableGroqThinking   | true                          | Only controls models supporting that setting     |
| groqMaxOutputTokens   | unset                         | Optional lower output ceiling, 128–16384         |
| alwaysOnTop           | false                         | Explicit desktop preference                      |
| minimizeToTray        | true                          | Conventional tray behavior                       |
| launchAtLogin         | false                         | OS login-item setting (validate on Windows)      |

Profiles cap generation at 512 / 1024 / 4096 tokens for Instant / Balanced / Deep. Those are ceilings, not output quotas. Context budgets are 8000 / 16000 / 32000 estimated tokens. System instructions and current input are never silently removed; excess input produces an explicit error. Local server context is 8192 and is budgeted separately.

Preferences preserve custom prompts, profile, language, image quality, typography, appearance, shortcuts and history settings. Audio modes are speaker_only, mic_only, both and text_only. `audioDeviceId` selects an authorized microphone. Device names appear only when OS permission allows them. Selecting Offline or Local in engine settings selects the local pipeline; changing provider/model/mode stops an active session. Restart the session after changing audio-device/input preferences.

Legacy model strings stay saved unless an invalid TTS-in-Live option is migrated. A saved ID absent from the curated capability registry causes an explicit selection error; choose a supported model in settings. Discovery failures retain documented candidates as **unverified**, never relabel them as available.

Secrets migrate only after secure persistence succeeds. Failure retains the legacy source file and warns; no fallback writes new keys to plaintext. Raw stored keys are not read back into renderer password fields; fields show a saved marker and support explicit replacement/deletion.
