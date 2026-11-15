# Screen-sharing privacy (Windows)

In version 2.0.3, open Settings → Response engine and audio → Screen-sharing privacy, then enable **Hide WeHelp from screen capture (Windows)**. The option is off by default, takes effect without restarting a session, and is remembered across launches. WeHelp stays visible to you. Disable the option to allow normal capture again.

This uses Electron's native `setContentProtection` API, which asks Windows to exclude this window from compatible capture APIs. It does not hide the process, remove ordinary desktop controls or change recording consent. Capture activity indicators remain visible locally.

**This is best effort, not a guarantee of invisibility in Google Meet.** Windows version, browser capture path, remote-session software and other capture methods can change the result. Modern Windows may omit the window; older capture paths may show a black rectangle or still capture it. A native enabled flag confirms the setting was requested, not what a remote participant sees. Wait for the display to refresh and check the shared view from a separate participant/device before relying on it. Sharing a specific application window is the more reliable way to avoid sharing unrelated desktop windows.

Linux and macOS are not offered this toggle in WeHelp. Electron documents that modern macOS ScreenCaptureKit can ignore its protection API. No Google Meet session was used for the automated tests. Windows CI tests validate native enable/disable and settings persistence only; they do not prove invisibility across sharing clients.

Reference: [Electron content protection](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows).

## Taskbar and local window controls (2.0.4)

In Settings → Response engine and audio, enable **Hide from taskbar** to omit the window from the Windows/Linux taskbar. The tray icon remains available: choose **Show WeHelp** to restore/focus the window or **Quit WeHelp** to exit. This setting is off by default and persists across launches. macOS does not expose this taskbar option.

Use **Always on top** separately to keep the window above ordinary application windows, and the existing appearance/transparency setting to adjust its local appearance. Taskbar hiding does not itself exclude anything from screen sharing.
