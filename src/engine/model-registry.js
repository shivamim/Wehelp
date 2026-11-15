// Capabilities are curated from official provider documentation. Discovery only
// establishes account availability; an unknown ID never acquires guessed capabilities.
const definitions = [
    ['gemini', 'gemini-3.8-flash', ['text', 'vision'], 1048576, 65536],
    ['gemini', 'gemini-3.1-flash-lite', ['text', 'vision'], 1048576, 65536],
    ['gemini', 'gemini-2.5-flash', ['text', 'vision'], 1048576, 65536],
    ['gemini', 'gemini-2.5-pro', ['text', 'vision'], 1048576, 65536],
    ['gemini', 'gemini-4-carbon', ['text', 'vision'], 1048576, 65536],
    ['gemini', 'gemini-4-argon', ['text', 'vision'], 1048576, 65536],
    ['gemini', 'gemini-4-hydrogen', ['text', 'vision'], 1048576, 65536],
    ['gemini', 'gemini-3.8-live', ['live'], 131072, 8192],
    ['gemini', 'gemini-3.1-flash-live-preview', ['live'], 131072, 8192],
    ['gemini', 'gemini-2.5-flash-native-audio-preview-12-2025', ['live'], 131072, 8192],
    ['gemini', 'gemini-3.5-transcribe-live', ['transcription-live'], null, null],
    ['groq', 'llama-3.1-8b-instant', ['text'], 131072, 131072],
    ['groq', 'llama-3.3-70b-versatile', ['text'], 131072, 32768],
    ['groq', 'openai/gpt-oss-20b', ['text'], 131072, 65536, ['low', 'medium', 'high']],
    ['groq', 'openai/gpt-oss-120b', ['text'], 131072, 65536, ['low', 'medium', 'high']],
    ['groq', 'qwen/qwen3.8-27b', ['text', 'vision'], 131072, 16384, ['none', 'low', 'medium', 'high']],
    // Preserve the previous user selection; discovery must confirm availability.
    ['groq', 'qwen/qwen3.6-27b', ['text', 'vision'], 131072, 16384, ['none', 'low', 'medium', 'high']],
    ['groq', 'whisper-large-v3-turbo', ['transcription'], null, null],
    ['groq', 'whisper-large-v3', ['transcription'], null, null],
];
class ModelRegistry {
    constructor({ now = Date.now, ttlMs = 15 * 60 * 1000 } = {}) {
        this.now = now;
        this.ttlMs = ttlMs;
        this.inflight = new Map();
        this.checked = new Map();
        this.versions = new Map();
        this.models = definitions.map(([provider, id, operations, contextLength, maxOutputTokens, reasoning = []]) => ({
            provider,
            id,
            displayName: id,
            operations,
            contextLength,
            maxOutputTokens,
            reasoning,
            inputModalities: operations.includes('vision')
                ? ['text', 'image']
                : operations.some(o => o.includes('transcription') || o === 'live')
                  ? ['audio']
                  : ['text'],
            outputModalities: operations.includes('live') ? ['audio', 'text'] : ['text'],
            streaming: !operations.includes('transcription'),
            live: operations.includes('live'),
            release: /preview|qwen/.test(id) ? 'preview' : 'production',
            availability: 'unverified',
            verifiedAt: null,
            observedLatencyMs: null,
            requests: 0,
            failures: 0,
            cooldownUntil: 0,
        }));
    }
    list(operation) {
        return this.models.filter(m => !operation || m.operations.includes(operation)).map(m => ({ ...m }));
    }
    get(provider, id, operation) {
        const model = this.models.find(m => m.provider === provider && m.id === id && m.operations.includes(operation));
        if (!model) throw new Error(`Model ${id} has no validated ${operation} capability`);
        if (model.availability === 'unavailable') throw new Error(`Model ${id} is unavailable for this account`);
        return model;
    }
    invalidate(provider) {
        this.versions.set(provider, (this.versions.get(provider) || 0) + 1);
        this.inflight.delete(provider);
        this.checked.delete(provider);
        for (const model of this.models.filter(m => m.provider === provider)) {
            model.availability = 'unverified';
            model.verifiedAt = null;
        }
    }
    async discover(provider, key, fetchImpl = fetch) {
        if (!key) return this.list();
        if (this.now() - (this.checked.get(provider) ?? -Infinity) < this.ttlMs) return this.list();
        if (this.inflight.has(provider)) return this.inflight.get(provider);
        const version = this.versions.get(provider) || 0;
        const work = (async () => {
            const found = [];
            let pageToken = '';
            do {
                const url =
                    provider === 'groq'
                        ? 'https://api.groq.com/openai/v1/models'
                        : `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
                const response = await fetchImpl(url, {
                    headers: provider === 'groq' ? { Authorization: `Bearer ${key}` } : { 'x-goog-api-key': key },
                    signal: AbortSignal.timeout(10000),
                });
                if (!response.ok) throw new Error(`${provider} model discovery failed (HTTP ${response.status})`);
                const body = await response.json();
                found.push(...(body.data || body.models || []));
                pageToken = provider === 'gemini' ? body.nextPageToken || '' : '';
                if (found.length > 10000) throw new Error('Model discovery exceeded page limit');
            } while (pageToken);
            if ((this.versions.get(provider) || 0) !== version) return this.list();
            const ids = new Set(found.map(m => (m.id || m.name).replace(/^models\//, '')));
            for (const model of this.models.filter(m => m.provider === provider)) {
                model.availability = ids.has(model.id) ? 'available' : 'unavailable';
                model.verifiedAt = this.now();
            }
            this.checked.set(provider, this.now());
            return this.list();
        })().finally(() => {
            if (this.inflight.get(provider) === work) this.inflight.delete(provider);
        });
        this.inflight.set(provider, work);
        return work;
    }
}
module.exports = { ModelRegistry };
