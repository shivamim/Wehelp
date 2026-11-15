const PROFILES = Object.freeze({
    instant: { outputTokens: 512, contextTokens: 8000 },
    balanced: { outputTokens: 1024, contextTokens: 16000 },
    deep: { outputTokens: 4096, contextTokens: 32000 },
    'live-voice': { outputTokens: 1024, contextTokens: 16000 },
    offline: { outputTokens: 1024, contextTokens: 6000 },
});
function route(registry, config, keys, operation = 'text') {
    const mode = config.performanceMode || 'balanced';
    const profile = PROFILES[mode] || PROFILES.balanced;
    if (mode === 'offline' || config.responseProvider === 'local') return { provider: 'local', profile };
    const provider = config.responseProvider && config.responseProvider !== 'auto' ? config.responseProvider : keys.groq ? 'groq' : 'gemini';
    if (!keys[provider]) throw new Error(`Configure a ${provider} API key first`);
    let id = provider === 'groq' ? (operation === 'vision' ? config.groqImageModel : config.groqModel) : config.geminiChatModel;
    if (!id || id === 'auto') {
        const preferred =
            provider === 'groq'
                ? operation === 'vision'
                    ? 'qwen/qwen3.8-27b'
                    : mode === 'deep'
                      ? 'openai/gpt-oss-120b'
                      : 'llama-3.1-8b-instant'
                : 'gemini-3.1-flash-lite';
        const available = registry
            .list(operation)
            .filter(m => m.provider === provider && m.availability === 'available' && (!m.cooldownUntil || m.cooldownUntil < registry.now()));
        if (!available.length && registry.list(operation).some(m => m.provider === provider && m.availability === 'available'))
            throw new Error('Provider models are cooling down after rate limits; try again shortly');
        const candidate =
            available.find(m => m.id === preferred && m.failures / Math.max(1, m.requests) < 0.5) ||
            available.sort(
                (a, b) =>
                    (a.observedLatencyMs ?? 2000) * (1 + a.failures / Math.max(1, a.requests)) -
                    (b.observedLatencyMs ?? 2000) * (1 + b.failures / Math.max(1, b.requests))
            )[0];
        // A documented default may be tried when discovery is offline, but the UI
        // must label it unverified rather than claiming it is available.
        id = candidate?.id || preferred;
    }
    return { provider, model: registry.get(provider, id, operation), profile };
}
module.exports = { route, PROFILES };
