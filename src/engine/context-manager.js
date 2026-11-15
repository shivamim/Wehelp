// Conservative UTF-8 byte estimate, not an exact provider tokenizer. Never drops
// the system instructions or current input to make old history fit.
const estimateTokens = content =>
    Array.isArray(content)
        ? content.reduce((sum, part) => sum + (part.type === 'text' ? estimateTokens(part.text) : 4096), 0)
        : Math.ceil(Buffer.byteLength(typeof content === 'string' ? content : JSON.stringify(content), 'utf8') / 3);
function prepareContext(system, history, input, { budget = 12000, outputTokens = 1024, style = 'standard' } = {}) {
    const instruction =
        { concise: 'Keep the answer concise and directly useful.', standard: '', detailed: 'Explain thoroughly, with useful examples.' }[style] || '';
    const prompt = `${system || 'You are a helpful assistant.'}${instruction ? '\nResponse style: ' + instruction : ''}`;
    let remaining = budget - outputTokens - estimateTokens(prompt) - estimateTokens(input);
    if (remaining < 0) throw new Error('Current input and instructions exceed the selected context budget');
    const selected = [];
    // History is committed in complete user/assistant pairs.
    for (let i = history.length - 2; i >= 0; i -= 2) {
        const pair = history.slice(i, i + 2);
        const cost = pair.reduce((sum, message) => sum + estimateTokens(message.content) + 8, 0);
        if (cost > remaining) break;
        remaining -= cost;
        selected.unshift(...pair);
    }
    return [{ role: 'system', content: prompt }, ...selected, { role: 'user', content: input }];
}
module.exports = { estimateTokens, prepareContext };
