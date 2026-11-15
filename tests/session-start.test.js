const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function mainView(storage) {
    const module = { exports: {} };
    const source =
        fs
            .readFileSync('src/components/views/MainView.js', 'utf8')
            .replace(/\r\n/g, '\n')
            .replace(/^import .*;\n/gm, '')
            .replace('export class MainView', 'class MainView') + '\nmodule.exports = MainView;';
    vm.runInNewContext(source, {
        module,
        LitElement: class {},
        css: () => '',
        html: () => '',
        customElements: { define() {} },
        cheatingDaddy: { storage },
        Promise,
        Set,
    });
    const view = Object.create(module.exports.prototype);
    Object.assign(view, {
        _mode: 'byok',
        _geminiKey: '',
        _groqKey: '',
        _hasGeminiKey: false,
        _hasGroqKey: false,
        downloadProgress: { active: false },
        shadowRoot: { querySelector: () => ({ config: { transcriptionProvider: 'gemini' } }) },
        requestUpdate() {},
    });
    return view;
}
test('Start waits for an in-flight key save and still starts after the field clears', async () => {
    let release,
        saved = false,
        started = false;
    const view = mainView({
        setApiKey: async () => {
            await new Promise(resolve => {
                release = resolve;
            });
            saved = true;
        },
        getPreferences: async () => ({}),
    });
    view.onStart = async () => {
        assert.equal(saved, true);
        started = true;
    };
    const saving = view._saveGeminiKey('fixture-key');
    await Promise.resolve();
    const starting = view._handleStart();
    await Promise.resolve();
    assert.equal(started, false);
    release();
    await saving;
    await starting;
    assert.equal(view._geminiKey, '');
    assert.equal(view._hasGeminiKey, true);
    assert.equal(started, true);
});
test('Enter saves an unblurred password before starting', async () => {
    let saved;
    const view = mainView({
        setApiKey: async value => {
            saved = value;
        },
        getPreferences: async () => ({}),
    });
    view._geminiKey = 'unblurred-fixture';
    view.onStart = async () => assert.equal(saved, 'unblurred-fixture');
    await view._handleStart();
    assert.equal(view._hasGeminiKey, true);
});
test('failed credential persistence remains visible and prevents startup', async () => {
    const view = mainView({
        setApiKey: async () => {
            throw new Error('OS secure storage unavailable');
        },
        getPreferences: async () => ({}),
    });
    let started = false;
    view._geminiKey = 'fixture';
    view.onStart = () => {
        started = true;
    };
    await view._handleStart();
    assert.equal(started, false);
    assert.match(view._credentialError, /secure storage/);
});
function geminiModule(connect) {
    const filename = path.resolve('src/utils/gemini.js'),
        relative = createRequire(filename),
        module = { exports: {} },
        handlers = new Map(),
        events = [];
    const config = { performanceMode: 'balanced', geminiLiveModel: 'gemini-3.1-flash-live-preview', transcriptionProvider: 'gemini' };
    const storage = {
        getApiKey: () => 'private-fixture-key',
        setApiKey() {},
        getGroqApiKey: () => '',
        getPreferences: () => ({}),
        saveSession: async () => {},
    };
    const overrides = {
        '@google/genai': {
            GoogleGenAI: class {
                constructor() {
                    this.live = { connect };
                }
            },
            Modality: { TEXT: 'TEXT', AUDIO: 'AUDIO' },
        },
        electron: {
            BrowserWindow: { getAllWindows: () => [{ webContents: { send: (...args) => events.push(args) } }] },
            ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        },
        '../storage': storage,
        './cloud': { closeCloud() {}, isCloudActive: () => false },
        './transportLogger': { startTransportLog() {}, logTransportEvent() {}, closeTransportLog() {} },
    };
    vm.runInNewContext(
        fs.readFileSync(filename, 'utf8'),
        {
            module,
            exports: module.exports,
            require: name => overrides[name] || relative(name),
            console,
            Buffer,
            process,
            global: {},
            setTimeout,
            clearTimeout,
            AbortController,
            AbortSignal,
            DOMException,
        },
        { filename }
    );
    module.exports.setRuntimeConfigGetter(() => config);
    module.exports.setupGeminiIpcHandlers({ current: null });
    return { handlers, events };
}
test('Live handshake errors return actionable structured failures without exposing the key', async () => {
    const { handlers, events } = geminiModule(async () => {
        throw new Error('Model not available: private-fixture-key');
    });
    const result = await handlers.get('initialize-gemini')({}, undefined, '', 'interview', 'en-US');
    assert.equal(result.success, false);
    assert.match(result.error, /Model not available/);
    assert.ok(!result.error.includes('private-fixture-key'));
    assert.ok(events.some(([channel, text]) => channel === 'update-status' && text.includes('Session could not start')));
});
test('successful initialization uses the same structured result contract', async () => {
    const { handlers } = geminiModule(async () => ({ close() {} }));
    const result = await handlers.get('initialize-gemini')({}, undefined, '', 'interview', 'en-US');
    assert.equal(result.success, true);
});
