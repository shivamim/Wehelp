const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function captureHarness() {
    const calls = [];
    const audio = {
        enabled: true,
        readyState: 'live',
        stop() {
            this.readyState = 'ended';
        },
    };
    const video = {
        readyState: 'live',
        stop() {
            this.readyState = 'ended';
        },
    };
    const stream = { getAudioTracks: () => [audio], getTracks: () => [audio, video] };
    const window = { wehelp: { platform: 'win32' }, addEventListener() {} };
    const renderer = fs.readFileSync('src/utils/renderer.js', 'utf8').replace(/^import .*;\r?$/gm, '');
    vm.runInNewContext(renderer, {
        window,
        document: { readyState: 'loading', addEventListener() {}, querySelector: () => ({ setStatus: status => calls.push(status) }) },
        performance,
        navigator: {
            mediaDevices: {
                async getDisplayMedia() {
                    calls.push('share');
                    return stream;
                },
            },
        },
        VoiceOutput: class {
            async stop() {}
        },
        AudioSession: class {
            async add(input) {
                calls.push(input);
            }
            async stop({ keepStreams } = {}) {
                calls.push(keepStreams ? 'pause processing' : 'stop processing');
            }
        },
        ipcRenderer: {
            on() {},
            async invoke(channel, state) {
                if (channel === 'storage:get-config') return { success: true, data: { responseProvider: 'gemini' } };
                if (channel === 'storage:get-preferences') return { success: true, data: { audioMode: 'speaker_only' } };
                if (channel === 'capture:state') calls.push(state.active);
                return { success: true };
            },
        },
    });
    return { app: window.cheatingDaddy, calls, audio, video, stream };
}

test('pause and resume reuse the approved Windows stream across repeated cycles', async () => {
    const { app, audio, video, calls, stream } = captureHarness();
    assert.equal(await app.startCapture(), true);
    for (let i = 0; i < 3; i++) {
        assert.equal(await app.pauseCapture(), true);
        assert.equal(calls.at(-2), false);
        assert.equal(audio.enabled, false);
        assert.equal(video.readyState, 'live');
        assert.equal(await app.resumeCapture(), true);
        assert.equal(calls.at(-2), true);
        assert.equal(audio.enabled, true);
    }
    assert.equal(calls.filter(call => call === 'share').length, 1);
    assert.equal(calls.filter(call => call === stream).length, 4);
    await app.pauseCapture();
    await app.stopCapture();
    assert.equal(audio.readyState, 'ended');
    assert.equal(video.readyState, 'ended');
    assert.equal(await app.resumeCapture(), false);
});

test('resume reports ended audio sharing without opening another chooser', async () => {
    const { app, audio, calls } = captureHarness();
    assert.equal(await app.startCapture(), true);
    assert.equal(await app.pauseCapture(), true);
    audio.stop();
    assert.equal(await app.resumeCapture(), false);
    assert.match(calls.at(-1), /Stop this session and start a new one/);
    assert.equal(calls.filter(call => call === 'share').length, 1);
});
