// Electron treats display-capture separately from camera/microphone media.
// Granting that first permission only delegates to the explicit display chooser.
function installCapturePermissions({ session, window, trustedURL, dialog, desktopCapturer }) {
    const contents = window.webContents;
    function trusted(details = {}) {
        return (
            !window.isDestroyed() &&
            !contents.isDestroyed() &&
            contents.getURL() === trustedURL &&
            details.isMainFrame === true &&
            details.requestingUrl === trustedURL
        );
    }
    session.setPermissionCheckHandler((requester, permission, _origin, details) => {
        return requester === contents && trusted(details) && permission === 'display-capture';
    });
    session.setPermissionRequestHandler(async (requester, permission, callback, details = {}) => {
        if (requester !== contents || !trusted(details)) return callback(false);
        if (permission === 'display-capture') return callback(true); // chooser below still requires consent
        if (permission !== 'media' || !details.mediaTypes?.length || details.mediaTypes.some(type => type !== 'audio')) return callback(false);
        try {
            const result = await dialog.showMessageBox(window, {
                type: 'question',
                buttons: ['Allow microphone', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                message: 'Allow WeHelp to capture microphone audio for this session?',
                detail: 'Audio is sent to your selected provider. Stop Session ends capture.',
            });
            callback(result.response === 0 && trusted(details));
        } catch {
            callback(false);
        }
    });
    session.setDisplayMediaRequestHandler(async (request, callback) => {
        let completed = false;
        const finish = value => {
            if (completed) return;
            completed = true;
            try {
                callback(value);
            } catch {
                /* Requesting frame may have closed while the dialog was open. */
            }
        };
        const isMain = () =>
            !window.isDestroyed() &&
            !contents.isDestroyed() &&
            request.frame === contents.mainFrame &&
            contents.getURL() === trustedURL &&
            request.frame?.url === trustedURL;
        if (!isMain()) return finish({});
        try {
            const result = await dialog.showMessageBox(window, {
                type: 'question',
                buttons: ['Share primary display', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                message: request.audioRequested ? 'Share primary display and system audio with WeHelp?' : 'Share primary display with WeHelp?',
                detail: 'Screenshots are analyzed only when requested. Pause audio stops audio processing while sharing stays open. Stop Session ends sharing.',
            });
            if (result.response !== 0 || !isMain()) return finish({});
            const sources = await desktopCapturer.getSources({ types: ['screen'] });
            if (!isMain() || !sources[0]) return finish({});
            finish({ video: sources[0], ...(request.audioRequested ? { audio: 'loopback' } : {}) });
        } catch (error) {
            console.warn('Display capture could not start:', error.message);
            finish({});
        }
    });
}
module.exports = { installCapturePermissions };
