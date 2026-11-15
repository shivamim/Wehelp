const { randomUUID } = require('node:crypto');
class RequestManager {
    constructor(monitor) {
        this.monitor = monitor;
        this.sessionId = null;
        this.active = null;
    }
    startSession(provider = 'byok') {
        this.stop();
        this.sessionId = randomUUID();
        this.provider = provider;
        this.monitor.gauges.activeSessions = 1;
        return this.sessionId;
    }
    begin(provider, model, type, speechEnd) {
        if (!this.sessionId) throw new Error('Start a session before sending a request');
        this.cancel();
        const record = this.monitor.start(provider, model, type, speechEnd);
        record.sessionId = this.sessionId;
        record.controller = new AbortController();
        record.sequence = 0;
        this.active = record;
        return record;
    }
    current(request) {
        return this.active === request && request.sessionId === this.sessionId && !request.controller.signal.aborted;
    }
    cancel() {
        if (!this.active) return;
        const request = this.active;
        request.controller.abort(new DOMException('Request cancelled', 'AbortError'));
        this.monitor.finish(request.requestId, 'CANCELLED');
        this.active = null;
    }
    finish(request, status) {
        this.monitor.finish(request.requestId, status);
        if (this.active === request) this.active = null;
    }
    stop() {
        this.cancel();
        this.sessionId = null;
        this.monitor.gauges.activeSessions = 0;
    }
}
module.exports = { RequestManager };
