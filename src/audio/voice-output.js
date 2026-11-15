export class VoiceOutput {
    constructor() {
        this.context = null;
        this.nodes = new Set();
        this.next = 0;
    }
    async start() {
        if (!this.context || this.context.state === 'closed') this.context = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
        await this.context.resume();
    }
    push(pcm) {
        if (!this.context || this.context.state !== 'running') return;
        const input = new Int16Array(pcm);
        if (this.next - this.context.currentTime > 4) {
            this.clear();
            return;
        }
        const buffer = this.context.createBuffer(1, input.length, 24000);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = input[i] / 32768;
        const node = this.context.createBufferSource();
        node.buffer = buffer;
        node.connect(this.context.destination);
        node.onended = () => {
            this.nodes.delete(node);
            node.disconnect();
        };
        this.nodes.add(node);
        this.next = Math.max(this.next, this.context.currentTime + 0.02);
        node.start(this.next);
        this.next += buffer.duration;
    }
    clear() {
        for (const node of this.nodes) {
            node.stop();
            node.disconnect();
        }
        this.nodes.clear();
        this.next = 0;
    }
    async stop() {
        this.clear();
        const context = this.context;
        this.context = null;
        if (context && context.state !== 'closed') await context.close().catch(() => {});
    }
}
