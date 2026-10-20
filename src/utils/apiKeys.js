/**
 * API key management: normalization, validation, secure storage (OS keychain with
 * encrypted-at-rest fallback), and cached verification against provider endpoints.
 *
 * Public API is synchronous for reads (backed by an in-memory cache) so hot paths
 * like per-request auth header building never block on disk/keychain I/O.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ── Key shapes ────────────────────────────────────────────────────────────────

const KEY_PATTERNS = {
    gemini: /^AIza[0-9A-Za-z_\-]{35}$/,
    groq: /^gsk_[A-Za-z0-9_\-]{20,}$/,
};

// ── Normalization ─────────────────────────────────────────────────────────────

/**
 * Clean a user-pasted key: trim whitespace, strip quotes/backticks/zero-width
 * characters that are commonly introduced by copy-paste from docs or chat apps.
 */
function normalizeKey(raw) {
    if (typeof raw !== 'string') return '';
    return raw
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars & BOM
        .replace(/^['"`\s]+|['"`\s]+$/g, '') // surrounding quotes/whitespace
        .trim();
}

/** Validate the basic shape of a key without any network call. */
function looksValid(provider, key) {
    const normalized = normalizeKey(key);
    if (!normalized) return false;
    const pattern = KEY_PATTERNS[provider];
    return pattern ? pattern.test(normalized) : normalized.length >= 12;
}

/** Human-readable reason a key was rejected locally (avoids pointless API calls). */
function getShapeError(provider, key) {
    const normalized = normalizeKey(key);
    if (!normalized) return `${provider.toUpperCase()} API key is empty`;
    if (!looksValid(provider, normalized)) {
        const examples = { gemini: 'starts with "AIza…" (Google AI Studio)', groq: 'starts with "gsk_…" (console.groq.com/keys)' };
        return `Invalid ${provider.toUpperCase()} API key format — ${examples[provider] || 'check the key and try again'}`;
    }
    return null;
}

// ── Secure storage backend (keychain → encrypted file → plaintext migration) ──

const SERVICE_NAME = 'cheating-daddy';
const LEGACY_PLAINTEXT_FILE = 'credentials.json';

function getKeychainAvailable() {
    if (process.platform === 'darwin') return true;
    if (process.platform === 'win32') {
        try {
            execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output ok'], {
                stdio: 'ignore',
                timeout: 4000,
            });
            return true;
        } catch {
            return false;
        }
    }
    if (process.platform === 'linux') {
        try {
            execFileSync('secret-tool', ['store', '--label=test', 'service', SERVICE_NAME], {
                input: 'probe',
                stdio: ['pipe', 'ignore', 'ignore'],
                timeout: 4000,
            });
            execFileSync('secret-tool', ['clear', 'service', SERVICE_NAME], { stdio: 'ignore', timeout: 4000 });
            return true;
        } catch {
            return false;
        }
    }
    return false;
}

let keychainAvailable = null;
function hasKeychain(configDir) {
    if (keychainAvailable === null) keychainAvailable = getKeychainAvailable();
    return keychainAvailable;
}

function keychainGet(account) {
    try {
        if (process.platform === 'darwin') {
            return execFileSync('security', ['find-generic-password', '-s', SERVICE_NAME, '-a', account, '-w'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 5000,
            }).trim();
        }
        // Windows uses the DPAPI-encrypted secrets file instead of the login keychain,
        // which is more reliable for non-interactive access. See encryptSecrets().
        if (process.platform === 'linux') {
            return execFileSync('secret-tool', ['lookup', 'service', SERVICE_NAME, 'account', account], {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'],
                timeout: 5000,
            });
        }
    } catch {
        return null;
    }
    return null;
}

function keychainSet(account, value) {
    try {
        if (process.platform === 'darwin') {
            execFileSync('security', ['add-generic-password', '-U', '-s', SERVICE_NAME, '-a', account, '-w', value], {
                stdio: 'ignore',
                timeout: 5000,
            });
            return true;
        }
        if (process.platform === 'linux') {
            execFileSync('secret-tool', ['store', '--label', `${SERVICE_NAME}:${account}`, 'service', SERVICE_NAME, 'account', account], {
                input: value,
                stdio: ['pipe', 'ignore', 'ignore'],
                timeout: 5000,
            });
            return true;
        }
    } catch {
        return false;
    }
    return false;
}

function keychainDelete(account) {
    try {
        if (process.platform === 'darwin') {
            execFileSync('security', ['delete-generic-password', '-s', SERVICE_NAME, '-a', account], { stdio: 'ignore', timeout: 5000 });
            return true;
        }
        if (process.platform === 'linux') {
            execFileSync('secret-tool', ['clear', 'service', SERVICE_NAME, 'account', account], { stdio: 'ignore', timeout: 5000 });
            return true;
        }
    } catch {
        return false;
    }
    return false;
}

// DPAPI-backed encrypted file (Windows) / AES-256-GCM machine-bound key (fallback)

const ENC_FILE = 'secrets.enc';
const KEYFILE = '.device-key';

function dpapi(command, input) {
    const b64 = Buffer.from(input, 'utf8').toString('base64');
    const script =
        command === 'protect'
            ? `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String('${b64}'), $null, 'CurrentUser'))`
            : `Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64}'), $null, 'CurrentUser'))`;
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8000,
    }).trim();
}

function deviceKey(configDir) {
    const keyPath = path.join(configDir, KEYFILE);
    try {
        if (fs.existsSync(keyPath)) {
            const raw = fs.readFileSync(keyPath, 'utf8').trim();
            if (raw.length === 64) return Buffer.from(raw, 'hex');
        }
    } catch {}
    const key = crypto.randomBytes(32);
    try {
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
    } catch {}
    return key;
}

function encryptSecrets(configDir, json) {
    if (process.platform === 'win32') {
        try {
            return { scheme: 'dpapi', payload: dpapi('protect', json) };
        } catch {}
    }
    const key = deviceKey(configDir);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
    return { scheme: 'aes-256-gcm', payload: `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}` };
}

function decryptSecrets(configDir, record) {
    try {
        if (record.scheme === 'dpapi') return dpapi('unprotect', record.payload);
        if (record.scheme === 'aes-256-gcm') {
            const [ivHex, tagHex, dataHex] = record.payload.split(':');
            const decipher = crypto.createDecipheriv('aes-256-gcm', deviceKey(configDir), Buffer.from(ivHex, 'hex'));
            decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
            return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
        }
    } catch (e) {
        console.warn('[Keys] Failed to decrypt secrets:', e.message);
    }
    return null;
}

// ── Secret store facade ───────────────────────────────────────────────────────

class SecretStore {
    constructor(configDir) {
        this.configDir = configDir;
        // macOS Keychain / Linux libsecret are interactive-safe; Windows uses DPAPI file.
        this.useKeychain = (process.platform === 'darwin' || process.platform === 'linux') && hasKeychain(configDir);
        this.memory = null; // last known good snapshot — hot reads never hit disk/keychain
    }

    _encFilePath() {
        return path.join(this.configDir, ENC_FILE);
    }

    _readFromBackend() {
        if (this.useKeychain) {
            const out = {};
            for (const name of ['gemini', 'groq']) {
                const v = keychainGet(name);
                if (v) out[name] = v;
            }
            return out;
        }
        try {
            const file = this._encFilePath();
            if (fs.existsSync(file)) {
                const record = JSON.parse(fs.readFileSync(file, 'utf8'));
                const json = decryptSecrets(this.configDir, record);
                if (json) return JSON.parse(json);
            }
        } catch (e) {
            console.warn('[Keys] Could not read encrypted secrets:', e.message);
        }
        return null;
    }

    readAll() {
        if (this.memory) return this.memory;
        const loaded = this._readFromBackend();
        this.memory = loaded || {};
        return this.memory;
    }

    writeAll(secrets) {
        const next = { ...secrets };
        let ok;
        if (this.useKeychain) {
            ok = true;
            for (const name of ['gemini', 'groq']) {
                const value = next[name];
                if (value) ok = keychainSet(name, value) && ok;
                else keychainDelete(name);
            }
            if (!ok) return false;
        } else {
            try {
                fs.mkdirSync(this.configDir, { recursive: true });
                const record = encryptSecrets(this.configDir, JSON.stringify(next));
                fs.writeFileSync(this._encFilePath(), JSON.stringify(record), { mode: 0o600 });
            } catch (e) {
                console.error('[Keys] Could not persist secrets:', e.message);
                return false;
            }
        }
        this.memory = next; // keep in-memory cache authoritative after successful write
        return true;
    }

    /** One-time migration off plaintext credentials.json. */
    migrateFromPlaintext(legacyCreds) {
        if (!legacyCreds) return false;
        const migrated = {};
        if (legacyCreds.apiKey) migrated.gemini = normalizeKey(legacyCreds.apiKey);
        if (legacyCreds.groqApiKey) migrated.groq = normalizeKey(legacyCreds.groqApiKey);
        if (Object.keys(migrated).length === 0) return false;
        const existing = this.readAll();
        const merged = { ...migrated, ...existing }; // existing secure values win
        this.writeAll(merged);
        return true;
    }
}

// ── Verification (cached, deduplicated) ───────────────────────────────────────

const VERIFY_TTL_MS = 15 * 60 * 1000; // 15 min success cache
const FAILURE_TTL_MS = 30 * 1000; // keep failure results briefly to stop hammering

class ApiKeyManager {
    constructor(configDirProvider) {
        this.getConfigDir = configDirProvider;
        this.store = new SecretStore(configDirProvider());
        this.cache = { gemini: null, groq: null }; // { key, valid, error, checkedAt }
        this.inflight = {};
        this.migrated = false;
    }

    _ensureMigrated() {
        if (this.migrated) return;
        this.migrated = true;
        try {
            const legacyPath = path.join(this.getConfigDir(), LEGACY_PLAINTEXT_FILE);
            if (fs.existsSync(legacyPath)) {
                const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
                const hadKeys = legacy.apiKey || legacy.groqApiKey;
                const didMigrate = this.store.migrateFromPlaintext(legacy);
                if (didMigrate) {
                    // Wipe secret material from the plaintext file but keep non-secret fields.
                    const { apiKey, groqApiKey, ...rest } = legacy;
                    fs.writeFileSync(legacyPath, JSON.stringify({ ...rest, _migrated: true }, null, 2), 'utf8');
                    console.log('[Keys] Migrated API keys to secure storage');
                } else if (hadKeys) {
                    console.warn('[Keys] Secure storage unavailable; keys remain in credentials.json');
                }
            }
        } catch (e) {
            console.warn('[Keys] Migration failed:', e.message);
        }
    }

    getSecret(name) {
        this._ensureMigrated();
        return this.store.readAll()[name] || '';
    }

    setSecret(name, value) {
        this._ensureMigrated();
        const all = this.store.readAll();
        const normalized = normalizeKey(value);
        if (normalized) all[name] = normalized;
        else delete all[name];
        const ok = this.store.writeAll(all);
        this.invalidateVerification(name);
        return ok;
    }

    // Convenience accessors mirroring the old storage API -----------------------

    getApiKey() {
        return this.getSecret('gemini');
    }
    setApiKey(key) {
        return this.setSecret('gemini', key);
    }
    getGroqApiKey() {
        return this.getSecret('groq');
    }
    setGroqApiKey(key) {
        return this.setSecret('groq', key);
    }

    invalidateVerification(provider) {
        this.cache[provider] = null;
    }

    getCachedVerification(provider) {
        const entry = this.cache[provider];
        if (!entry) return null;
        const ttl = entry.valid ? VERIFY_TTL_MS : FAILURE_TTL_MS;
        if (Date.now() - entry.checkedAt > ttl) return null;
        return entry;
    }

    /**
     * Verify a key against the provider. Deduplicates concurrent calls and caches
     * results. Returns { valid, status, error }.
     */
    async verify(provider, keyOverride) {
        const key = normalizeKey(keyOverride ?? this.getSecret(provider));
        if (!key) return { valid: false, status: 0, error: `${provider.toUpperCase()} API key is not configured` };

        const shapeError = getShapeError(provider, key);
        if (shapeError) return { valid: false, status: 0, error: shapeError };

        const cached = this.getCachedVerification(provider);
        if (cached && cached.key === key) return { valid: cached.valid, status: cached.status, error: cached.error };

        if (this.inflight[provider]) {
            const entry = await this.inflight[provider];
            return { valid: entry.valid, status: entry.status, error: entry.error };
        }

        const work = this._runVerification(provider, key)
            .then(entry => {
                this.cache[provider] = entry;
                return entry;
            })
            .finally(() => {
                delete this.inflight[provider];
            });
        this.inflight[provider] = work;

        const entry = await work;
        return { valid: entry.valid, status: entry.status, error: entry.error };
    }

    async _runVerification(provider, key) {
        const base = { key, checkedAt: Date.now() };
        const controllers = new AbortController();
        const timer = setTimeout(() => controllers.abort(), 10000);
        try {
            if (provider === 'gemini') {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`, {
                    signal: controllers.signal,
                });
                if (res.ok) return { ...base, valid: true, status: 200, error: null };
                return { ...base, valid: false, status: res.status, error: await this._describeError(res, 'Gemini') };
            }
            if (provider === 'groq') {
                const res = await fetch('https://api.groq.com/openai/v1/models', {
                    headers: { Authorization: `Bearer ${key}` },
                    signal: controllers.signal,
                });
                if (res.ok) return { ...base, valid: true, status: 200, error: null };
                return { ...base, valid: false, status: res.status, error: await this._describeError(res, 'Groq') };
            }
            return { ...base, valid: false, status: 0, error: `Unknown provider ${provider}` };
        } catch (e) {
            const msg = e.name === 'AbortError' ? 'Verification timed out (network unreachable?)' : e.message;
            // Network errors should not poison the cache — check immediately next time.
            return { ...base, checkedAt: 0, valid: false, status: 0, error: msg };
        } finally {
            clearTimeout(timer);
        }
    }

    async _describeError(res, label) {
        let body = '';
        try {
            body = (await res.text()).slice(0, 400);
        } catch {}
        if (res.status === 401 || res.status === 403) return `${label}: invalid or unauthorized API key. Double-check it in Settings.`;
        if (res.status === 429) return `${label}: rate limited. Your key works but you are being throttled — wait a bit or check quota.`;
        return `${label} verification failed (HTTP ${res.status})${body ? `: ${body}` : ''}`;
    }

    /**
     * Classify an error encountered mid-session into an actionable message.
     * Used by providers so users see "your API key is wrong" instead of raw stack traces.
     */
    classifyApiError(provider, status, bodyText) {
        const label = provider === 'gemini' ? 'Gemini' : provider === 'groq' ? 'Groq' : provider;
        if (status === 401 || status === 403) {
            this.cache[provider] = { key: this.getSecret(provider), valid: false, status, error: `${label}: invalid API key`, checkedAt: Date.now() };
            return `${label} rejected your API key (${status}). Open Settings and paste the key again — free keys work at aistudio.google.com/apikey${provider === 'groq' ? ' / console.groq.com/keys' : ''}.`;
        }
        if (status === 429) {
            return `${label} is rate-limiting this key (429). Responses will resume shortly; consider a paid tier or a second key.`;
        }
        if (status === 0) {
            return `${label}: network error — could not reach the API. Check your internet connection or VPN.`;
        }
        const snippet = (bodyText || '').slice(0, 200);
        return `${label} API error (HTTP ${status})${snippet ? `: ${snippet}` : ''}`;
    }
}

/** Return the last 4 characters for safe display/logging. Never log full keys. */
function maskKey(key) {
    const normalized = normalizeKey(key);
    if (!normalized) return '(none)';
    return `••••${normalized.slice(-4)}`;
}

module.exports = {
    ApiKeyManager,
    normalizeKey,
    looksValid,
    getShapeError,
    maskKey,
};
