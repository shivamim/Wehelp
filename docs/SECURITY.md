# Security and privacy

## Optional Windows capture-exclusion privacy (2.0.3)

A user-controlled setting now requests native Windows capture exclusion for the WeHelp window. It is off by default and keeps ordinary local capture controls, taskbar/tray visibility and recording indicators. It is not a guarantee about Google Meet, remote sessions or every capture method. See [Screen-sharing privacy](SCREEN_SHARING_PRIVACY.md) and verify the actual remote view before relying on it.

## Capture permission repair in 2.0.2

Display sharing is an Electron `display-capture` permission, not a camera request. The 2.0.1 handler rejected it before the consent chooser, causing “Capture error: Permission denied.” The repaired policy checks the exact local top frame and delegates display permission to the explicit sharing dialog. Camera requests remain denied; microphone requests still require confirmation. Both permission-check and permission-request handlers are installed. The display source is returned only after approval and rechecking the window/frame; Cancel returns no source. Real Electron display-capture smoke tests verify approval, video-track cleanup and cancellation in addition to policy unit tests.

Reference: [Electron session permissions](https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler).

## Implemented

- Pinned Electron 45.3.2, renderer `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, and insecure content disabled. The installed package was reviewed because modern Electron uses a lazy binary install; Node 24 meets its requirements.
- A local preload exposes explicit allowed operations/subscriptions; no renderer access to Node, ipcRenderer or arbitrary main-process channels. Main validates frame identity and the exact local application URL.
- CSP allows local scripts only, blocks remote renderer connections/frames/objects, and permits inline styles for the existing Lit/CSS application. Navigation and new windows are blocked; external links require HTTPS and no embedded credentials.
- DOMPurify sanitizes completed AI Markdown. Incomplete output is text. Real Electron smoke tests inspect the sanitized DOM and verify a malicious event/script fixture cannot execute. The test intentionally observes CSP rejection of injected event handlers.
- Secure credentials are initialized/injected before provider handlers are reachable. New writes use Electron safeStorage; unavailable encryption or Linux `basic_text` is rejected. Existing plaintext source is stripped only after a successful migration. Legacy encrypted records remain readable for migration and are re-encrypted when the secure backend permits it.
- Stored Gemini/Groq key material is never returned to renderer password fields. Replacement values necessarily originate in those user-input fields, then cross the restricted setter into main. They are not echoed back. Key verification caches are main-process only.
- Session file IDs reject traversal. Runtime configs, binary PCM, text/image payload sizes, external links and shortcut shapes receive IPC validation.
- Capture remains user controlled; the application does not request screen/microphone access at launch. System audio sharing and microphone sharing have explicit dialogs. Microphone-only sessions do not start screen sharing. Stop releases all tracked audio streams/nodes/contexts and native capture processes. No process-wide pkill remains.
- Conventional tray/window operation replaces taskbar/Mission Control concealment and unconditional content-protection settings. Custom movement/visibility/click-through shortcuts remain user controlled; no monitoring-evasion functionality was added.
- Raw provider transport logs are disabled. Main generation/local STT/relay no longer log transcripts or credential-bearing URLs. Native process output is opt-in via DEBUG_NATIVE. DEBUG_AUDIO remains an explicit developer diagnostic and can persist sensitive audio; do not enable it in ordinary sessions.
- Model/runtimes are downloaded lazily after a confirmation; upstream checksums are preserved. Strict Offline does not download or discover. Native servers bind loopback only. No API keys, test-user data or private logs are packaged.

## Limits and validation required

The Linux synthetic smoke uses a disposable data directory and `--no-sandbox` only because the container cannot provide Chromium's normal sandbox privileges. Production BrowserWindow sandbox settings remain enabled. Windows and macOS permissions, safeStorage backends, tray behavior, native processes, code signing and installer runtime behavior still need platform tests.

Gemini Live output and the preserved external relay retain their legacy text event contracts. They do not yet have the full request-ID/visible-latency coverage of the HTTP generation pipeline. Native voice cancellation ends the Live session; barge-in is handled separately. No external relay was contacted during validation.

No standalone TTS adapter, new GPU binary distribution or remote update mechanism was introduced. Optional Windows signing uses only externally supplied environment secrets. ASAR is packaging, not encryption. Keep GPL and third-party notices when distributing.

`npm audit --omit=dev` reported zero production vulnerabilities during this work. This is a dependency snapshot, not a security certification; continue normal dependency review.

Reference: [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
