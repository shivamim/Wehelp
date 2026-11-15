const { app, dialog } = require('electron');
app.disableHardwareAcceleration();
let response = 0,
    dialogs = 0;
const originalDialog = dialog.showMessageBox;
dialog.showMessageBox = async (_window, options) => {
    if (options?.buttons?.[0] === 'Share primary display') {
        dialogs++;
        return { response };
    }
    return originalDialog(_window, options);
};
const timeout = setTimeout(() => {
    console.error('CAPTURE_SMOKE_TIMEOUT');
    app.exit(1);
}, 25000);
app.on('browser-window-created', (_event, win) => {
    win.webContents.on('did-finish-load', async () => {
        try {
            const result = await win.webContents.executeJavaScript(
                `(async () => {
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                const tracks = stream.getTracks(); const hasVideo = stream.getVideoTracks().length > 0;
                tracks.forEach(track => track.stop());
                return { hasVideo, stopped: tracks.every(track => track.readyState === 'ended') };
            })()`,
                true
            );
            if (!result.hasVideo || !result.stopped || !dialogs) throw new Error('Approved display capture did not create and stop a track');
            response = 1;
            const denied = await win.webContents.executeJavaScript(
                `navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(stream => { stream.getTracks().forEach(track => track.stop()); return { rejected: false }; }, error => ({ rejected: true, name: error.name }))`,
                true
            );
            if (!denied.rejected) throw new Error('Cancel did not refuse display capture');
            console.log(
                'CAPTURE_SMOKE_PASS',
                JSON.stringify({ ...result, cancellationDenied: denied.rejected, cancellationError: denied.name, dialogs })
            );
            clearTimeout(timeout);
            app.quit();
        } catch (error) {
            console.error('CAPTURE_SMOKE_FAIL', error);
            clearTimeout(timeout);
            app.exit(1);
        }
    });
});
require('../src/index.js');
