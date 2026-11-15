const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_VERSION = 2;

// ── Gemini model catalog ─────────────────────────────────────────────────────
// Keep this list ordered fastest-first — the UI dropdown and the migration
// logic below both rely on that ordering.
const { ModelRegistry } = require('./engine/model-registry');
const catalog = new ModelRegistry();
const GEMINI_LIVE_MODELS = catalog
    .list('live')
    .filter(m => m.provider === 'gemini')
    .map(m => m.id);
const GEMINI_CHAT_MODELS = catalog
    .list('text')
    .filter(m => m.provider === 'gemini')
    .map(m => m.id);
const LEGACY_GEMINI_MODEL_MAP = {
    'gemini-2.5-flash-preview-tts': 'gemini-3.1-flash-live-preview',
};

// Default values
const DEFAULT_CONFIG = {
    configVersion: CONFIG_VERSION,
    onboarded: false,
    layout: 'normal',
    geminiLiveModel: 'gemini-3.1-flash-live-preview',
    geminiChatModel: 'auto',
    groqModel: 'auto',
    groqImageModel: 'auto',
    disableGroqThinking: true,
    performanceMode: 'balanced',
    responseProvider: 'auto',
    responseStyle: 'standard',
    transcriptionProvider: 'gemini',
    transcriptionModel: 'gemini-3.5-transcribe-live',
    audioChunkMs: 100,
    endpointSilenceMs: 700,
    alwaysOnTop: false,
    screenSharePrivacy: false,
    minimizeToTray: true,
    hideFromTaskbar: false,
    launchAtLogin: false,
};

const DEFAULT_CREDENTIALS = {
    apiKey: '',
    groqApiKey: '',
};

const DEFAULT_PREFERENCES = {
    customPrompt: '',
    providerMode: 'byok',
    selectedProfile: 'interview',
    selectedLanguage: 'en-US',
    selectedScreenshotInterval: '5',
    selectedImageQuality: 'medium',
    advancedMode: false,
    audioMode: 'speaker_only',
    fontSize: 'medium',
    backgroundTransparency: 0.8,
    googleSearchEnabled: false,
    localLlmModel: 'unsloth/Qwen3.5-4B-GGUF:Q4_K_M',
    whisperModel: 'tiny.en',
};

const DEFAULT_KEYBINDS = null; // null means use system defaults

const DEFAULT_LIMITS = {
    data: [], // Array of { date: 'YYYY-MM-DD', flash: { count }, flashLite: { count }, groq: { 'qwen3-32b': { chars, limit }, 'gpt-oss-120b': { chars, limit }, 'gpt-oss-20b': { chars, limit } }, gemini: { 'gemma-4-26b-a4b-it': { chars } } }
};

// Get the config directory path based on OS
function getConfigDir() {
    if (process.env.WEHELP_DATA_DIR) return path.resolve(process.env.WEHELP_DATA_DIR);
    const platform = os.platform();
    let configDir;

    if (platform === 'win32') {
        configDir = path.join(os.homedir(), 'AppData', 'Roaming', 'cheating-daddy-config');
    } else if (platform === 'darwin') {
        configDir = path.join(os.homedir(), 'Library', 'Application Support', 'cheating-daddy-config');
    } else {
        configDir = path.join(os.homedir(), '.config', 'cheating-daddy-config');
    }

    return configDir;
}

// File paths
function getConfigPath() {
    return path.join(getConfigDir(), 'config.json');
}

function getCredentialsPath() {
    return path.join(getConfigDir(), 'credentials.json');
}

function getPreferencesPath() {
    return path.join(getConfigDir(), 'preferences.json');
}

function getKeybindsPath() {
    return path.join(getConfigDir(), 'keybinds.json');
}

function getLimitsPath() {
    return path.join(getConfigDir(), 'limits.json');
}

function getHistoryDir() {
    return path.join(getConfigDir(), 'history');
}

const pendingWrites = new Map();
const pendingValues = new Map();

// Helper to read JSON file safely
function readJsonFile(filePath, defaultValue) {
    if (pendingValues.has(filePath)) return JSON.parse(pendingValues.get(filePath));
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.warn(`Error reading ${filePath}:`, error.message);
    }
    return defaultValue;
}

// Helper to write JSON file safely
function writeJsonFile(filePath, data) {
    const serialized = JSON.stringify(data, null, 2);
    pendingValues.set(filePath, serialized);
    const previous = pendingWrites.get(filePath) || Promise.resolve();
    const work = previous
        .catch(() => {})
        .then(async () => {
            const temporary = `${filePath}.tmp`;
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
            await fs.promises.rename(temporary, filePath);
            return true;
        });
    pendingWrites.set(filePath, work);
    work.then(
        () => {
            if (pendingWrites.get(filePath) === work) {
                pendingWrites.delete(filePath);
                pendingValues.delete(filePath);
            }
        },
        error => {
            console.error('Settings persistence failed:', error.message);
        }
    );
    return work;
}
async function flushStorage() {
    flushLimits();
    await Promise.all([...pendingWrites.values()]);
}

// Check if we need to reset (no configVersion or wrong version)
function needsReset() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        return true;
    }

    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return !config.configVersion || config.configVersion !== CONFIG_VERSION;
    } catch {
        return true;
    }
}

// Wipe and reinitialize the config directory
function resetConfigDir() {
    const configDir = getConfigDir();

    console.log('Resetting config directory...');

    // Remove existing directory if it exists
    if (fs.existsSync(configDir)) {
        fs.rmSync(configDir, { recursive: true, force: true });
    }

    // Create fresh directory structure
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(getHistoryDir(), { recursive: true });

    // Initialize with defaults
    writeJsonFile(getConfigPath(), DEFAULT_CONFIG);
    writeJsonFile(getCredentialsPath(), DEFAULT_CREDENTIALS);
    writeJsonFile(getPreferencesPath(), DEFAULT_PREFERENCES);
    invalidateConfigCache();

    console.log('Config directory initialized with defaults');
}

// Initialize storage - call this on app startup
function initializeStorage() {
    // A version change must never erase preferences, keys or conversation history.
    fs.mkdirSync(getHistoryDir(), { recursive: true });
    const saved = readJsonFile(getConfigPath(), {});
    if (Number(saved.configVersion) > CONFIG_VERSION)
        throw new Error('Settings were saved by a newer WeHelp version; use that version to preserve compatibility');
    if (saved.configVersion !== CONFIG_VERSION) {
        if (fs.existsSync(getConfigPath())) fs.copyFileSync(getConfigPath(), getConfigPath() + '.v1-backup');
        configCache = { ...DEFAULT_CONFIG, ...saved, configVersion: CONFIG_VERSION };
        _migrateGeminiModels(configCache);
        writeJsonFile(getConfigPath(), configCache);
    }
}

// ============ CONFIG ============

// In-memory cache so hot paths (every AI call) never touch the disk.
let configCache = null;
let configNeedsPersist = false;

function _migrateGeminiModels(config) {
    let changed = false;
    for (const key of ['geminiLiveModel', 'geminiChatModel']) {
        const value = config[key];
        if (typeof value !== 'string' || !value.trim()) {
            config[key] = DEFAULT_CONFIG[key];
            changed = true;
            continue;
        }
        const mapped = LEGACY_GEMINI_MODEL_MAP[value];
        if (mapped) {
            config[key] = mapped;
            changed = true;
        }
    }
    return changed;
}

function getConfig() {
    if (configCache) return configCache;
    const saved = readJsonFile(getConfigPath(), {});
    const config = { ...DEFAULT_CONFIG, ...saved };
    if (_migrateGeminiModels(config)) {
        // Persist migrated model ids once so we don't redo the work every boot.
        configNeedsPersist = true;
        writeJsonFile(getConfigPath(), config);
        configNeedsPersist = false;
    }
    configCache = config;
    return configCache;
}

function invalidateConfigCache() {
    configCache = null;
}

function setConfig(config) {
    const current = getConfig();
    const updated = { ...current, ...config, configVersion: CONFIG_VERSION };
    _migrateGeminiModels(updated);
    configCache = updated;
    return writeJsonFile(getConfigPath(), updated);
}

function updateConfig(key, value) {
    const config = { ...getConfig() };
    config[key] = value;
    if (key === 'geminiLiveModel' || key === 'geminiChatModel') {
        _migrateGeminiModels(config);
    }
    configCache = config;
    return writeJsonFile(getConfigPath(), config);
}

// ============ CREDENTIALS ============
// API keys (apiKey / groqApiKey) live in secure storage (OS keychain or an
// encrypted file — see src/utils/apiKeys.js). Non-secret credential fields
// (e.g. cloudToken) remain in credentials.json. The ApiKeyManager is injected
// at app startup via setApiKeyManager(); until then we transparently fall back
// to the legacy plaintext file so nothing breaks during boot/migration.

let apiKeyManager = null;

function setApiKeyManager(manager) {
    apiKeyManager = manager;
}

function _readLegacySecret(name) {
    const creds = readJsonFile(getCredentialsPath(), DEFAULT_CREDENTIALS);
    return name === 'gemini' ? creds.apiKey || '' : creds.groqApiKey || '';
}

function _writeLegacySecret(name, value) {
    const current = getCredentials();
    const updated = { ...current };
    if (name === 'gemini') updated.apiKey = value;
    else updated.groqApiKey = value;
    return writeJsonFile(getCredentialsPath(), updated);
}

function getCredentials() {
    const stored = readJsonFile(getCredentialsPath(), DEFAULT_CREDENTIALS);
    // Strip secret material from this view; callers get authoritative values
    // from getApiKey()/getGroqApiKey() (secure store first, legacy fallback).
    const { apiKey, groqApiKey, ...rest } = stored;
    return {
        ...DEFAULT_CREDENTIALS,
        ...rest,
        apiKey: getApiKey(),
        groqApiKey: getGroqApiKey(),
    };
}

function setCredentials(credentials) {
    const updates = { ...credentials };

    // Route key material through the secure manager (with normalization).
    if ('apiKey' in updates) {
        setApiKey(updates.apiKey);
        delete updates.apiKey;
    }
    if ('groqApiKey' in updates) {
        setGroqApiKey(updates.groqApiKey);
        delete updates.groqApiKey;
    }

    if (Object.keys(updates).length === 0) return true;

    const current = readJsonFile(getCredentialsPath(), DEFAULT_CREDENTIALS);
    const updated = { ...current, ...updates };
    // Never persist secret fields in the plaintext file anymore.
    delete updated.apiKey;
    delete updated.groqApiKey;
    return writeJsonFile(getCredentialsPath(), updated);
}

function getApiKey() {
    if (apiKeyManager) return apiKeyManager.getApiKey();
    throw new Error('Secure credential manager has not been initialized');
}

function setApiKey(apiKey) {
    if (apiKeyManager) return apiKeyManager.setApiKey(apiKey);
    throw new Error('Secure credential manager has not been initialized');
}

function getGroqApiKey() {
    if (apiKeyManager) return apiKeyManager.getGroqApiKey();
    throw new Error('Secure credential manager has not been initialized');
}

function setGroqApiKey(groqApiKey) {
    if (apiKeyManager) return apiKeyManager.setGroqApiKey(groqApiKey);
    throw new Error('Secure credential manager has not been initialized');
}

// ============ PREFERENCES ============

function getPreferences() {
    const saved = readJsonFile(getPreferencesPath(), {});
    const preferences = { ...DEFAULT_PREFERENCES, ...saved };
    const legacyWhisperModels = {
        'Xenova/whisper-tiny': 'tiny.en',
        'Xenova/whisper-base': 'base.en',
        'Xenova/whisper-small': 'small.en',
    };

    preferences.whisperModel = legacyWhisperModels[preferences.whisperModel] || preferences.whisperModel;
    return preferences;
}

function setPreferences(preferences) {
    const current = getPreferences();
    const updated = { ...current, ...preferences };
    return writeJsonFile(getPreferencesPath(), updated);
}

function updatePreference(key, value) {
    const preferences = getPreferences();
    preferences[key] = value;
    return writeJsonFile(getPreferencesPath(), preferences);
}

// ============ KEYBINDS ============

function getKeybinds() {
    return readJsonFile(getKeybindsPath(), DEFAULT_KEYBINDS);
}

function setKeybinds(keybinds) {
    return writeJsonFile(getKeybindsPath(), keybinds);
}

// ============ LIMITS (Rate Limiting) ============
// Limits are updated on every AI call, so reads/writes are served from an
// in-memory cache and flushed to disk debounced (and synchronously on exit).

let limitsCache = null;
let limitsFlushTimer = null;

function _ensureLimitsLoaded() {
    if (!limitsCache) {
        const stored = readJsonFile(getLimitsPath(), DEFAULT_LIMITS);
        limitsCache = { data: Array.isArray(stored.data) ? stored.data : [] };
    }
    return limitsCache;
}

function _scheduleLimitsFlush() {
    if (limitsFlushTimer) return;
    limitsFlushTimer = setTimeout(() => {
        limitsFlushTimer = null;
        flushLimits();
    }, 2000);
    if (limitsFlushTimer.unref) limitsFlushTimer.unref();
}

/** Force-write pending limit changes to disk. */
function flushLimits() {
    if (limitsFlushTimer) {
        clearTimeout(limitsFlushTimer);
        limitsFlushTimer = null;
    }
    if (limitsCache) writeJsonFile(getLimitsPath(), limitsCache);
}

function getLimits() {
    return _ensureLimitsLoaded();
}

function setLimits(limits) {
    limitsCache = limits;
    _scheduleLimitsFlush();
    return true;
}

function getTodayDateString() {
    const now = new Date();
    return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getTodayLimits() {
    const limits = getLimits();
    const today = getTodayDateString();

    // Find today's entry
    const todayEntry = limits.data.find(entry => entry.date === today);

    if (todayEntry) {
        // ensure new fields exist
        if (!todayEntry.groq) {
            todayEntry.groq = {
                'qwen3-32b': { chars: 0, limit: 1500000 },
                'gpt-oss-120b': { chars: 0, limit: 600000 },
                'gpt-oss-20b': { chars: 0, limit: 600000 },
                'kimi-k2-instruct': { chars: 0, limit: 600000 },
            };
        }
        if (!todayEntry.gemini) {
            todayEntry.gemini = {};
        }
        return todayEntry;
    }

    // No entry for today - clean old entries and create new one
    limits.data = [];
    const newEntry = {
        date: today,
        flash: { count: 0 },
        flashLite: { count: 0 },
        groq: {
            'qwen3-32b': { chars: 0, limit: 1500000 },
            'gpt-oss-120b': { chars: 0, limit: 600000 },
            'gpt-oss-20b': { chars: 0, limit: 600000 },
            'kimi-k2-instruct': { chars: 0, limit: 600000 },
        },
        gemini: {},
    };
    limits.data.push(newEntry);
    setLimits(limits);

    return newEntry;
}

function incrementLimitCount(model) {
    const limits = getLimits();
    const today = getTodayDateString();

    // Find or create today's entry
    let todayEntry = limits.data.find(entry => entry.date === today);

    if (!todayEntry) {
        todayEntry = getTodayLimits();
    }

    // Increment the appropriate model counter (create on demand so new model
    // ids never crash on a missing counter object).
    const countersByModel = {
        'gemini-2.5-flash': 'flash',
        'gemini-2.5-flash-lite': 'flashLite',
        'gemini-3-flash': 'chat',
        'gemini-3.1-flash-lite': 'chatLite',
        'gemini-3-pro': 'pro',
    };
    const key = countersByModel[model];
    if (key) {
        if (!todayEntry[key]) todayEntry[key] = { count: 0 };
        todayEntry[key].count++;
    }

    setLimits(limits);
    return todayEntry;
}

function incrementCharUsage(provider, model, charCount) {
    const todayEntry = getTodayLimits();

    if (!Number.isFinite(charCount) || charCount <= 0) return todayEntry;

    if (!todayEntry[provider]) todayEntry[provider] = {};
    if (!todayEntry[provider][model]) todayEntry[provider][model] = { chars: 0, limit: 1500000 };
    todayEntry[provider][model].chars += charCount;
    setLimits(getLimits());

    return todayEntry;
}

// Pick the fastest healthy Gemini chat/vision model based on daily quotas.
// Free-tier RPD budget is per model — rotating when one runs out keeps calls
// flowing instead of stalling on 429 backoff.
function getAvailableModel() {
    const config = getConfig();
    const preferred =
        typeof config.geminiChatModel === 'string' && config.geminiChatModel.trim() ? config.geminiChatModel.trim() : DEFAULT_CONFIG.geminiChatModel;

    const rotation = [preferred, ...GEMINI_CHAT_MODELS.filter(m => m !== preferred)];
    const todayEntry = getTodayLimits();
    const gemini = todayEntry.gemini || {};

    const FREE_TIER_RPD = 30; // conservative floor across tiers
    for (const model of rotation) {
        const used = gemini[model]?.requestsToday || 0;
        if (used < FREE_TIER_RPD) return model;
    }

    // All quotas exhausted — paid tier still works on the preferred model.
    return preferred;
}

function recordModelRequest(model) {
    const todayEntry = getTodayLimits();
    if (!todayEntry.gemini) todayEntry.gemini = {};
    if (!todayEntry.gemini[model]) todayEntry.gemini[model] = { chars: 0, requestsToday: 0 };
    if (todayEntry.gemini[model].requestsToday === undefined) todayEntry.gemini[model].requestsToday = 0;
    todayEntry.gemini[model].requestsToday++;
    setLimits(getLimits());
}

function getModelForToday() {
    const todayEntry = getTodayLimits();
    const groq = todayEntry.groq;

    if (groq['gpt-oss-120b'].chars < groq['gpt-oss-120b'].limit) {
        return 'openai/gpt-oss-120b';
    }
    if (groq['gpt-oss-20b'].chars < groq['gpt-oss-20b'].limit) {
        return 'openai/gpt-oss-20b';
    }
    if (groq['kimi-k2-instruct'].chars < groq['kimi-k2-instruct'].limit) {
        return 'moonshotai/kimi-k2-instruct';
    }

    // All limits exhausted
    return null;
}

// ============ HISTORY ============

function getSessionPath(sessionId) {
    if (typeof sessionId !== 'string' || !/^[\w-]{1,100}$/.test(sessionId)) throw new Error('Invalid session ID');
    return path.join(getHistoryDir(), `${sessionId}.json`);
}

function saveSession(sessionId, data) {
    const sessionPath = getSessionPath(sessionId);

    // Load existing session to preserve metadata
    const existingSession = readJsonFile(sessionPath, null);

    const sessionData = {
        sessionId,
        createdAt: existingSession?.createdAt || parseInt(sessionId),
        lastUpdated: Date.now(),
        // Profile context - set once when session starts
        profile: data.profile || existingSession?.profile || null,
        customPrompt: data.customPrompt || existingSession?.customPrompt || null,
        // Conversation data
        conversationHistory: data.conversationHistory || existingSession?.conversationHistory || [],
        screenAnalysisHistory: data.screenAnalysisHistory || existingSession?.screenAnalysisHistory || [],
    };
    return writeJsonFile(sessionPath, sessionData);
}

function appendSessionTurn(sessionId, turn) {
    const filePath = getSessionPath(sessionId) + '.turns.jsonl';
    const line = JSON.stringify(turn) + '\n';
    const work = (pendingWrites.get(filePath) || Promise.resolve())
        .catch(() => {})
        .then(async () => {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.appendFile(filePath, line, { encoding: 'utf8', mode: 0o600 });
        });
    pendingWrites.set(filePath, work);
    work.then(
        () => {
            if (pendingWrites.get(filePath) === work) pendingWrites.delete(filePath);
        },
        error => console.error('History append failed:', error.message)
    );
    return work;
}
function getSession(sessionId) {
    const filePath = getSessionPath(sessionId);
    const data = readJsonFile(filePath, null);
    if (!data) return null;
    const journal = filePath + '.turns.jsonl';
    if (fs.existsSync(journal)) {
        const turns = [];
        for (const line of fs.readFileSync(journal, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                turns.push(JSON.parse(line));
            } catch {
                console.warn('Incomplete history journal record retained for recovery');
            }
        }
        data.conversationHistory = [...(data.conversationHistory || []), ...turns];
        data.lastUpdated = turns.at(-1)?.timestamp || data.lastUpdated;
    }
    return data;
}

function getAllSessions() {
    const historyDir = getHistoryDir();

    try {
        if (!fs.existsSync(historyDir)) {
            return [];
        }

        const files = fs
            .readdirSync(historyDir)
            .filter(f => f.endsWith('.json'))
            .sort((a, b) => {
                // Sort by timestamp descending (newest first)
                const tsA = parseInt(a.replace('.json', ''));
                const tsB = parseInt(b.replace('.json', ''));
                return tsB - tsA;
            });

        return files
            .map(file => {
                const sessionId = file.replace('.json', '');
                const data = getSession(sessionId);
                if (data) {
                    return {
                        sessionId,
                        createdAt: data.createdAt,
                        lastUpdated: data.lastUpdated,
                        messageCount: data.conversationHistory?.length || 0,
                        screenAnalysisCount: data.screenAnalysisHistory?.length || 0,
                        profile: data.profile || null,
                        customPrompt: data.customPrompt || null,
                    };
                }
                return null;
            })
            .filter(Boolean);
    } catch (error) {
        console.error('Error reading sessions:', error.message);
        return [];
    }
}

async function deleteSession(sessionId) {
    const sessionPath = getSessionPath(sessionId);
    await Promise.all([pendingWrites.get(sessionPath), pendingWrites.get(sessionPath + '.turns.jsonl')]);
    try {
        await fs.promises.rm(sessionPath + '.turns.jsonl', { force: true });
        if (fs.existsSync(sessionPath)) {
            fs.unlinkSync(sessionPath);
            return true;
        }
    } catch (error) {
        console.error('Error deleting session:', error.message);
    }
    return false;
}

async function deleteAllSessions() {
    await flushStorage();
    const historyDir = getHistoryDir();
    try {
        if (fs.existsSync(historyDir)) {
            const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json') || f.endsWith('.turns.jsonl'));
            files.forEach(file => {
                fs.unlinkSync(path.join(historyDir, file));
            });
        }
        return true;
    } catch (error) {
        console.error('Error deleting all sessions:', error.message);
        return false;
    }
}

// ============ CLEAR ALL DATA ============

async function clearAllData() {
    await flushStorage();
    if (apiKeyManager) {
        if (!apiKeyManager.setApiKey('') || !apiKeyManager.setGroqApiKey('')) throw new Error('Could not clear secure credentials');
    }
    configCache = null;
    limitsCache = null;
    resetConfigDir();
    await flushStorage();
    return true;
}

module.exports = {
    // Initialization
    initializeStorage,
    flushStorage,
    getConfigDir,

    // Config
    getConfig,
    setConfig,
    updateConfig,
    invalidateConfigCache,
    GEMINI_LIVE_MODELS,
    GEMINI_CHAT_MODELS,

    setApiKeyManager,

    // Credentials
    getCredentials,
    setCredentials,
    getApiKey,
    setApiKey,
    getGroqApiKey,
    setGroqApiKey,

    // Preferences
    getPreferences,
    setPreferences,
    updatePreference,

    // Keybinds
    getKeybinds,
    setKeybinds,

    // Limits (Rate Limiting)
    getLimits,
    setLimits,
    flushLimits,
    getTodayLimits,
    incrementLimitCount,
    getAvailableModel,
    recordModelRequest,
    incrementCharUsage,
    getModelForToday,

    // History
    saveSession,
    appendSessionTurn,
    getSession,
    getAllSessions,
    deleteSession,
    deleteAllSessions,

    // Clear all
    clearAllData,
};
