class ProviderError extends Error {
    constructor(message, status = 0, code = 'PROVIDER_ERROR') {
        super(message);
        this.status = status;
        this.code = code;
    }
}
function describeStatus(status) {
    return (
        {
            400: 'Invalid request or unsupported model configuration',
            401: 'Invalid API key',
            403: 'Provider access denied',
            404: 'Model unavailable',
            429: 'Rate limit or quota exceeded',
        }[status] || (status >= 500 ? 'Provider service unavailable' : 'Provider request failed')
    );
}
const abortableDelay = (ms, signal) =>
    new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
async function fetchRetry(url, options = {}, { fetchImpl = fetch, retries = 1, signal, connectionMs = 10000 } = {}) {
    for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new DOMException('Connection timed out', 'TimeoutError')), connectionMs);
        let response;
        try {
            response = await fetchImpl(url, { ...options, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
        } finally {
            clearTimeout(timer);
        }
        if (response.ok) return response;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= retries) {
            await response.body?.cancel().catch(() => {});
            throw new ProviderError(describeStatus(response.status), response.status);
        }
        const retryAfter = response.headers.get('retry-after');
        const seconds = Number(retryAfter);
        const delay = retryAfter
            ? Number.isFinite(seconds)
                ? seconds * 1000
                : Date.parse(retryAfter) - Date.now()
            : 500 * 2 ** attempt + Math.random() * 100;
        await response.body?.cancel().catch(() => {});
        // Do not sit invisibly retrying long quota windows.
        if (delay > 10000) throw new ProviderError('Provider rate limited; retry later', response.status);
        await abortableDelay(Math.max(0, delay), signal);
    }
}
async function* readSSE(response, { signal, firstTokenMs = 15000, idleMs = 10000, onInvalid = () => {} } = {}) {
    if (!response.body) throw new ProviderError('Provider returned no stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '',
        data = [],
        sawEvent = false,
        terminal = false;
    async function read() {
        let timer;
        const abort = () => reader.cancel().catch(() => {});
        signal?.throwIfAborted();
        signal?.addEventListener('abort', abort, { once: true });
        try {
            const result = await Promise.race([
                reader.read(),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => {
                            reject(new ProviderError('Response stream stalled', 0, 'STREAM_STALLED'));
                            reader.cancel().catch(() => {});
                        },
                        sawEvent ? idleMs : firstTokenMs
                    );
                }),
            ]);
            signal?.throwIfAborted();
            return result;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }
    const parse = () => {
        const value = data.join('\n');
        data = [];
        if (value === '[DONE]') {
            terminal = true;
            return null;
        }
        if (!value) return null;
        try {
            const event = JSON.parse(value);
            if (event.error) throw new ProviderError(event.error.message || 'Provider stream error');
            return event;
        } catch (error) {
            if (error instanceof ProviderError) throw error;
            onInvalid();
            return null;
        }
    };
    try {
        while (!terminal) {
            const { value, done } = await read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (buffer.length > 2 * 1024 * 1024) throw new ProviderError('Provider event exceeds size limit');
            if (done) buffer += '\n\n';
            let index;
            while ((index = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, index).replace(/\r$/, '');
                buffer = buffer.slice(index + 1);
                if (line === '') {
                    const event = parse();
                    if (event) {
                        sawEvent = true;
                        yield event;
                    }
                    if (terminal) break;
                } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
            }
            if (done) break;
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
module.exports = { ProviderError, describeStatus, fetchRetry, readSSE, abortableDelay };
