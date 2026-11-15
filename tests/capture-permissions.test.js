const test = require('node:test');
const assert = require('node:assert/strict');
const { installCapturePermissions } = require('../src/security/capture-permissions');
function fixture({ response = 0, sources = [{ id: 'screen:fixture' }], show } = {}) {
    const trustedURL = 'file:///fixture/index.html',
        frame = { url: trustedURL },
        calls = [];
    let destroyed = false;
    const contents = { getURL: () => trustedURL, isDestroyed: () => destroyed, mainFrame: frame };
    const window = { webContents: contents, isDestroyed: () => destroyed };
    const session = {
        setPermissionCheckHandler(fn) {
            this.check = fn;
        },
        setPermissionRequestHandler(fn) {
            this.request = fn;
        },
        setDisplayMediaRequestHandler(fn) {
            this.display = fn;
        },
    };
    installCapturePermissions({
        session,
        window,
        trustedURL,
        dialog: {
            showMessageBox: async (...args) => {
                calls.push(args);
                return show ? show() : { response };
            },
        },
        desktopCapturer: { getSources: async () => sources },
    });
    return {
        session,
        contents,
        frame,
        calls,
        destroy: () => {
            destroyed = true;
        },
        details: { isMainFrame: true, requestingUrl: trustedURL },
    };
}
test('display-capture gate reaches the chooser while camera/media stays ungranted', async () => {
    const f = fixture();
    assert.equal(f.session.check(f.contents, 'display-capture', 'file://', f.details), true);
    assert.equal(f.session.check(f.contents, 'media', 'file://', f.details), false);
    let granted;
    await f.session.request(
        f.contents,
        'display-capture',
        value => {
            granted = value;
        },
        { ...f.details, mediaTypes: ['video', 'audio'] }
    );
    assert.equal(granted, true);
    assert.equal(f.calls.length, 0); // explicit display chooser supplies the consent dialog
    await f.session.request(
        f.contents,
        'media',
        value => {
            granted = value;
        },
        { ...f.details, mediaTypes: ['video'] }
    );
    assert.equal(granted, false);
});
test('display sharing only returns loopback after explicit approval', async () => {
    const f = fixture();
    let result;
    await f.session.display({ frame: f.frame, audioRequested: true }, value => {
        result = value;
    });
    assert.equal(f.calls.length, 1);
    assert.equal(result.video.id, 'screen:fixture');
    assert.equal(result.audio, 'loopback');
});
test('cancelled sharing returns no source; video-only sharing does not grant audio', async () => {
    const denied = fixture({ response: 1 });
    let result;
    await denied.session.display({ frame: denied.frame, audioRequested: true }, value => {
        result = value;
    });
    assert.equal(result.video, undefined);
    const allowed = fixture();
    await allowed.session.display({ frame: allowed.frame, audioRequested: false }, value => {
        result = value;
    });
    assert.equal(result.audio, undefined);
});
test('microphone still requires explicit approval and untrusted frames are denied', async () => {
    const f = fixture({ response: 1 });
    let granted;
    await f.session.request(
        f.contents,
        'media',
        value => {
            granted = value;
        },
        { ...f.details, mediaTypes: ['audio'] }
    );
    assert.equal(granted, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.session.check(f.contents, 'display-capture', 'file://', { ...f.details, isMainFrame: false }), false);
    assert.equal(f.session.check(f.contents, 'display-capture', 'file://', { ...f.details, requestingUrl: 'https://untrusted.example' }), false);
    await f.session.display({ frame: {}, audioRequested: true }, result => {
        assert.equal(result.video, undefined);
    });
    assert.equal(f.calls.length, 1);
});
test('closing a window while consent is open cannot grant a capture stream', async () => {
    const f = fixture({
        show: () => {
            f.destroy();
            return { response: 0 };
        },
    });
    let result;
    await f.session.display({ frame: f.frame, audioRequested: true }, value => {
        result = value;
    });
    assert.equal(result.video, undefined);
});
