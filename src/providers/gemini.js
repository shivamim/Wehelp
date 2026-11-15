const { fetchRetry, readSSE, ProviderError } = require('../engine/network');
function parts(content) {
    if (typeof content === 'string') return [{ text: content }];
    return content.map(part => {
        if (part.type === 'text') return { text: part.text };
        const match = /^data:(image\/\w+);base64,(.+)$/.exec(part.image_url?.url || '');
        if (!match) throw new Error('Only user-selected inline images are accepted');
        return { inlineData: { mimeType: match[1], data: match[2] } };
    });
}
async function* chat({ key, model, messages, outputTokens, signal, onHeaders, fetchImpl }) {
    const system = messages
        .filter(m => m.role === 'system')
        .map(m => m.content)
        .join('\n');
    const response = await fetchRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`,
        {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: messages
                    .filter(m => m.role !== 'system')
                    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: parts(m.content) })),
                generationConfig: { maxOutputTokens: Math.min(outputTokens, model.maxOutputTokens) },
            }),
        },
        { signal, fetchImpl }
    );
    onHeaders?.();
    let finished = false;
    for await (const event of readSSE(response, { signal })) {
        if (event.promptFeedback?.blockReason) throw new ProviderError('Provider declined this request');
        for (const candidate of event.candidates || []) {
            for (const part of candidate.content?.parts || []) if (part.text && !part.thought) yield part.text;
            if (candidate.finishReason) finished = true;
        }
    }
    if (!finished) throw new ProviderError('Provider stream disconnected before completion', 0, 'STREAM_DISCONNECTED');
}
module.exports = { chat, parts };
