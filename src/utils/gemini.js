const { GoogleGenAI, Modality } = require('@google/genai');
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');
const { getApiKey, setApiKey, getGroqApiKey } = require('../storage');
const { connectCloud, sendCloudAudio, sendCloudText, sendCloudImage, closeCloud, isCloudActive, setOnTurnComplete } = require('./cloud');
const { startTransportLog, logTransportEvent, closeTransportLog } = require('./transportLogger');
const { GenerationService } = require('../engine/generation-service');
const { monitor } = require('../engine/performance-monitor');
const { TranscriptionTurns } = require('../engine/transcription');
const { Endpoint } = require('../audio/endpoint');
const { pcm24to16, wav } = require('../audio/pcm');
const turns = new TranscriptionTurns();
let liveEpoch = 0;
let resumptionHandle;
let reconnectTimer;
let resolveReconnectWait;
let asrControllers = new Set();
const { normalizeKey, maskKey } = require('./apiKeys');

// Lazy-loaded to avoid circular dependency (localai.js imports from gemini.js)
let _localai = null;
function getLocalAi() {
    if (!_localai) _localai = require('./localai');
    return _localai;
}

// Injected at startup by index.js — provides cached key verification & error classification.
let apiKeyManager = null;
function setApiKeyManager(manager) {
    apiKeyManager = manager;
}

function verifyKeysBeforeSession(provider, key) {
    if (!apiKeyManager) return { valid: true };
    return apiKeyManager.verify(provider, key);
}

function reportApiError(provider, status, bodyText) {
    const message = apiKeyManager ? apiKeyManager.classifyApiError(provider, status, bodyText) : `${provider} API error (HTTP ${status})`;
    sendToRenderer('update-status', message);
    sendToRenderer('api-key-problem', { provider, status, message });
    return message;
}

// Provider mode: 'byok', 'cloud', or 'local'
let currentProviderMode = 'byok';

// Groq conversation history for context
let groqConversationHistory = [];

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
let conversationHistory = [];
let screenAnalysisHistory = [];
let currentProfile = null;
let currentCustomPrompt = null;
let isInitializingSession = false;
let sessionStartPending = false;
let currentSystemPrompt = null;

function formatSpeakerResults(results) {
    let text = '';
    for (const result of results) {
        if (result.transcript && result.speakerId) {
            const speakerLabel = result.speakerId === 1 ? 'Interviewer' : 'Candidate';
            text += `[${speakerLabel}]: ${result.transcript}\n`;
        }
    }
    return text;
}

module.exports.formatSpeakerResults = formatSpeakerResults;

// Audio capture variables
let systemAudioProc = null;
let messageBuffer = '';
let groqRequestStartedForTurn = false;

// Runtime configuration is injected before any session starts.
let _runtimeConfigGetter = null;
function setRuntimeConfigGetter(getter) {
    _runtimeConfigGetter = typeof getter === 'function' ? getter : null;
}

function getRuntimeConfig() {
    if (_runtimeConfigGetter) {
        try {
            return _runtimeConfigGetter() || {};
        } catch {
            return {};
        }
    }
    return {};
}

/**
 * Configurable per-request output budget. Defaults to 1024 tokens — a ceiling,
 * not a quota: models stop as soon as the answer is done. `override` lets a
 * retry pass use a larger budget after a truncation.
 */
// Reconnection variables
let isUserClosing = false;
let sessionParams = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000;

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// Build context message for session restoration
function buildContextMessage() {
    const lastTurns = conversationHistory.slice(-20);
    const validTurns = lastTurns.filter(turn => turn.transcription?.trim() && turn.ai_response?.trim());

    if (validTurns.length === 0) return null;

    const contextLines = validTurns.map(turn => `[Interviewer]: ${turn.transcription.trim()}\n[Your answer]: ${turn.ai_response.trim()}`);

    return `Session reconnected. Here's the conversation so far:\n\n${contextLines.join('\n\n')}\n\nContinue from here.`;
}

// ── GoogleGenAI client cache ─────────────────────────────────────────────────
// Constructing a client per request is cheap-ish but wasteful; reuse one per
// API key (bounded to avoid leaks when keys rotate).
const genaiClients = new Map();

function getGenaiClient(apiKey, options = {}) {
    const cacheKey = `${apiKey}|${options.vertexai ? 'v' : 'g'}|${options.httpOptions?.apiVersion || ''}`;
    let client = genaiClients.get(cacheKey);
    if (!client) {
        client = new GoogleGenAI({ apiKey, ...options });
        if (genaiClients.size > 8) genaiClients.clear();
        genaiClients.set(cacheKey, client);
    }
    return client;
}

// Conversation management functions
function initializeNewSession(profile = null, customPrompt = null) {
    currentSessionId = Date.now().toString();
    startTransportLog(currentSessionId);
    currentTranscription = '';
    groqRequestStartedForTurn = false;
    generation.start(currentProviderMode);
    turns.reset();
    conversationHistory = [];
    screenAnalysisHistory = [];
    groqConversationHistory = [];
    currentProfile = profile;
    currentCustomPrompt = customPrompt;
    require('../storage')
        .saveSession(currentSessionId, { profile, customPrompt })
        .catch(error => sendToRenderer('update-status', 'History initialization failed: ' + error.message));
    console.log('New conversation session started:', currentSessionId, 'profile:', profile);

    // Save initial session with profile context
    if (profile) {
        sendToRenderer('save-session-context', {
            sessionId: currentSessionId,
            profile: profile,
            customPrompt: customPrompt || '',
        });
    }
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    if (conversationHistory.length > 200) conversationHistory.shift();
    require('../storage')
        .appendSessionTurn(currentSessionId, conversationTurn)
        .catch(error => sendToRenderer('update-status', 'History save failed: ' + error.message));

    // Send to renderer to save in IndexedDB
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function saveScreenAnalysis(prompt, response, model) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const analysisEntry = {
        timestamp: Date.now(),
        prompt: prompt,
        response: response.trim(),
        model: model,
    };

    screenAnalysisHistory.push(analysisEntry);
    if (screenAnalysisHistory.length > 100) screenAnalysisHistory.shift();

    // Send to renderer to save
    sendToRenderer('save-screen-analysis', {
        sessionId: currentSessionId,
        analysis: analysisEntry,
        fullHistory: screenAnalysisHistory,
        profile: currentProfile,
        customPrompt: currentCustomPrompt,
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

async function getEnabledTools() {
    const tools = [];

    // Check if Google Search is enabled (default: true)
    const googleSearchEnabled = String(require('../storage').getPreferences().googleSearchEnabled);

    if (googleSearchEnabled === 'true') {
        tools.push({ googleSearch: {} });
    }

    return tools;
}

// ── Renderer localStorage settings with cache ────────────────────────────────
// executeJavaScript round-trips are expensive; never do them in a hot path.
const storedSettingCache = new Map();

async function getStoredSetting(key, defaultValue) {
    if (storedSettingCache.has(key)) {
        return storedSettingCache.get(key);
    }
    try {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            const value = await windows[0].webContents.executeJavaScript(`
                (function() {
                    try {
                        if (typeof localStorage === 'undefined') return null;
                        return localStorage.getItem('${key}');
                    } catch (e) {
                        return null;
                    }
                })()
            `);
            const resolved = value == null ? defaultValue : value;
            storedSettingCache.set(key, resolved);
            return resolved;
        }
    } catch (error) {
        console.error('Error getting stored setting for', key, ':', error.message);
    }
    return defaultValue;
}

// helper to check if groq has been configured
function hasGroqKey() {
    const key = getGroqApiKey();
    return key && key.trim() != '';
}

const generation = new GenerationService({
    getConfig: () => ({ ...getRuntimeConfig(), systemPrompt: currentSystemPrompt }),
    getKeys: () => ({ gemini: getApiKey(), groq: getGroqApiKey() }),
    emit: sendToRenderer,
    save: saveConversationTurn,
});
function usesExternalAnswers() {
    const config = getRuntimeConfig();
    return config.performanceMode !== 'live-voice' && (hasGroqKey() || config.responseProvider === 'gemini');
}
async function sendToGroq(transcription) {
    return generation.generate(transcription);
}
async function sendImageToGroq(data, prompt) {
    return generation.generate(prompt, { image: data });
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnect = false) {
    const epoch = liveEpoch;
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    // Normalize the key once at the boundary — silently fixes trailing spaces /
    // quotes pasted from docs, which is a top cause of "invalid API key" errors.
    const normalizedKey = normalizeKey(apiKey);
    if (!normalizedKey) {
        sendToRenderer('update-status', 'No Gemini API key configured. Add it in Settings.');
        sendToRenderer('api-key-problem', { provider: 'gemini', status: 0, message: 'No Gemini API key configured' });
        return null;
    }
    if (!isReconnect && normalizedKey !== apiKey) {
        setApiKey(normalizedKey); // persist the cleaned version
    }

    // Fail fast with an actionable message instead of a cryptic socket error.
    if (!isReconnect && apiKeyManager) {
        const shapeError = require('./apiKeys').getShapeError('gemini', normalizedKey);
        if (shapeError) {
            sendToRenderer('update-status', shapeError);
            sendToRenderer('api-key-problem', { provider: 'gemini', status: 0, message: shapeError });
            return null;
        }
        // Authentication is checked by the Live handshake; no extra models
        // round trip is required on the critical startup path.
        sendToRenderer('update-status', 'Connecting to Gemini Live…');
    }

    if (epoch !== liveEpoch) return null;
    isInitializingSession = true;
    if (!isReconnect) {
        sendToRenderer('session-initializing', true);
    }

    // Store params for reconnection
    if (!isReconnect) {
        sessionParams = { apiKey: normalizedKey, customPrompt, profile, language };
        reconnectAttempts = 0;
    }

    const config = getRuntimeConfig();
    const transcriptionOnly = usesExternalAnswers();
    const liveModel = transcriptionOnly ? config.transcriptionModel : config.geminiLiveModel;
    try {
        generation.registry.get('gemini', liveModel, transcriptionOnly ? 'transcription-live' : 'live');
    } catch (error) {
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', error.message);
        return null;
    }
    const client = getGenaiClient(normalizedKey, { httpOptions: { apiVersion: 'v1beta' } });

    // Get enabled tools first to determine Google Search status
    const enabledTools = await getEnabledTools();
    const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);

    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);
    currentSystemPrompt = systemPrompt; // Store for Groq

    // Initialize new conversation session only on first connect
    if (!isReconnect) {
        initializeNewSession(profile, customPrompt);
    }

    try {
        const connecting = client.live.connect({
            model: liveModel,
            callbacks: {
                onopen: function () {
                    if (epoch !== liveEpoch) return;
                    logTransportEvent('gemini.live.opened', {});
                    sendToRenderer('update-status', 'Live session connected');
                },
                onmessage: function (message) {
                    logTransportEvent('gemini.live.message', message);

                    if (epoch !== liveEpoch) return;
                    if (message.sessionResumptionUpdate?.resumable) resumptionHandle = message.sessionResumptionUpdate.newHandle;
                    const content = message.serverContent || {};
                    const transcription = turns.accept(content);
                    if (transcription) {
                        currentTranscription = transcription;
                        monitor.gauges.finalTranscriptionAt = monitor.now();
                        if (transcriptionOnly)
                            generation
                                .generate(transcription, { speechEnd: monitor.gauges.speechEnd })
                                .catch(error => sendToRenderer('update-status', error.message));
                    }
                    if (!transcriptionOnly) {
                        for (const part of content.modelTurn?.parts || [])
                            if (part.inlineData?.mimeType?.startsWith('audio/pcm') && part.inlineData.data) {
                                const pcm = Buffer.from(part.inlineData.data, 'base64');
                                sendToRenderer('voice-audio', pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
                            }
                    }
                    if (!transcriptionOnly && content.outputTranscription?.text) {
                        const first = messageBuffer === '';
                        messageBuffer += content.outputTranscription.text;
                        sendToRenderer(first ? 'new-response' : 'update-response', messageBuffer);
                    }
                    if (content.interrupted) {
                        messageBuffer = '';
                        generation.requests.cancel();
                        sendToRenderer('voice-interrupted');
                    }
                    if (content.turnComplete) {
                        if (!transcriptionOnly && currentTranscription.trim() && messageBuffer.trim())
                            saveConversationTurn(currentTranscription, messageBuffer);
                        currentTranscription = '';
                        messageBuffer = '';
                        groqRequestStartedForTurn = false;
                        if (!generation.requests.active) sendToRenderer('update-status', 'Listening...');
                    }
                },
                onerror: function (e) {
                    if (epoch !== liveEpoch) return;
                    console.log('Session error:', String(e.message || '').replaceAll(normalizedKey, '[redacted]'));
                    logTransportEvent('gemini.live.error', {
                        error: e.message,
                    });
                    sendToRenderer('update-status', 'Error: ' + String(e.message || '').replaceAll(normalizedKey, '[redacted]'));
                },
                onclose: function (e) {
                    if (epoch !== liveEpoch) return;
                    console.log('Session closed:', e.reason);
                    logTransportEvent('gemini.live.closed', {
                        reason: e.reason,
                    });

                    // Don't reconnect if user intentionally closed
                    if (isUserClosing) {
                        isUserClosing = false;
                        closeTransportLog();
                        sendToRenderer('update-status', 'Session closed');
                        return;
                    }

                    // Attempt reconnection
                    if (sessionParams && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        attemptReconnect();
                    } else {
                        closeTransportLog();
                        sendToRenderer('update-status', 'Session closed');
                    }
                },
            },
            config: transcriptionOnly
                ? {
                      responseModalities: [Modality.TEXT],
                      inputAudioTranscription: { languageCodes: language ? [language] : [] },
                      realtimeInputConfig: {
                          automaticActivityDetection: { disabled: false, prefixPaddingMs: 200, silenceDurationMs: config.endpointSilenceMs || 700 },
                      },
                  }
                : {
                      responseModalities: [Modality.AUDIO],
                      inputAudioTranscription: {},
                      outputAudioTranscription: {},
                      realtimeInputConfig: {
                          automaticActivityDetection: { disabled: false, prefixPaddingMs: 200, silenceDurationMs: config.endpointSilenceMs || 700 },
                      },
                      sessionResumption: resumptionHandle ? { handle: resumptionHandle } : {},
                      contextWindowCompression: { slidingWindow: {} },
                      tools: enabledTools,
                      systemInstruction: { parts: [{ text: systemPrompt }] },
                  },
        });

        // The SDK does not expose a pending WebSocket to cancel. Bound the
        // application wait and close any connection that resolves after Stop.
        let connectTimer;
        connecting.then(
            session => {
                if (epoch !== liveEpoch) session.close();
            },
            () => {}
        );
        let session;
        try {
            session = await Promise.race([
                connecting,
                new Promise((_, reject) => {
                    connectTimer = setTimeout(() => {
                        if (epoch === liveEpoch) liveEpoch++;
                        reject(new Error('Gemini Live connection timed out'));
                    }, 10000);
                }),
            ]);
        } finally {
            clearTimeout(connectTimer);
        }
        if (epoch !== liveEpoch) {
            session.close();
            isInitializingSession = false;
            return null;
        }
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return session;
    } catch (error) {
        console.error('Failed to initialize Gemini session:', String(error.message || '').replaceAll(normalizedKey, '[redacted]'));
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return null;
    }
}

async function attemptReconnect() {
    reconnectAttempts++;
    console.log(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

    // Clear stale buffers
    messageBuffer = '';
    currentTranscription = '';
    // Don't reset groqConversationHistory to preserve context across reconnects

    sendToRenderer('update-status', `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    // Wait before attempting
    monitor.gauges.reconnections++;
    const epoch = liveEpoch;
    await new Promise(resolve => {
        resolveReconnectWait = resolve;
        reconnectTimer = setTimeout(resolve, RECONNECT_DELAY * 2 ** Math.max(0, reconnectAttempts - 1) + Math.random() * 200);
    });
    if (epoch !== liveEpoch || !sessionParams) return;

    try {
        const session = await initializeGeminiSession(
            sessionParams.apiKey,
            sessionParams.customPrompt,
            sessionParams.profile,
            sessionParams.language,
            true // isReconnect
        );

        if (session && global.geminiSessionRef) {
            global.geminiSessionRef.current = session;

            // Restore context from conversation history via text message
            const contextMessage = !resumptionHandle && !usesExternalAnswers() ? buildContextMessage() : null;
            if (contextMessage) {
                try {
                    console.log('Restoring conversation context...');
                    await session.sendRealtimeInput({ text: contextMessage });
                } catch (contextError) {
                    console.error('Failed to restore context:', contextError);
                    // Continue without context - better than failing
                }
            }

            // Don't reset reconnectAttempts here - let it reset on next fresh session
            sendToRenderer('update-status', 'Reconnected! Listening...');
            console.log('Session reconnected successfully');
            return true;
        }
    } catch (error) {
        console.error(`Reconnection attempt ${reconnectAttempts} failed:`, error);
    }

    // If we still have attempts left, try again
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        return attemptReconnect();
    }

    // Max attempts reached - notify frontend
    console.log('Max reconnection attempts reached');
    sendToRenderer('reconnect-failed', {
        message: 'Tried 3 times to reconnect. Must be upstream/network issues. Try restarting or download updated app from site.',
    });
    sessionParams = null;
    return false;
}

function killExistingSystemAudioDump() {
    stopMacOSAudioCapture();
    return Promise.resolve();
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;

    // Kill any existing SystemAudioDump processes first
    await killExistingSystemAudioDump();

    console.log('Starting macOS audio capture with SystemAudioDump...');

    const { app } = require('electron');
    const path = require('path');

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
    } else {
        systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
    }

    console.log('SystemAudioDump path:', systemAudioPath);

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
        },
    };

    systemAudioProc = spawn(systemAudioPath, [], spawnOptions);

    if (!systemAudioProc.pid) {
        console.error('Failed to start SystemAudioDump');
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);

    const CHUNK_DURATION = 0.1;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;

            if (currentProviderMode === 'cloud') {
                sendCloudAudio(monoChunk);
            } else if (currentProviderMode === 'local') {
                getLocalAi().processLocalAudio(monoChunk);
            } else {
                routeAudio(monoChunk).catch(error => sendToRenderer('update-status', error.message));
            }

            if (process.env.DEBUG_AUDIO) {
                console.log(`Processed audio chunk: ${chunk.length} bytes`);
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        console.error('SystemAudioDump process error:', err);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

async function sendAudioToGemini(base64Data, geminiSessionRef) {
    if (!geminiSessionRef.current) return;

    try {
        process.stdout.write('.');
        await geminiSessionRef.current.sendRealtimeInput({
            audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            },
        });
    } catch (error) {
        console.error('Error sending audio to Gemini:', error);
    }
}

async function sendImageToGeminiHttp(data, prompt) {
    return generation.generate(prompt, { image: data });
}

async function shutdownSession() {
    liveEpoch++;
    clearTimeout(reconnectTimer);
    resolveReconnectWait?.();
    resolveReconnectWait = null;
    isUserClosing = true;
    sessionParams = null;
    resumptionHandle = undefined;
    generation.stop();
    turns.reset();
    for (const controller of asrControllers) controller.abort();
    asrControllers.clear();
    for (const endpoint of endpoints.values()) endpoint.reset();
    endpoints.clear();
    stopMacOSAudioCapture();
    closeCloud();
    if (_localai) _localai.closeLocalSession();
    const active = global.geminiSessionRef?.current;
    if (global.geminiSessionRef) global.geminiSessionRef.current = null;
    if (active) await active.close();
    currentProviderMode = 'byok';
    sendToRenderer('capture-stopped');
}
const endpoints = new Map();
async function routeAudio(pcm, source = 'system') {
    if (!generation.requests.sessionId) return { success: false, error: 'No active session' };
    if (currentProviderMode === 'local') {
        getLocalAi().processLocalAudio(pcm, source);
        return { success: true };
    }
    if (currentProviderMode === 'cloud') {
        sendCloudAudio(pcm);
        return { success: true };
    }
    const config = getRuntimeConfig();
    if (config.transcriptionProvider === 'groq' && config.performanceMode !== 'live-voice') {
        let endpoint = endpoints.get(source);
        if (!endpoint) {
            endpoint = new Endpoint({
                silenceMs: config.endpointSilenceMs || 700,
                onStart: () => {
                    monitor.gauges.speechStart = monitor.now();
                },
                onEnd: async pcm => {
                    for (const previous of asrControllers) previous.abort();
                    asrControllers.clear();
                    const controller = new AbortController();
                    asrControllers.add(controller);
                    const sessionId = generation.requests.sessionId;
                    const speechEnd = monitor.now();
                    try {
                        const model = generation.registry.get('groq', config.transcriptionModel, 'transcription');
                        const text = await require('../providers/groq').transcribe({
                            key: getGroqApiKey(),
                            model,
                            wav: wav(pcm),
                            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
                            language: require('../storage').getPreferences().selectedLanguage,
                        });
                        if (sessionId === generation.requests.sessionId && !controller.signal.aborted && text)
                            await generation.generate(text, { speechEnd });
                    } catch (error) {
                        if (!controller.signal.aborted) sendToRenderer('update-status', 'Transcription error: ' + error.message);
                    } finally {
                        asrControllers.delete(controller);
                    }
                },
            });
            endpoints.set(source, endpoint);
        }
        endpoint.push(pcm);
        return { success: true };
    }
    const session = global.geminiSessionRef?.current;
    if (!session) return { success: false, error: 'No active Gemini connection' };
    session.sendRealtimeInput({ audio: { data: pcm24to16(pcm).toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
    return { success: true };
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    // Store the geminiSessionRef globally for reconnection access
    global.geminiSessionRef = geminiSessionRef;

    ipcMain.handle('initialize-cloud', async (event, token, profile, userContext) => {
        try {
            currentProviderMode = 'cloud';
            initializeNewSession(profile);
            setOnTurnComplete((transcription, response) => {
                saveConversationTurn(transcription, response);
            });
            sendToRenderer('session-initializing', true);
            await connectCloud(token, profile, userContext);
            sendToRenderer('session-initializing', false);
            return true;
        } catch (err) {
            console.error('[Cloud] Init error:', err);
            currentProviderMode = 'byok';
            sendToRenderer('session-initializing', false);
            return false;
        }
    });

    ipcMain.handle('initialize-gemini', async (event, _key, customPrompt, profile = 'interview', language = 'en-US') => {
        if (isInitializingSession || sessionStartPending) return false;
        sessionStartPending = true;
        try {
            await shutdownSession();
            isUserClosing = false;
            currentProviderMode = 'byok';
            const config = getRuntimeConfig();
            currentSystemPrompt = getSystemPrompt(profile, customPrompt, false);
            if (config.performanceMode === 'offline' || config.responseProvider === 'local') throw new Error('Select Local AI to use Offline mode');
            if (require('../storage').getPreferences().audioMode === 'text_only') {
                initializeNewSession(profile, customPrompt);
                return true;
            }
            if (config.transcriptionProvider === 'groq' && config.performanceMode !== 'live-voice') {
                if (!getGroqApiKey()) throw new Error('Groq transcription requires a Groq key');
                initializeNewSession(profile, customPrompt);
                return true;
            }
            const session = await initializeGeminiSession(getApiKey(), customPrompt, profile, language);
            if (!session) return false;
            geminiSessionRef.current = session;
            return true;
        } finally {
            sessionStartPending = false;
        }
    });
    ipcMain.handle('audio:chunk', async (_event, { pcm, source }) => {
        const start = monitor.now();
        try {
            return await routeAudio(Buffer.from(pcm), source);
        } finally {
            monitor.gauges.audioProcessingMs = monitor.now() - start;
        }
    });
    ipcMain.handle('pause-audio', () => {
        global.geminiSessionRef?.current?.sendRealtimeInput({ audioStreamEnd: true });
        return { success: true };
    });
    ipcMain.handle('cancel-request', async () => {
        if (global.geminiSessionRef?.current && !usesExternalAnswers()) {
            await shutdownSession();
            return { success: true };
        }
        generation.requests.cancel();
        sendToRenderer('voice-interrupted');
        if (_localai) _localai.cancelGeneration();
        return { success: true };
    });
    ipcMain.handle('performance:snapshot', () => monitor.snapshot());
    ipcMain.handle('performance:export', (_event, format) => monitor.export(format));
    ipcMain.handle('performance:rendered', (_event, id) => {
        monitor.mark(id, 'firstRendered');
    });
    ipcMain.handle('performance:audio', (_event, values) => {
        for (const key of ['audioBacklog', 'audioTransportMs', 'audioCaptureInitMs'])
            if (Number.isFinite(values?.[key]) && values[key] >= 0 && values[key] < 60000) monitor.gauges[key] = values[key];
    });
    ipcMain.handle('local:hardware', () => {
        const os = require('node:os');
        return {
            memoryGiB: Math.round(os.totalmem() / 1073741824),
            logicalCpus: os.availableParallelism(),
            runtimeSupported: ['win32', 'darwin'].includes(process.platform),
            acceleration:
                process.platform === 'darwin'
                    ? 'Metal when supported by the verified binary; CPU fallback'
                    : 'CPU (GPU runtime requires separate validation)',
        };
    });
    ipcMain.handle('models:list', () => generation.registry.list());
    ipcMain.handle('models:refresh', async () => {
        if (getRuntimeConfig().performanceMode === 'offline' || currentProviderMode === 'local')
            return { models: generation.registry.list(), errors: ['Offline mode: no cloud discovery'] };
        const keys = { gemini: getApiKey(), groq: getGroqApiKey() };
        const results = await Promise.allSettled(
            Object.entries(keys)
                .filter(([, key]) => key)
                .map(([provider, key]) => generation.registry.discover(provider, key))
        );
        return { models: generation.registry.list(), errors: results.filter(r => r.status === 'rejected').map(r => r.reason.message) };
    });

    // ── API key health: verification + status (used by Settings UI) ──
    ipcMain.handle('verify-api-key', async (event, provider, keyOverride) => {
        if (getRuntimeConfig().performanceMode === 'offline' || currentProviderMode === 'local')
            return { success: false, error: 'Offline mode does not verify cloud keys' };
        if (!apiKeyManager) return { success: false, error: 'Key manager unavailable' };
        try {
            const result = await apiKeyManager.verify(provider, typeof keyOverride === 'string' ? keyOverride : undefined);
            return { success: true, ...result };
        } catch (error) {
            return { success: false, valid: false, error: error.message };
        }
    });

    ipcMain.handle('get-api-key-status', async () => {
        if (!apiKeyManager) return { success: true, data: {} };
        const status = {};
        for (const provider of ['gemini', 'groq']) {
            const key = provider === 'gemini' ? apiKeyManager.getApiKey() : apiKeyManager.getGroqApiKey();
            const cached = apiKeyManager.getCachedVerification(provider);
            status[provider] = {
                configured: !!key,
                masked: maskKey(key),
                verified: cached ? cached.valid : null,
                lastCheckedAt: cached ? cached.checkedAt : null,
                error: cached && !cached.valid ? cached.error : null,
            };
        }
        return { success: true, data: status };
    });

    ipcMain.handle('initialize-local', async (event, localLlmModel, whisperModel, profile, customPrompt) => {
        await shutdownSession();
        const { dialog } = require('electron');
        const consent = await dialog.showMessageBox({
            type: 'question',
            buttons: ['Start Local AI', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            message: 'Start Local AI and download missing models?',
            detail: 'Missing verified runtimes and model files may require several GB. Inference stays on this machine. Cancel to avoid downloads.',
        });
        if (consent.response !== 0) return false;
        currentProviderMode = 'local';
        const success = await getLocalAi().initializeLocalSession(localLlmModel, whisperModel, profile, customPrompt);
        if (!success) {
            currentProviderMode = 'byok';
        }
        return success;
    });

    ipcMain.handle('cancel-local-initialization', async () => {
        const cancelled = await getLocalAi().cancelLocalInitialization();
        if (cancelled) {
            currentProviderMode = 'byok';
        }
        return cancelled;
    });

    ipcMain.handle('send-audio-content', async (_event, { data }) => routeAudio(Buffer.from(data, 'base64'), 'system'));
    ipcMain.handle('send-mic-audio-content', async (_event, { data }) => routeAudio(Buffer.from(data, 'base64'), 'mic'));

    ipcMain.handle('send-image-content', async (event, { data, prompt }) => {
        try {
            if (!data || typeof data !== 'string') {
                console.error('Invalid image data received');
                return { success: false, error: 'Invalid image data' };
            }

            const buffer = Buffer.from(data, 'base64');

            if (buffer.length < 1000) {
                console.error(`Image buffer too small: ${buffer.length} bytes`);
                return { success: false, error: 'Image buffer too small' };
            }

            process.stdout.write('!');

            if (currentProviderMode === 'cloud') {
                const sent = sendCloudImage(data);
                if (!sent) {
                    return { success: false, error: 'Cloud connection not active' };
                }
                return { success: true, model: 'cloud' };
            }

            if (currentProviderMode === 'local') {
                const result = await getLocalAi().sendLocalImage(data, prompt);
                return result;
            }

            const result = await generation.generate(prompt, { image: data });
            return result;
        } catch (error) {
            console.error('Error sending image:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return { success: false, error: 'Invalid text message' };
        }

        if (currentProviderMode === 'cloud') {
            try {
                sendCloudText(text.trim());
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud text:', error);
                return { success: false, error: error.message };
            }
        }

        if (currentProviderMode === 'local') {
            try {
                return await getLocalAi().sendLocalText(text.trim());
            } catch (error) {
                console.error('Error sending local text:', error);
                return { success: false, error: error.message };
            }
        }

        try {
            return await generation.generate(text.trim());
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-macos-audio', async event => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }

        try {
            const success = await startMacOSAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio', async event => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-session', async () => {
        await shutdownSession();
        closeTransportLog();
        return { success: true };
    });

    // Conversation history IPC handlers
    ipcMain.handle('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-google-search-setting', async (event, enabled) => {
        storedSettingCache.set('googleSearchEnabled', String(Boolean(enabled)));
        await require('../storage').updatePreference('googleSearchEnabled', Boolean(enabled));
        try {
            console.log('Google Search setting updated to:', enabled);
            // The setting is already saved in localStorage by the renderer
            // This is just for logging/confirmation
            return { success: true };
        } catch (error) {
            console.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    initializeGeminiSession,
    setApiKeyManager,
    setRuntimeConfigGetter,
    shutdownSession,
    generation,
    getEnabledTools,
    getStoredSetting,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToGemini,
    sendImageToGeminiHttp,
    setupGeminiIpcHandlers,
    formatSpeakerResults,
};
