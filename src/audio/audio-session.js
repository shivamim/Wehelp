export class AudioSession {
    constructor({ send, onError, onMetrics = () => {} }) {
        this.send = send;
        this.onError = onError;
        this.onMetrics = onMetrics;
        this.resources = new Set();
        this.generation = 0;
        this.pending = 0;
    }
    async add(stream, source, chunkMs = 100) {
        const generation = this.generation;
        const resource = { stream, context: null, node: null, source: null };
        this.resources.add(resource);
        try {
            const context = (resource.context = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' }));
            resource.source = context.createMediaStreamSource(stream);
            await context.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
            if (generation !== this.generation) {
                if (context.state !== 'closed') await context.close().catch(() => {});
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            const node = (resource.node = new AudioWorkletNode(context, 'wehelp-pcm', {
                processorOptions: { chunkMs },
                numberOfOutputs: 1,
                outputChannelCount: [1],
            }));
            node.port.onmessage = async event => {
                if (generation !== this.generation) return;
                if (event.data.overflow) {
                    this.fail(new Error('Audio processing fell behind. Capture stopped; start again.'));
                    return;
                }
                const started = performance.now();
                this.pending++;
                try {
                    const result = await this.send({ pcm: event.data.pcm, source, sampleRate: context.sampleRate });
                    if (!result?.success) throw new Error(result?.error || 'Audio transport failed');
                } catch (error) {
                    if (generation === this.generation) this.fail(error);
                } finally {
                    this.pending = Math.max(0, this.pending - 1);
                    if (generation === this.generation) {
                        node.port.postMessage({ ack: event.data.pcm }, [event.data.pcm]);
                        this.onMetrics({ audioBacklog: this.pending, audioTransportMs: performance.now() - started });
                    }
                }
            };
            node.onprocessorerror = () => this.fail(new Error('Audio processor failed'));
            resource.source.connect(node);
            // Worklet produces zeros; the destination connection keeps it scheduled
            // without playing captured microphone/system sound back to the user.
            node.connect(context.destination);
            stream.getTracks().forEach(track =>
                track.addEventListener(
                    'ended',
                    () => {
                        if (generation === this.generation) this.fail(new Error('Audio device disconnected'));
                    },
                    { once: true }
                )
            );
            await context.resume();
        } catch (error) {
            await this.stop();
            throw error;
        }
    }
    fail(error) {
        this.stop();
        this.onError(error);
    }
    async stop() {
        this.generation++;
        const resources = [...this.resources];
        this.resources.clear();
        this.pending = 0;
        const closes = [];
        for (const { stream, context, node, source } of resources) {
            stream.getTracks().forEach(track => track.stop());
            if (node) {
                node.port.onmessage = null;
                node.port.close();
                node.disconnect();
            }
            source?.disconnect();
            if (context && context.state !== 'closed') closes.push(context.close().catch(() => {}));
        }
        await Promise.all(closes);
    }
}
