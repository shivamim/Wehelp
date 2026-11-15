// Duration-based VAD with 200 ms pre-roll and a bounded 30 second utterance.
// It is deliberately independent of transport chunk size.
class Endpoint {
    constructor({ sampleRate = 24000, silenceMs = 700, threshold = 0.015, onStart = () => {}, onEnd }) {
        Object.assign(this, { sampleRate, silenceMs, threshold, onStart, onEnd });
        this.reset();
    }
    reset() {
        this.active = false;
        this.buffers = [];
        this.pre = [];
        this.silence = 0;
        this.duration = 0;
    }
    push(pcm) {
        let energy = 0;
        for (let i = 0; i < pcm.length; i += 2) energy += (pcm.readInt16LE(i) / 32768) ** 2;
        const voice = Math.sqrt(energy / (pcm.length / 2)) >= this.threshold;
        const duration = (pcm.length / 2 / this.sampleRate) * 1000;
        if (!this.active) {
            this.pre.push(Buffer.from(pcm));
            while (this.pre.length && this.pre.reduce((n, b) => n + b.length, 0) > this.sampleRate * 2 * 0.2 + pcm.length) this.pre.shift();
            if (!voice) return;
            this.active = true;
            this.buffers = this.pre;
            this.pre = [];
            this.onStart();
        } else this.buffers.push(Buffer.from(pcm));
        this.duration += duration;
        this.silence = voice ? 0 : this.silence + duration;
        if (this.silence >= this.silenceMs || this.duration >= 30000) {
            const result = Buffer.concat(this.buffers);
            const voicedDuration = this.duration - this.silence;
            this.reset();
            if (voicedDuration >= 200) this.onEnd(result);
        }
    }
}
module.exports = { Endpoint };
