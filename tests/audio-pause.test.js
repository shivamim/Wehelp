const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function captureHarness() {
    const calls = [];
    const listeners = new Map();
    const states = [];
    let errorHandler;
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
        console: { warn() {} },
        navigator: {
            mediaDevices: {
                async getDisplayMedia() {
                    calls.push('share');
                    if (audio.readyState === 'live') return stream;
                    const freshAudio = { ...audio, readyState: 'live', enabled: true };
                    const freshVideo = { ...video, readyState: 'live' };
                    return { getAudioTracks: () => [freshAudio], getTracks: () => [freshAudio, freshVideo] };
                },
            },
        },
        VoiceOutput: class {
            async stop() {}
        },
        AudioSession: class {
            constructor({ onError }) {
                errorHandler = onError;
            }
            async add(input) {
                calls.push(input);
            }
            async stop({ keepStreams } = {}) {
                calls.push(keepStreams ? 'pause processing' : 'stop processing');
            }
        },
        ipcRenderer: {
            on(event, handler) {
                listeners.set(event, handler);
            },
            async invoke(channel, state) {
                if (channel === 'storage:get-config') return { success: true, data: { responseProvider: 'gemini' } };
                if (channel === 'storage:get-preferences') return { success: true, data: { audioMode: 'speaker_only' } };
                if (channel === 'capture:state') {
                    calls.push(state.active);
                    states.push(state);
                }
                if (channel === 'close-session') calls.push(channel);
                return { success: true };
            },
        },
    });
    return {
        app: window.cheatingDaddy,
        calls,
        audio,
        video,
        stream,
        states,
        power: sleeping => listeners.get('capture-power')({}, sleeping),
        fail: () => errorHandler(new Error('Device ended')),
    };
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

test('ended sharing requires an explicit audio retry and keeps the session open', async () => {
    const { app, audio, calls, states } = captureHarness();
    assert.equal(await app.startCapture(), true);
    assert.equal(await app.pauseCapture(), true);
    audio.stop();
    assert.equal(await app.resumeCapture(), false);
    assert.match(states.at(-1).recovery, /Select Retry audio/);
    assert.equal(calls.filter(call => call === 'share').length, 1);
    assert.equal(await app.resumeCapture(), true);
    assert.equal(calls.filter(call => call === 'share').length, 2);
    assert.ok(!calls.includes('close-session'));
});

test('sleep pauses audio until the user resumes after waking', async () => {
    const { app, power, audio, states, calls } = captureHarness();
    await app.startCapture();
    await power(true);
    assert.equal(audio.enabled, false);
    assert.equal(states.at(-1).pausedForSleep, true);
    assert.equal(await app.resumeCapture(), false);
    await power(false);
    assert.equal(audio.enabled, false);
    assert.equal(await app.resumeCapture(), true);
    assert.equal(audio.enabled, true);
    assert.equal(calls.filter(call => call === 'share').length, 1);
});

test('processor interruptions retain the conversation and offer audio retry', async () => {
    const { app, fail, audio, calls, states } = captureHarness();
    await app.startCapture();
    fail();
    assert.equal(audio.enabled, false);
    assert.match(states.at(-1).recovery, /interrupted/);
    assert.equal(await app.resumeCapture(), true);
    assert.equal(calls.filter(call => call === 'share').length, 1);
    assert.ok(!calls.includes('close-session'));
});
