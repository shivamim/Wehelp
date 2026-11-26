const { monitor } = require('./performance-monitor');
const { RequestManager } = require('./request-manager');
const { ModelRegistry } = require('./model-registry');
const { route } = require('./model-router');
const { prepareContext } = require('./context-manager');
const providers = { groq: require('../providers/groq'), gemini: require('../providers/gemini') };
class GenerationService {
    constructor({ getConfig, getKeys, emit, save, metrics = monitor, adapters = providers, registry = new ModelRegistry() }) {
        Object.assign(this, { getConfig, getKeys, emit, save, metrics, adapters, registry });
        this.requests = new RequestManager(metrics);
        this.history = [];
    }
    start(provider = 'byok') {
        this.history = [];
        return this.requests.startSession(provider);
    }
    stop() {
        this.requests.stop();
        this.history = [];
    }
    async generate(text, { image, speechEnd, endpointAt } = {}) {
        const config = this.getConfig(),
            keys = this.getKeys();
        let { provider, model, profile } = route(this.registry, config, keys, image ? 'vision' : 'text');
        if (provider === 'local') throw new Error('Start a Local AI session for Offline mode');
        const request = this.requests.begin(provider, model.id, image ? 'vision' : 'text', speechEnd);
        request.endpointAt = endpointAt;
        const id = request.requestId;
        const event = (type, data = {}) =>
            this.emit('response-stream', { requestId: id, sessionId: request.sessionId, sequence: request.sequence++, type, ...data });
        const timer = setTimeout(
            () => request.controller.abort(new DOMException('Request deadline exceeded', 'TimeoutError')),
            config.performanceMode === 'deep' ? 120000 : 60000
        );
        let fullText = '',
            pending = '',
            flushTimer,
            usefulTokenTimer;
        const tokenDeadline = ms => {
            clearTimeout(usefulTokenTimer);
            usefulTokenTimer = setTimeout(
                () => request.controller.abort(new DOMException('No useful response text arrived before the deadline', 'TimeoutError')),
                ms
            );
        };
        const flush = () => {
            clearTimeout(flushTimer);
            flushTimer = null;
            if (pending && this.requests.current(request)) {
                event('delta', { delta: pending });
                pending = '';
            }
        };
        try {
            const outputTokens = Math.min(profile.outputTokens, Number(config.groqMaxOutputTokens) || profile.outputTokens);
            const input = image
                ? [
                      { type: 'text', text },
                      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
                  ]
                : text;
            const messages = prepareContext(config.systemPrompt, this.history, input, {
                budget: Math.min(profile.contextTokens, model.contextLength),
                outputTokens,
                style: config.responseStyle,
            });
            request.status = 'CONNECTING';
            event('start', { provider, model: model.id });
            for (let attempt = 0; ; attempt++) {
                try {
                    const attemptStart = this.metrics.now();
                    model.requests++;
                    const iterator = this.adapters[provider].chat({
                        key: keys[provider],
                        model,
                        messages,
                        outputTokens,
                        mode: config.performanceMode,
                        disableThinking: config.disableGroqThinking,
                        signal: request.controller.signal,
                        onHeaders: () => {
                            this.metrics.mark(id, 'headers');
                            tokenDeadline(15000);
                        },
                    });
                    let observedUsefulText = false;
                    for await (const delta of iterator) {
                        if (!this.requests.current(request)) return { success: false, cancelled: true };
                        request.controller.signal.throwIfAborted();
                        if (!delta) continue;
                        const first = !fullText;
                        tokenDeadline(10000);
                        this.metrics.mark(id, 'firstToken');
                        request.status = 'STREAMING';
                        fullText += delta;
                        pending += delta;
                        request.chars += delta.length;
                        if (fullText.length > 1000000) throw new Error('Response exceeds application size limit');
                        if (!observedUsefulText && delta.trim()) {
                            observedUsefulText = true;
                            const latency = this.metrics.now() - attemptStart;
                            model.observedLatencyMs = model.observedLatencyMs == null ? latency : model.observedLatencyMs * 0.75 + latency * 0.25;
                            model.latencySamples = (model.latencySamples || 0) + 1;
                        }
                        if (first) flush();
                        else if (!flushTimer) flushTimer = setTimeout(flush, 32);
                    }
                    break;
                } catch (error) {
                    if (!request.controller.signal.aborted) model.failures++;
                    if (error.status === 429) model.cooldownUntil = this.registry.now() + 30000;
                    const selected = provider === 'groq' ? (image ? config.groqImageModel : config.groqModel) : config.geminiChatModel;
                    const fallback =
                        (!selected || selected === 'auto') &&
                        !attempt &&
                        !fullText &&
                        !request.controller.signal.aborted &&
                        ![400, 401, 403].includes(error.status)
                            ? this.registry
                                  .list(image ? 'vision' : 'text')
                                  .find(
                                      m =>
                                          m.provider === provider &&
                                          m.id !== model.id &&
                                          m.availability === 'available' &&
                                          (!m.cooldownUntil || m.cooldownUntil < this.registry.now())
                                  )
                            : null;
                    if (!fallback) throw error;
                    model = this.registry.get(provider, fallback.id, image ? 'vision' : 'text');
                    request.model = model.id;
                    event('start', { provider, model: model.id });
                }
            }
            if (!this.requests.current(request)) return { success: false, cancelled: true };
            flush();
            if (!fullText.trim()) throw new Error('Provider returned no useful text');
            this.history.push({ role: 'user', content: text }, { role: 'assistant', content: fullText });
            if (this.history.length > 100) this.history.splice(0, this.history.length - 100);
            this.save(text, fullText);
            event('complete');
            this.emit('update-status', 'Listening...');
            this.requests.finish(request, 'COMPLETED');
            return { success: true, model: model.id };
        } catch (error) {
            if (!this.requests.current(request) && !request.controller.signal.aborted) return { success: false, cancelled: true };
            const cancelled = request.controller.signal.aborted;
            const reason = request.controller.signal.reason || error;
            const status = reason.name === 'TimeoutError' || error.code === 'STREAM_STALLED' ? 'TIMED_OUT' : cancelled ? 'CANCELLED' : 'FAILED';
            if (this.requests.active === request)
                event(status === 'CANCELLED' ? 'cancelled' : 'error', { message: status === 'CANCELLED' ? 'Request cancelled' : reason.message });
            this.requests.finish(request, status);
            return { success: false, cancelled, error: reason.message };
        } finally {
            clearTimeout(timer);
            clearTimeout(flushTimer);
            clearTimeout(usefulTokenTimer);
        }
    }
}
module.exports = { GenerationService };
