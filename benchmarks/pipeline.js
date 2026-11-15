// Deterministic, credential-free microbenchmarks. These are not cloud latency tests.
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { GenerationService } = require('../src/engine/generation-service');
const { PerformanceMonitor } = require('../src/engine/performance-monitor');
function measure(fn, repeats = 7) {
    const values = [];
    fn(); // warmup
    for (let i = 0; i < repeats; i++) {
        const start = performance.now();
        fn();
        values.push(performance.now() - start);
    }
    values.sort((a, b) => a - b);
    return { p50Ms: values[3], p95Ms: values[6], runs: repeats };
}
// Historical 6dda0fe renderer capture algorithm, isolated without paid providers.
function baselineAudio() {
    const input = new Float32Array(4096).fill(0.1);
    const pending = [];
    for (let i = 0; i < Math.ceil((24000 * 60) / input.length); i++) {
        pending.push(...input);
        while (pending.length >= 2400) {
            const chunk = pending.splice(0, 2400),
                pcm = new Int16Array(chunk.length);
            for (let j = 0; j < chunk.length; j++) {
                const sample = Math.max(-1, Math.min(1, chunk[j]));
                pcm[j] = sample < 0 ? sample * 32768 : sample * 32767;
            }
            // Historical internal base64 transport adds an encode/decode round trip.
            Buffer.from(Buffer.from(pcm.buffer).toString('base64'), 'base64');
        }
    }
}
function workletAudio(chunkMs) {
    let Processor;
    const WorkletBase = class {
        constructor() {
            this.port = {
                postMessage: value => {
                    if (value.pcm) this.port.onmessage({ data: { ack: value.pcm } });
                },
            };
        }
    };
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', fs.readFileSync('src/audio/audio-worklet.js', 'utf8'))(
        WorkletBase,
        (_name, implementation) => {
            Processor = implementation;
        },
        24000
    );
    return () => {
        const processor = new Processor({ processorOptions: { chunkMs } });
        const input = new Float32Array(128).fill(0.1);
        for (let i = 0; i < Math.ceil((24000 * 60) / 128); i++) processor.process([[input]]);
    };
}
async function main() {
    const audioBaseline = measure(baselineAudio);
    const audioProfiles = Object.fromEntries([20, 40, 60, 100].map(ms => [ms, measure(workletAudio(ms))]));
    const metrics = new PerformanceMonitor();
    const engine = new GenerationService({
        getConfig: () => ({ responseProvider: 'groq', groqModel: 'auto' }),
        getKeys: () => ({ groq: 'fixture' }),
        metrics,
        emit: (_channel, event) => {
            if (event.type === 'delta') metrics.mark(event.requestId, 'firstRendered');
        },
        save: () => {},
        adapters: {
            groq: {
                async *chat() {
                    for (const token of ['A useful ', 'fixture answer.']) yield token;
                },
            },
        },
    });
    engine.start();
    for (let i = 0; i < 100; i++) await engine.generate('Explain streaming.');
    engine.stop();
    let revision;
    try {
        revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
        revision = null;
    }
    const result = {
        schemaVersion: 1,
        disclaimer:
            'Synthetic CPU/transport fixtures only. No network, actual audio device, rendering, Whisper/llama inference or paid provider was measured. firstRendered is a simulated immediate acknowledgement.',
        environment: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model, revision },
        audio: {
            input: '60 seconds of synthetic mono 24kHz audio',
            baselineRevision: '6dda0fe3d3cf3e8fe0a692556f90cc2ab69021ad',
            baseline: audioBaseline,
            workletProfiles: audioProfiles,
            difference100ms: {
                absoluteMs: audioBaseline.p50Ms - audioProfiles[100].p50Ms,
                percent: ((audioBaseline.p50Ms - audioProfiles[100].p50Ms) / audioBaseline.p50Ms) * 100,
            },
        },
        mockedGeneration: metrics.snapshot(),
    };
    const output = process.argv.indexOf('--output');
    if (output !== -1) fs.writeFileSync(process.argv[output + 1], JSON.stringify(result, null, 2));
    console.log(
        JSON.stringify(
            {
                environment: result.environment,
                disclaimer: result.disclaimer,
                audio: result.audio,
                mockedGeneration: { p50Ms: result.mockedGeneration.p50Ms, p95Ms: result.mockedGeneration.p95Ms },
            },
            null,
            2
        )
    );
}
main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
