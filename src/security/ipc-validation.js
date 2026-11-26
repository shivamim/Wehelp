const { pathToFileURL } = require('node:url');
const path = require('node:path');
const CONFIG_KEYS = new Set([
    'onboarded',
    'layout',
    'geminiLiveModel',
    'geminiChatModel',
    'groqModel',
    'groqImageModel',
    'disableGroqThinking',
    'groqMaxOutputTokens',
    'performanceMode',
    'responseProvider',
    'responseStyle',
    'transcriptionProvider',
    'transcriptionModel',
    'audioChunkMs',
    'endpointSilenceMs',
    'alwaysOnTop',
    'screenSharePrivacy',
    'launchAtLogin',
    'minimizeToTray',
    'hideFromTaskbar',
]);
function object(value) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).every(k => !['__proto__', 'constructor', 'prototype'].includes(k))
    );
}
function text(value, max = 100000) {
    return typeof value === 'string' && value.length <= max;
}
function validate(channel, args) {
    if (JSON.stringify(args, (_, value) => (value instanceof ArrayBuffer ? '[binary]' : value))?.length > 16 * 1024 * 1024)
        throw new Error('IPC payload too large');
    if (channel === 'storage:update-config') {
        if (!CONFIG_KEYS.has(args[0])) throw new Error('Unknown runtime setting');
        validateConfig({ [args[0]]: args[1] });
    }
    if (channel === 'storage:set-config') validateConfig(args[0]);
    if (['storage:set-preferences', 'storage:set-credentials', 'storage:set-keybinds'].includes(channel) && args[0] !== null && !object(args[0]))
        throw new Error('Expected settings object');
    if (['storage:set-keybinds', 'update-keybinds'].includes(channel) && args[0] !== null) {
        if (!object(args[0]) || Object.keys(args[0]).length > 30 || Object.values(args[0]).some(v => !text(v, 100)))
            throw new Error('Invalid keyboard shortcuts');
    }
    if (channel === 'storage:update-preference' && (!text(args[0], 100) || ['__proto__', 'constructor', 'prototype'].includes(args[0])))
        throw new Error('Invalid preference key');
    if (['storage:get-session', 'storage:save-session', 'storage:delete-session'].includes(channel) && !/^[\w-]{1,100}$/.test(args[0]))
        throw new Error('Invalid session ID');
    if (['storage:set-api-key', 'storage:set-groq-api-key'].includes(channel) && !text(args[0], 500)) throw new Error('Invalid API key value');
    if (channel.startsWith('initialize-')) {
        for (const arg of args) if (arg !== undefined && !text(arg, 100000)) throw new Error('Invalid session configuration');
    }
    if (channel === 'send-text-message' && (!text(args[0]) || !args[0].trim())) throw new Error('Invalid text input');
    if (channel === 'open-external') {
        const url = new URL(args[0]);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links may be opened');
    }
    if (channel === 'capture:state') {
        const state = args[0];
        if (
            !object(state) ||
            typeof state.active !== 'boolean' ||
            (state.paused !== undefined && typeof state.paused !== 'boolean') ||
            (state.pausedForSleep !== undefined && typeof state.pausedForSleep !== 'boolean') ||
            (state.recovery !== undefined && !text(state.recovery, 200))
        )
            throw new Error('Invalid capture state');
    }
    if (channel === 'audio:chunk') {
        const chunk = args[0];
        if (
            !object(chunk) ||
            !(chunk.pcm instanceof ArrayBuffer || ArrayBuffer.isView(chunk.pcm)) ||
            chunk.pcm.byteLength > 48000 ||
            chunk.pcm.byteLength % 6 !== 0 ||
            chunk.sampleRate !== 24000 ||
            !['mic', 'system'].includes(chunk.source)
        )
            throw new Error('Invalid PCM audio chunk');
    }
    if (channel === 'send-image-content' && (!object(args[0]) || !text(args[0].data, 12 * 1024 * 1024) || !text(args[0].prompt)))
        throw new Error('Invalid image request');
    if (channel === 'performance:export' && !['json', 'csv'].includes(args[0])) throw new Error('Invalid export format');
    if (channel === 'verify-api-key' && !['gemini', 'groq'].includes(args[0])) throw new Error('Unknown key provider');
}
function validateConfig(config) {
    if (!object(config)) throw new Error('Expected config object');
    for (const [key, value] of Object.entries(config)) {
        if (!CONFIG_KEYS.has(key)) throw new Error('Unknown runtime setting');
        if (/Model$/.test(key) && (!text(value, 150) || !/^[a-zA-Z0-9_./:-]+$/.test(value))) throw new Error('Invalid model ID');
        const choices = {
            performanceMode: ['instant', 'balanced', 'deep', 'live-voice', 'offline'],
            responseProvider: ['auto', 'gemini', 'groq', 'local'],
            responseStyle: ['concise', 'standard', 'detailed'],
            transcriptionProvider: ['gemini', 'groq'],
            audioChunkMs: [20, 40, 60, 100],
        };
        if (choices[key] && !choices[key].includes(value)) throw new Error(`Invalid ${key}`);
        if (key === 'endpointSilenceMs' && (!Number.isInteger(value) || value < 400 || value > 2000))
            throw new Error('Endpoint silence must be 400–2000 ms');
        if (key === 'groqMaxOutputTokens' && (!Number.isInteger(value) || value < 128 || value > 16384))
            throw new Error('Invalid output token budget');
        if (
            ['disableGroqThinking', 'onboarded', 'alwaysOnTop', 'screenSharePrivacy', 'launchAtLogin', 'minimizeToTray', 'hideFromTaskbar'].includes(
                key
            ) &&
            typeof value !== 'boolean'
        )
            throw new Error('Expected boolean');
    }
}
function installIpcValidation(ipcMain) {
    const expected = pathToFileURL(path.join(__dirname, '../index.html')).href;
    const trusted = event =>
        event.senderFrame && !event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === expected;
    const handle = ipcMain.handle.bind(ipcMain),
        on = ipcMain.on.bind(ipcMain);
    ipcMain.handle = (channel, handler) =>
        handle(channel, (event, ...args) => {
            if (!trusted(event)) throw new Error('Untrusted IPC sender');
            validate(channel, args);
            return handler(event, ...args);
        });
    ipcMain.on = (channel, handler) =>
        on(channel, (event, ...args) => {
            if (!trusted(event)) return;
            try {
                validate(channel, args);
                handler(event, ...args);
            } catch (error) {
                console.warn(`Rejected ${channel}: ${error.message}`);
            }
        });
}
module.exports = { validate, validateConfig, installIpcValidation };
