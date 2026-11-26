const test = require('node:test');
const assert = require('node:assert/strict');
const { ModelRegistry } = require('../src/engine/model-registry');
const { route } = require('../src/engine/model-router');
const { prepareContext } = require('../src/engine/context-manager');
const { PerformanceMonitor } = require('../src/engine/performance-monitor');
const { RequestManager } = require('../src/engine/request-manager');
const { TranscriptionTurns } = require('../src/engine/transcription');
const { GenerationService } = require('../src/engine/generation-service');
const { validate } = require('../src/security/ipc-validation');
const { pcm24to16, wav } = require('../src/audio/pcm');
const { Endpoint } = require('../src/audio/endpoint');
const { reasoningOptions } = require('../src/providers/groq');

test('registry rejects incompatible Live/TTS/vision IDs', () => {
    const r = new ModelRegistry();
    assert.throws(() => r.get('gemini', 'gemini-2.5-flash-preview-tts', 'live'));
    assert.throws(() => r.get('groq', 'openai/gpt-oss-20b', 'vision'));
    assert.equal(r.get('gemini', 'gemini-3.5-transcribe-live', 'transcription-live').availability, 'unverified');
});
test('discovery merges availability, caches, deduplicates; unknown IDs stay unknown', async () => {
    const r = new ModelRegistry();
    let calls = 0;
    const fetch = async () => {
        calls++;
        return Response.json({ data: [{ id: 'llama-3.1-8b-instant' }, { id: 'unknown-vision' }] });
    };
    await Promise.all([r.discover('groq', 'fake', fetch), r.discover('groq', 'fake', fetch)]);
    await r.discover('groq', 'fake', fetch);
    assert.equal(calls, 1);
    assert.equal(r.get('groq', 'llama-3.1-8b-instant', 'text').availability, 'available');
    assert.throws(() => r.get('groq', 'openai/gpt-oss-20b', 'text'));
    assert.throws(() => r.get('groq', 'unknown-vision', 'vision'));
});
test('failed discovery preserves unverified fallback', async () => {
    const r = new ModelRegistry();
    await assert.rejects(r.discover('groq', 'x', async () => new Response('', { status: 503 })));
    assert.equal(r.get('groq', 'llama-3.1-8b-instant', 'text').availability, 'unverified');
});
test('routing respects provider, modality and strict Offline boundary', () => {
    const r = new ModelRegistry();
    assert.equal(route(r, { performanceMode: 'offline', responseProvider: 'groq' }, { groq: 'x' }).provider, 'local');
    assert.equal(route(r, { responseProvider: 'gemini', geminiChatModel: 'auto' }, { groq: 'x', gemini: 'x' }).provider, 'gemini');
    assert.throws(() => route(r, { responseProvider: 'groq' }, {}));
    assert.equal(route(r, { responseProvider: 'groq', groqImageModel: 'auto' }, { groq: 'x' }, 'vision').model.id, 'qwen/qwen3.8-27b');
});
test('context retains system/current input and complete recent pairs within budget', () => {
    const result = prepareContext(
        'custom system',
        [
            { role: 'user', content: 'x'.repeat(30000) },
            { role: 'assistant', content: 'old' },
            { role: 'user', content: 'recent' },
            { role: 'assistant', content: 'answer' },
        ],
        'current',
        { budget: 1000, outputTokens: 100 }
    );
    assert.deepEqual(
        result.map(m => m.content),
        ['custom system', 'recent', 'answer', 'current']
    );
    assert.throws(() => prepareContext('essential'.repeat(500), [], 'current', { budget: 100, outputTokens: 50 }));
});
test('request replacement aborts previous request and session changes reject stale output', () => {
    const metrics = new PerformanceMonitor();
    const requests = new RequestManager(metrics);
    requests.startSession();
    const first = requests.begin('groq', 'model', 'text');
    const second = requests.begin('groq', 'model', 'text');
    assert.ok(first.controller.signal.aborted);
    assert.ok(!requests.current(first));
    assert.ok(requests.current(second));
    requests.stop();
    assert.ok(second.controller.signal.aborted);
    assert.equal(metrics.snapshot().activeSessions, 0);
});
test('monotonic metrics calculate latency and export no request content', () => {
    let now = 10;
    const metrics = new PerformanceMonitor({ now: () => now });
    const request = metrics.start('groq', 'model');
    now = 20;
    metrics.mark(request.requestId, 'firstToken');
    now = 25;
    metrics.mark(request.requestId, 'firstRendered');
    now = 40;
    metrics.finish(request.requestId, 'COMPLETED');
    assert.equal(metrics.snapshot().p95Ms, 15);
    assert.equal(metrics.snapshot().samples[0].firstTokenMs, 10);
    assert.ok(metrics.export('csv').startsWith('requestId,provider'));
    assert.ok(!metrics.export().includes('controller'));
});
test('finalized transcription emits once; fragments and next turns are complete', () => {
    const turns = new TranscriptionTurns();
    assert.equal(turns.accept({ inputTranscription: { text: 'Explain ' } }), null);
    assert.equal(turns.accept({ inputTranscription: { text: 'closures', finished: true } }), 'Explain closures');
    assert.equal(turns.accept({ inputTranscription: { text: 'closures', finished: true } }), null);
    assert.equal(turns.accept({ generationComplete: true }), null);
    turns.accept({ turnComplete: true });
    assert.equal(turns.accept({ inputTranscription: { text: 'Next' }, turnComplete: true }), 'Next');
});
test('legacy transcription completion fallback', () => {
    const turns = new TranscriptionTurns();
    turns.accept({ inputTranscription: { text: 'Question' } });
    assert.equal(turns.accept({ generationComplete: true }), 'Question');
    assert.equal(turns.accept({ turnComplete: true }), null);
});
test('IPC rejects path traversal, unknown preferences, oversized/invalid audio and unsafe URLs', () => {
    assert.throws(() => validate('storage:get-session', ['../../keys']));
    assert.throws(() => validate('storage:update-config', ['performanceMode', 'fake']));
    assert.throws(() => validate('storage:update-config', ['endpointSilenceMs', 100]));
    assert.throws(() => validate('storage:update-preference', ['__proto__', {}]));
    assert.throws(() => validate('open-external', ['javascript:alert(1)']));
    assert.throws(() => validate('audio:chunk', [{ pcm: new ArrayBuffer(50000), sampleRate: 24000, source: 'mic' }]));
    validate('audio:chunk', [{ pcm: new ArrayBuffer(4800), sampleRate: 24000, source: 'mic' }]);
});
test('PCM conversion produces 16k sample count, signed range and correct WAV header', () => {
    const input = Buffer.alloc(4800);
    for (let i = 0; i < input.length; i += 2) input.writeInt16LE(-32768, i);
    const result = pcm24to16(input);
    assert.equal(result.length, 3200);
    assert.equal(result.readInt16LE(0), -32768);
    assert.equal(wav(result, 16000).readUInt32LE(24), 16000);
    assert.equal(wav(result, 16000).readUInt32LE(40), 3200);
});
test('duration VAD preserves pre-roll and natural pauses across chunk profiles', () => {
    for (const chunkMs of [20, 40, 60, 100]) {
        let utterance;
        const endpoint = new Endpoint({
            silenceMs: 700,
            onEnd: data => {
                utterance = data;
            },
        });
        const voice = Buffer.alloc((24000 * 2 * chunkMs) / 1000);
        for (let i = 0; i < voice.length; i += 2) voice.writeInt16LE(10000, i);
        const silence = Buffer.alloc(voice.length);
        for (let i = 0; i < Math.ceil(600 / chunkMs); i++) endpoint.push(voice);
        for (let i = 0; i < Math.floor(300 / chunkMs); i++) endpoint.push(silence);
        assert.equal(utterance, undefined);
        endpoint.push(voice);
        for (let i = 0; i < Math.ceil(700 / chunkMs); i++) endpoint.push(silence);
        assert.ok(utterance.length > voice.length);
        assert.equal(endpoint.active, false);
    }
});
test('reasoning options match model capabilities', () => {
    const r = new ModelRegistry();
    assert.deepEqual(reasoningOptions(r.get('groq', 'llama-3.1-8b-instant', 'text'), 'instant', true), {});
    assert.equal(reasoningOptions(r.get('groq', 'openai/gpt-oss-20b', 'text'), 'instant', true).reasoning_effort, 'low');
    assert.equal(reasoningOptions(r.get('groq', 'qwen/qwen3.8-27b', 'text'), 'instant', true).reasoning_effort, 'none');
});
function service(adapter) {
    const events = [],
        saved = [],
        metrics = new PerformanceMonitor();
    const engine = new GenerationService({
        getConfig: () => ({ responseProvider: 'groq', groqModel: 'auto' }),
        getKeys: () => ({ groq: 'fake' }),
        emit: (channel, event) => {
            if (channel === 'response-stream') events.push(event);
        },
        save: (...args) => saved.push(args),
        metrics,
        adapters: { groq: { chat: adapter } },
    });
    engine.start();
    return { engine, events, saved, metrics };
}
test('full lifecycle streams ordered deltas and commits history only after success', async () => {
    const { engine, events, saved } = service(async function* () {
        yield 'Hello ';
        yield '世界';
    });
    assert.equal((await engine.generate('question')).success, true);
    assert.equal(
        events
            .filter(e => e.type === 'delta')
            .map(e => e.delta)
            .join(''),
        'Hello 世界'
    );
    assert.deepEqual(
        events.map(e => e.sequence),
        events.map((_, i) => i)
    );
    assert.equal(saved.length, 1);
    assert.equal(engine.history.length, 2);
});
test('cancelled/stopped request never commits history or stale UI output', async () => {
    let release;
    const wait = new Promise(resolve => {
        release = resolve;
    });
    const { engine, saved, events } = service(async function* () {
        yield 'first';
        await wait;
        yield 'stale';
    });
    const pending = engine.generate('question');
    await new Promise(resolve => setImmediate(resolve));
    engine.stop();
    release();
    assert.equal((await pending).success, false);
    assert.equal(saved.length, 0);
    assert.ok(!events.some(e => e.delta?.includes('stale')));
});
test('provider failure is visible and does not poison conversation history', async () => {
    const { engine, events, saved } = service(async function* () {
        throw new Error('network disconnected');
    });
    assert.equal((await engine.generate('question')).success, false);
    assert.equal(saved.length, 0);
    assert.equal(engine.history.length, 0);
    assert.ok(events.some(e => e.type === 'error'));
});
test('image context accounts for visual tokens, not base64 text length', () => {
    const input = [
        { type: 'text', text: 'Read this' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + 'x'.repeat(1000000) } },
    ];
    const messages = prepareContext('custom', [], input, { budget: 8000, outputTokens: 512 });
    assert.equal(messages.at(-1).content, input);
});
test('automatic fallback stays on authorized provider and only occurs before output', async () => {
    const attempted = [];
    const { engine, saved } = service(async function* ({ model }) {
        attempted.push(model.id);
        if (attempted.length === 1) throw new Error('provider unavailable');
        yield 'fallback answer';
    });
    for (const model of engine.registry.models.filter(m => m.provider === 'groq' && m.operations.includes('text'))) model.availability = 'available';
    assert.equal((await engine.generate('question')).success, true);
    assert.equal(attempted.length, 2);
    assert.equal(saved.length, 1);
});
test('partial output never triggers a second model request', async () => {
    let calls = 0;
    const { engine } = service(async function* () {
        calls++;
        yield 'partial';
        throw new Error('disconnected');
    });
    for (const model of engine.registry.models) model.availability = 'available';
    assert.equal((await engine.generate('question')).success, false);
    assert.equal(calls, 1);
});
test('Automatic routing avoids models in an observed rate-limit cooldown', () => {
    const r = new ModelRegistry();
    for (const model of r.models) model.availability = 'available';
    r.get('groq', 'llama-3.1-8b-instant', 'text').cooldownUntil = Date.now() + 30000;
    assert.notEqual(route(r, { groqModel: 'auto' }, { groq: 'x' }).model.id, 'llama-3.1-8b-instant');
});
test('model discovery from a rotated credential cannot overwrite the new account result', async () => {
    const registry = new ModelRegistry();
    let release;
    const old = registry.discover('groq', 'old-fixture', async () => {
        await new Promise(resolve => {
            release = resolve;
        });
        return Response.json({ data: [{ id: 'llama-3.1-8b-instant' }] });
    });
    registry.invalidate('groq');
    await registry.discover('groq', 'new-fixture', async () => Response.json({ data: [{ id: 'openai/gpt-oss-20b' }] }));
    release();
    await old;
    assert.equal(registry.get('groq', 'openai/gpt-oss-20b', 'text').availability, 'available');
    assert.throws(() => registry.get('groq', 'llama-3.1-8b-instant', 'text'));
});

test('speech latency includes endpoint silence and separates transcription from rendering', () => {
    let now = 0;
    const metrics = new PerformanceMonitor({ now: () => now });
    const silence = Buffer.alloc(4800);
    const voice = Buffer.alloc(4800);
    for (let i = 0; i < voice.length; i += 2) voice.writeInt16LE(2000, i);
    let sample;
    const endpoint = new Endpoint({
        silenceMs: 400,
        onEnd: (_pcm, speechEnd) => {
            const endpointAt = now;
            now += 250;
            sample = metrics.start('groq', 'model', 'text', speechEnd);
            sample.endpointAt = endpointAt;
        },
    });
    for (const pcm of [voice, voice, silence, silence, silence, silence]) {
        now += 100;
        endpoint.push(pcm, now);
    }
    now += 150;
    metrics.mark(sample.requestId, 'firstRendered');
    metrics.finish(sample.requestId, 'COMPLETED');
    const summary = metrics.snapshot();
    assert.equal(summary.lastEndpointMs, 400);
    assert.equal(summary.lastTranscriptionMs, 250);
    assert.equal(summary.lastSpeechToVisibleMs, 800);
    assert.equal(summary.speechToVisibleP95Ms, 800);
});

test('Instant auto routing prefers a consistently faster observed model within the chosen provider', () => {
    const registry = new ModelRegistry();
    const preferred = registry.get('groq', 'llama-3.1-8b-instant', 'text');
    const alternative = registry.get('groq', 'openai/gpt-oss-120b', 'text');
    Object.assign(preferred, { availability: 'available', observedLatencyMs: 900, latencySamples: 3 });
    Object.assign(alternative, { availability: 'available', observedLatencyMs: 350, latencySamples: 2 });
    const config = { performanceMode: 'instant', responseProvider: 'groq' };
    assert.equal(route(registry, config, { groq: 'fixture' }).model.id, preferred.id);
    alternative.latencySamples++;
    assert.equal(route(registry, config, { groq: 'fixture' }).model.id, alternative.id);
    assert.equal(route(registry, { ...config, groqModel: preferred.id }, { groq: 'fixture' }).model.id, preferred.id);
});
