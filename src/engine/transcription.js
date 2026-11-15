class TranscriptionTurns {
    constructor() {
        this.reset();
    }
    reset() {
        this.text = '';
        this.sent = false;
        this.lastFinal = '';
    }
    accept(content = {}) {
        const input = content.inputTranscription;
        if (input?.text) {
            if (this.sent) {
                if (input.finished && input.text === this.lastFinal) return null;
                this.text = '';
                this.sent = false;
            }
            this.text += input.text;
        }
        const complete = input?.finished || content.turnComplete || content.generationComplete;
        let final = null;
        if (complete && !this.sent && this.text.trim()) {
            final = this.text.trim();
            this.sent = true;
            this.lastFinal = input?.text || final;
        }
        if (content.turnComplete) {
            this.text = '';
            this.sent = false;
            this.lastFinal = '';
        }
        return final;
    }
}
module.exports = { TranscriptionTurns };
