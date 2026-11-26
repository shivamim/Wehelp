const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function processor(chunkMs = 100) {
    let Processor;
    const messages = [];
    vm.runInNewContext(fs.readFileSync('src/audio/audio-worklet.js', 'utf8'), {
        sampleRate: 24000,
        AudioWorkletProcessor: class {
            constructor() {
                this.port = { postMessage: value => messages.push(value) };
            }
        },
        registerProcessor: (_name, cls) => {
            Processor = cls;
        },
        Int16Array,
        ArrayBuffer,
    });
    return { processor: new Processor({ processorOptions: { chunkMs } }), messages };
}
test('worklet bounds unacknowledged audio and reports overload', () => {
    const { processor: p, messages } = processor(20);
    let active = true;
    for (let i = 0; i < 100 && active; i++) active = p.process([[new Float32Array(128).fill(1)]]);
    assert.equal(messages.filter(m => m.pcm).length, 4);
    assert.ok(messages.some(m => m.overflow));
    assert.equal(active, false);
});
test('worklet emits all chunk profiles in PCM with clipping protection', () => {
    for (const duration of [20, 40, 60, 100]) {
        const { processor: p, messages } = processor(duration);
        for (let i = 0; i < Math.ceil((24 * duration) / 128); i++) p.process([[new Float32Array(128).fill(2)]]);
        assert.equal(messages[0].pcm.byteLength, duration * 24 * 2);
        assert.equal(new Int16Array(messages[0].pcm)[0], 32767);
        p.port.onmessage({ data: { ack: messages[0].pcm } });
        assert.equal(p.outstanding, 0);
    }
});
test('AudioSession closes processing resources and can preserve tracks for pause', async () => {
    const source = fs.readFileSync('src/audio/audio-session.js', 'utf8');
    const AudioSession = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).AudioSession;
    const closed = { tracks: 0, nodes: 0, ports: 0, sources: 0, contexts: 0 };
    const session = new AudioSession({ send: () => {}, onError: () => {} });
    for (let i = 0; i < 2; i++)
        session.resources.add({
            stream: { getTracks: () => [{ stop: () => closed.tracks++ }] },
            context: { state: 'running', close: async () => closed.contexts++ },
            node: { port: { close: () => closed.ports++ }, disconnect: () => closed.nodes++ },
            source: { disconnect: () => closed.sources++ },
        });
    await session.stop({ keepStreams: true });
    assert.deepEqual(closed, { tracks: 0, nodes: 2, ports: 2, sources: 2, contexts: 2 });
    assert.equal(session.resources.size, 0);

    session.resources.add({ stream: { getTracks: () => [{ stop: () => closed.tracks++ }] } });
    await session.stop();
    await session.stop();
    assert.equal(closed.tracks, 1);
    assert.equal(session.resources.size, 0);
});
