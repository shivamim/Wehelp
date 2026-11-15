const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');

class PerformanceMonitor {
    constructor({ now = () => performance.now(), capacity = 200 } = {}) {
        this.now = now;
        this.capacity = capacity;
        this.requests = new Map();
        this.samples = [];
        this.gauges = { activeSessions: 0, reconnections: 0, audioBacklog: 0, audioDrops: 0 };
        this.boot = now();
    }
    start(provider, model, type = 'text', speechEnd) {
        const requestId = randomUUID();
        const record = { requestId, provider, model, type, start: this.now(), speechEnd, status: 'PREPARING', chars: 0 };
        this.requests.set(requestId, record);
        return record;
    }
    mark(id, event) {
        const record = this.requests.get(id) || this.samples.find(r => r.requestId === id);
        if (record && record[event] === undefined) record[event] = this.now();
    }
    finish(id, status) {
        const record = this.requests.get(id);
        if (!record) return;
        record.end = this.now();
        record.status = status;
        this.requests.delete(id);
        this.samples.push(record);
        if (this.samples.length > this.capacity) this.samples.shift();
    }
    resources() {
        this.loop = monitorEventLoopDelay({ resolution: 20 });
        this.loop.enable();
        this.cpuAt = process.cpuUsage();
        this.cpuTime = this.now();
    }
    snapshot() {
        const values = this.samples
            .filter(r => r.firstRendered !== undefined)
            .map(r => r.firstRendered - r.start)
            .sort((a, b) => a - b);
        const percentile = p => (values.length ? values[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)] : null);
        const last = this.samples.at(-1) || [...this.requests.values()].at(-1);
        const elapsed = this.now() - (this.cpuTime || this.boot);
        const cpu = this.cpuAt ? process.cpuUsage(this.cpuAt) : null;
        const memory = process.memoryUsage();
        return {
            ...this.gauges,
            startupMs: this.startupMs ?? null,
            provider: last?.provider || null,
            model: last?.model || null,
            requests: this.requests.size,
            lastLatencyMs: last?.firstRendered === undefined ? null : last.firstRendered - last.start,
            averageMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
            p50Ms: percentile(0.5),
            p95Ms: percentile(0.95),
            p99Ms: percentile(0.99),
            // Character-based estimate; actual tokenizer usage is provider-specific.
            estimatedTokensPerSecond:
                last?.firstToken !== undefined && last?.end > last.firstToken ? last.chars / 4 / ((last.end - last.firstToken) / 1000) : null,
            errorRate: this.samples.length ? this.samples.filter(r => ['FAILED', 'TIMED_OUT'].includes(r.status)).length / this.samples.length : 0,
            rssBytes: memory.rss,
            cpuPercent: cpu && elapsed > 0 ? (cpu.user + cpu.system) / (elapsed * 10) : null,
            eventLoopP95Ms: this.loop ? this.loop.percentile(95) / 1e6 : null,
            samples: this.samples.map(
                ({ requestId, provider, model, type, status, start, headers, firstToken, firstRendered, end, speechEnd, chars }) => ({
                    requestId,
                    provider,
                    model,
                    type,
                    status,
                    chars,
                    headersMs: headers === undefined ? null : headers - start,
                    firstTokenMs: firstToken === undefined ? null : firstToken - start,
                    firstRenderedMs: firstRendered === undefined ? null : firstRendered - start,
                    speechToVisibleMs: speechEnd === undefined || firstRendered === undefined ? null : firstRendered - speechEnd,
                    totalMs: end === undefined ? null : end - start,
                })
            ),
        };
    }
    export(format = 'json') {
        const snapshot = this.snapshot();
        if (format === 'json') return JSON.stringify({ schemaVersion: 1, ...snapshot }, null, 2);
        const keys = [
            'requestId',
            'provider',
            'model',
            'type',
            'status',
            'headersMs',
            'firstTokenMs',
            'firstRenderedMs',
            'speechToVisibleMs',
            'totalMs',
            'chars',
        ];
        return [keys.join(','), ...snapshot.samples.map(s => keys.map(k => JSON.stringify(s[k] ?? '')).join(','))].join('\n');
    }
    close() {
        this.loop?.disable();
    }
}
module.exports = { PerformanceMonitor, monitor: new PerformanceMonitor() };
