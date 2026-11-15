/* Worklet owns PCM conversion and chunk assembly; no UI-thread sample arrays. */
class PcmCapture extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const duration = options.processorOptions?.chunkMs || 100;
        this.size = Math.round((sampleRate * duration) / 1000);
        this.pool = Array.from({ length: 5 }, () => new Int16Array(this.size));
        this.chunk = this.pool.pop();
        this.offset = 0;
        this.outstanding = 0;
        this.port.onmessage = event => {
            if (event.data?.ack instanceof ArrayBuffer) {
                this.pool.push(new Int16Array(event.data.ack));
                this.outstanding = Math.max(0, this.outstanding - 1);
            }
        };
    }
    process(inputs) {
        const input = inputs[0]?.[0];
        if (!input) return true;
        for (let i = 0; i < input.length; i++) {
            const value = Math.max(-1, Math.min(1, input[i]));
            this.chunk[this.offset++] = value < 0 ? value * 32768 : value * 32767;
            if (this.offset === this.size) {
                if (this.outstanding >= 4) {
                    this.port.postMessage({ overflow: true });
                    return false;
                }
                this.port.postMessage({ pcm: this.chunk.buffer }, [this.chunk.buffer]);
                this.outstanding++;
                this.chunk = this.pool.pop();
                if (!this.chunk) {
                    this.port.postMessage({ overflow: true });
                    return false;
                }
                this.offset = 0;
            }
        }
        return true;
    }
}
registerProcessor('wehelp-pcm', PcmCapture);
