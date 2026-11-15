const test = require('node:test');
const assert = require('node:assert/strict');
const { applyScreenSharePrivacy } = require('../src/utils/screen-share-privacy');
const { validate } = require('../src/security/ipc-validation');
test('capture privacy can be enabled and disabled using the native window API', () => {
    let enabled = false;
    const calls = [];
    const window = {
        isDestroyed: () => false,
        setContentProtection: value => {
            calls.push(value);
            enabled = value;
        },
        isContentProtected: () => enabled,
    };
    applyScreenSharePrivacy(window, true, 'win32');
    applyScreenSharePrivacy(window, false, 'win32');
    assert.deepEqual(calls, [true, false]);
});
test('unsupported platforms, invalid values and failed native application report errors', () => {
    assert.throws(() => applyScreenSharePrivacy({}, true, 'linux'), /Windows only/);
    assert.throws(() => applyScreenSharePrivacy({}, 'true', 'win32'), /boolean/);
    assert.throws(() => applyScreenSharePrivacy({ isDestroyed: () => true }, true, 'win32'), /unavailable/);
    assert.throws(
        () => applyScreenSharePrivacy({ isDestroyed: () => false, setContentProtection() {}, isContentProtected: () => false }, true, 'win32'),
        /Windows did not enable/
    );
    applyScreenSharePrivacy(null, false, 'linux');
});
test('IPC accepts only boolean capture-privacy preferences', () => {
    validate('storage:update-config', ['hideFromTaskbar', true]);
    assert.throws(() => validate('storage:update-config', ['hideFromTaskbar', 'true']), /boolean/);
    validate('storage:update-config', ['screenSharePrivacy', true]);
    validate('storage:set-config', [{ screenSharePrivacy: false }]);
    assert.throws(() => validate('storage:update-config', ['screenSharePrivacy', 'true']), /boolean/);
});
