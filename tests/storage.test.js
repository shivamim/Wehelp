const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function load(file, overrides) {
    const filename = path.resolve(file),
        relative = createRequire(filename),
        module = { exports: {} };
    vm.runInNewContext(
        fs.readFileSync(filename, 'utf8'),
        { module, exports: module.exports, require: name => overrides[name] || relative(name), console, Buffer, process, setTimeout, clearTimeout },
        { filename }
    );
    return module.exports;
}
test('storage migration preserves old history/preferences and atomic read-your-writes', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wehelp-storage-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const storage = load('src/storage.js', { os: { ...os, homedir: () => root } });
    const dir = storage.getConfigDir();
    fs.mkdirSync(path.join(dir, 'history'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ configVersion: 1, groqModel: 'openai/gpt-oss-20b', onboarded: true }));
    fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify({ customPrompt: 'keep my instructions' }));
    fs.writeFileSync(path.join(dir, 'history/123.json'), JSON.stringify({ conversationHistory: [{ ai_response: 'preserved' }] }));
    storage.initializeStorage();
    assert.equal(storage.getConfig().configVersion, 2);
    assert.equal(storage.getConfig().groqModel, 'openai/gpt-oss-20b');
    assert.equal(storage.getPreferences().customPrompt, 'keep my instructions');
    assert.equal(storage.getSession('123').conversationHistory[0].ai_response, 'preserved');
    const a = storage.updateConfig('responseStyle', 'concise');
    const b = storage.updateConfig('responseStyle', 'detailed');
    assert.equal(storage.getConfig().responseStyle, 'detailed');
    await Promise.all([a, b]);
    await storage.flushStorage();
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'))).responseStyle, 'detailed');
    assert.ok(fs.existsSync(path.join(dir, 'config.json.v1-backup')));
    assert.throws(() => storage.getSession('../../key'));
});
test('uninitialized credential access never falls back to plaintext', () => {
    const storage = load('src/storage.js', {});
    assert.throws(() => storage.getApiKey(), /not been initialized/);
    assert.throws(() => storage.setGroqApiKey('fake'), /not been initialized/);
});
test('failed secure migration never removes the legacy key; successful migration strips plaintext', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wehelp-keys-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const legacy = path.join(root, 'credentials.json');
    fs.writeFileSync(legacy, JSON.stringify({ apiKey: 'AIza' + 'a'.repeat(35), other: 'preserve' }));
    let available = false;
    const safeStorage = {
        isEncryptionAvailable: () => available,
        encryptString: value => Buffer.from(value.split('').reverse().join('')),
        decryptString: value => value.toString().split('').reverse().join(''),
    };
    const { ApiKeyManager } = load('src/utils/apiKeys.js', { electron: { safeStorage } });
    const failed = new ApiKeyManager(() => root);
    failed.getApiKey();
    assert.ok(JSON.parse(fs.readFileSync(legacy)).apiKey);
    available = true;
    const manager = new ApiKeyManager(() => root);
    assert.equal(manager.getApiKey(), 'AIza' + 'a'.repeat(35));
    assert.equal(JSON.parse(fs.readFileSync(legacy)).apiKey, undefined);
    assert.equal(JSON.parse(fs.readFileSync(legacy)).other, 'preserve');
    assert.ok(manager.setGroqApiKey('gsk_' + 'b'.repeat(30)));
    assert.ok(!fs.readFileSync(path.join(root, 'secrets.enc'), 'utf8').includes('gsk_'));
});
test('Offline native preparation does not contact remote metadata or download endpoints', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wehelp-offline-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const runtime = load('src/utils/native-ai-runtime.js', { '../storage': { getConfigDir: () => root } });
    await assert.rejects(runtime.ensureWhisperModel('tiny.en', null, undefined, true), /Offline mode/);
    await assert.rejects(runtime.ensureLlamaModel('owner/model:Q4_K_M', null, null, undefined, true), /Offline mode/);
});
test('append-only history keeps old sessions and all turns without rewriting full history on each completion', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wehelp-journal-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const storage = load('src/storage.js', { os: { ...os, homedir: () => root } });
    storage.initializeStorage();
    await storage.saveSession('123', { conversationHistory: [{ timestamp: 1, transcription: 'old', ai_response: 'preserved' }] });
    await Promise.all([
        storage.appendSessionTurn('123', { timestamp: 2, transcription: 'new', ai_response: 'first' }),
        storage.appendSessionTurn('123', { timestamp: 3, transcription: 'next', ai_response: 'second' }),
    ]);
    assert.equal(storage.getSession('123').conversationHistory.length, 3);
    assert.equal(storage.getAllSessions()[0].messageCount, 3);
    assert.equal(JSON.parse(fs.readFileSync(path.join(storage.getConfigDir(), 'history/123.json'))).conversationHistory.length, 1);
    await storage.deleteSession('123');
    assert.ok(!fs.existsSync(path.join(storage.getConfigDir(), 'history/123.json.turns.jsonl')));
    await storage.flushStorage();
});
test('a newer configuration schema is preserved instead of downgraded', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wehelp-future-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const storage = load('src/storage.js', { os: { ...os, homedir: () => root } });
    const dir = storage.getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ configVersion: 99, custom: 'preserve' }));
    assert.throws(() => storage.initializeStorage(), /newer WeHelp version/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'))).custom, 'preserve');
});
