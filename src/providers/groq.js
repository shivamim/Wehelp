const { fetchRetry, readSSE, ProviderError } = require('../engine/network');
function reasoningOptions(model, mode, disableThinking) {
    const levels = model.reasoning;
    if (!levels.length) return {};
    const effort = mode === 'deep' ? 'high' : disableThinking && levels.includes('none') ? 'none' : 'low';
    return model.id.startsWith('openai/gpt-oss-')
        ? { reasoning_effort: effort, include_reasoning: false }
        : { reasoning_effort: effort, reasoning_format: 'hidden' };
}
async function* chat({ key, model, messages, outputTokens, mode, disableThinking, signal, onHeaders, fetchImpl }) {
    const response = await fetchRetry(
        'https://api.groq.com/openai/v1/chat/completions',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model.id,
                messages,
                stream: true,
                max_completion_tokens: Math.min(outputTokens, model.maxOutputTokens),
                ...reasoningOptions(model, mode, disableThinking),
            }),
        },
        { signal, fetchImpl }
    );
    onHeaders?.();
    let finished = false;
    for await (const event of readSSE(response, { signal })) {
        const choice = event.choices?.[0];
        if (choice?.delta?.content) yield choice.delta.content;
        if (choice?.finish_reason) finished = true;
    }
    if (!finished) throw new ProviderError('Provider stream disconnected before completion', 0, 'STREAM_DISCONNECTED');
}
async function transcribe({ key, model, wav, language, signal, fetchImpl }) {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', model.id);
    form.append('response_format', 'json');
    if (language) form.append('language', language.split('-')[0]);
    const response = await fetchRetry(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form },
        { signal, fetchImpl }
    );
    const result = await response.json();
    return result.text?.trim() || '';
}
module.exports = { chat, transcribe, reasoningOptions };
