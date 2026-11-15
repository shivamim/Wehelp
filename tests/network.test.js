const test = require('node:test');
const assert = require('node:assert/strict');
const { readSSE, fetchRetry } = require('../src/engine/network');
const groq = require('../src/providers/groq');
const gemini = require('../src/providers/gemini');
const { ModelRegistry } = require('../src/engine/model-registry');
const bytes = new TextEncoder();
function response(text, split = 1) {
    const data = bytes.encode(text);
    return new Response(
        new ReadableStream({
            start(c) {
                for (let i = 0; i < data.length; i += split) c.enqueue(data.slice(i, i + split));
                c.close();
            },
        })
    );
}
async function collect(stream) {
    const events = [];
    for await (const event of stream) events.push(event);
    return events;
}
test('SSE handles split UTF-8, CRLF, comments, multiple events and DONE', async () => {
    const events = await collect(readSSE(response(': keepalive\r\ndata: {"text":"世界🙂"}\r\n\r\ndata: {"done":true}\n\ndata: [DONE]\n\n')));
    assert.deepEqual(events, [{ text: '世界🙂' }, { done: true }]);
});
test('SSE handles final event without newline and invalid events', async () => {
    let invalid = 0;
    const events = await collect(readSSE(response('data: invalid\n\ndata: {"ok":true}'), { onInvalid: () => invalid++ }));
    assert.equal(invalid, 1);
    assert.deepEqual(events, [{ ok: true }]);
});
test('provider stream errors propagate', async () => {
    await assert.rejects(collect(readSSE(response('data: {"error":{"message":"quota exceeded"}}\n\n'))), /quota exceeded/);
});
test('first-event and idle deadlines protect stalled bodies', async () => {
    const stalled = new Response(new ReadableStream({ start() {} }));
    await assert.rejects(collect(readSSE(stalled, { firstTokenMs: 10 })), /stalled/);
    const idle = new Response(
        new ReadableStream({
            start(c) {
                c.enqueue(bytes.encode('data: {"one":1}\n\n'));
            },
        })
    );
    await assert.rejects(collect(readSSE(idle, { idleMs: 10 })), /stalled/);
});
test('cancellation interrupts a blocked body read', async () => {
    const controller = new AbortController();
    const stream = new Response(new ReadableStream({ start() {} }));
    const pending = collect(readSSE(stream, { signal: controller.signal }));
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
});
test('HTTP auth and invalid model failures do not retry', async () => {
    for (const status of [400, 401, 403, 404]) {
        let calls = 0;
        await assert.rejects(
            fetchRetry(
                'https://test',
                {},
                {
                    fetchImpl: async () => {
                        calls++;
                        return new Response('', { status });
                    },
                }
            )
        );
        assert.equal(calls, 1);
    }
});
test('Retry-After is honored; retries are bounded and can be cancelled', async () => {
    let calls = 0;
    const result = await fetchRetry(
        'https://test',
        {},
        {
            fetchImpl: async () => {
                calls++;
                return new Response('', { status: calls === 1 ? 429 : 200, headers: { 'retry-after': '0' } });
            },
        }
    );
    assert.equal(result.status, 200);
    assert.equal(calls, 2);
    const controller = new AbortController();
    const pending = fetchRetry(
        'https://test',
        {},
        { signal: controller.signal, fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '5' } }) }
    );
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(pending, { name: 'AbortError' });
});
test('connection timeout does not kill a healthy long streaming body after headers', async () => {
    const result = await fetchRetry(
        'https://test',
        {},
        {
            connectionMs: 5,
            fetchImpl: async (_url, options) => {
                assert.equal(options.signal.aborted, false);
                return new Response('ok');
            },
        }
    );
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await result.text(), 'ok');
});
test('Groq mocked adapter sends compatible parameters and streams text', async () => {
    const model = new ModelRegistry().get('groq', 'openai/gpt-oss-20b', 'text');
    let payload;
    const output = await collect(
        groq.chat({
            key: 'fake',
            model,
            messages: [{ role: 'user', content: 'q' }],
            outputTokens: 512,
            mode: 'instant',
            disableThinking: true,
            fetchImpl: async (_url, options) => {
                payload = JSON.parse(options.body);
                return response(
                    'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
                );
            },
        })
    );
    assert.deepEqual(output, ['answer']);
    assert.equal(payload.reasoning_effort, 'low');
    assert.equal(payload.max_completion_tokens, 512);
});
test('Groq abrupt disconnect is an error, not a successful truncated answer', async () => {
    await assert.rejects(
        collect(
            groq.chat({
                key: 'fake',
                model: new ModelRegistry().get('groq', 'llama-3.1-8b-instant', 'text'),
                messages: [],
                outputTokens: 512,
                fetchImpl: async () => response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
            })
        ),
        /disconnected/
    );
});
test('Gemini mocked adapter separates instructions and ignores thought parts', async () => {
    let payload;
    const output = await collect(
        gemini.chat({
            key: 'fake',
            model: new ModelRegistry().get('gemini', 'gemini-3.1-flash-lite', 'text'),
            messages: [
                { role: 'system', content: 'custom' },
                { role: 'user', content: 'question' },
            ],
            outputTokens: 512,
            fetchImpl: async (_url, options) => {
                payload = JSON.parse(options.body);
                return response(
                    'data: {"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"text":"answer"}]},"finishReason":"STOP"}]}\n\n'
                );
            },
        })
    );
    assert.deepEqual(output, ['answer']);
    assert.equal(payload.systemInstruction.parts[0].text, 'custom');
    assert.equal(payload.contents[0].role, 'user');
});
