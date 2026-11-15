// Best-effort, OS-supported window capture exclusion. This is not a guarantee
// about a specific browser, sharing service, remote session or external camera.
function applyScreenSharePrivacy(window, enabled, platform = process.platform) {
    if (typeof enabled !== 'boolean') throw new Error('Screen-sharing privacy must be a boolean');
    if (platform !== 'win32') {
        if (enabled) throw new Error('Screen-sharing capture exclusion is currently supported by WeHelp on Windows only');
        return;
    }
    if (!window || window.isDestroyed()) throw new Error('The WeHelp window is unavailable');
    window.setContentProtection(enabled);
    if (window.isContentProtected() !== enabled) throw new Error('Windows did not enable the requested capture-exclusion setting');
}
module.exports = { applyScreenSharePrivacy };
