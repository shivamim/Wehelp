const startupStart = require('node:perf_hooks').performance.now();
if (require('electron-squirrel-startup')) {
    process.exit(0);
}

const { app, BrowserWindow, shell, ipcMain, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const storage = require('./storage');
const { applyScreenSharePrivacy } = require('./utils/screen-share-privacy');
const { ApiKeyManager } = require('./utils/apiKeys');
const { setApiKeyManager, setRuntimeConfigGetter, shutdownSession, generation, setCaptureSuspended } = require('./utils/gemini');
const { monitor } = require('./engine/performance-monitor');
monitor.boot = startupStart;
require('./security/ipc-validation').installIpcValidation(ipcMain);
// Preserve Electron's original user-data directory while rebranding.
app.setPath('userData', require('node:path').join(app.getPath('appData'), 'cheating-daddy'));
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
    }
});
let tray;
let quitting = false;
let shutdownComplete = false;

const geminiSessionRef = { current: null };
let mainWindow = null;

function restoreMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, geminiSessionRef);
    return mainWindow;
}

app.whenReady()
    .then(async () => {
        // Initialize storage (checks version, resets if needed)
        storage.initializeStorage();

        const keys = new ApiKeyManager(storage.getConfigDir);
        storage.setApiKeyManager(keys);
        setApiKeyManager(keys);
        setRuntimeConfigGetter(storage.getConfig);
        // Complete credential migration before providers and renderer are reachable.
        keys.getApiKey();
        keys.getGroqApiKey();
        setupGeminiIpcHandlers(geminiSessionRef);
        setupStorageIpcHandlers();
        setupGeneralIpcHandlers();
        for (const [event, sleeping] of [
            ['suspend', true],
            ['resume', false],
        ]) {
            powerMonitor.on(event, () => {
                setCaptureSuspended(sleeping);
                sendToRenderer('capture-power', sleeping);
            });
        }
        monitor.resources();
        createMainWindow();
        mainWindow.webContents.once('did-finish-load', () => {
            monitor.startupMs = monitor.now() - monitor.boot;
        });
        tray = new Tray(nativeImage.createFromPath(require('node:path').join(__dirname, 'assets/logo.png')).resize({ width: 16, height: 16 }));
        tray.setToolTip('WeHelp — idle');
        tray.setContextMenu(
            Menu.buildFromTemplate([
                {
                    label: 'Show WeHelp',
                    click: restoreMainWindow,
                },
                { label: 'Stop session', click: () => shutdownSession() },
                { label: 'Quit WeHelp', click: () => app.quit() },
            ])
        );
        tray.on('double-click', restoreMainWindow);
        mainWindow.on('minimize', event => {
            if (storage.getConfig().minimizeToTray) {
                event.preventDefault();
                mainWindow.hide();
            }
        });
        mainWindow.on('close', event => {
            if (!quitting && storage.getConfig().minimizeToTray) {
                event.preventDefault();
                mainWindow.hide();
            } else shutdownSession();
        });
        if (process.platform !== 'linux') app.setLoginItemSettings({ openAtLogin: storage.getConfig().launchAtLogin === true });
    })
    .catch(error => {
        console.error('Startup failed:', error.message);
        require('electron').dialog.showErrorBox('WeHelp startup failed', error.message);
        app.quit();
    });

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', event => {
    quitting = true;
    if (shutdownComplete) return;
    event.preventDefault();
    Promise.all([shutdownSession(), storage.flushStorage()])
        .catch(error => console.error('Shutdown error:', error.message))
        .finally(() => {
            monitor.close();
            tray?.destroy();
            shutdownComplete = true;
            app.quit();
        });
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

function setupStorageIpcHandlers() {
    // ============ CONFIG ============
    ipcMain.handle('storage:get-config', async () => {
        try {
            return { success: true, data: storage.getConfig() };
        } catch (error) {
            console.error('Error getting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-config', async (event, config) => {
        const previousPrivacy = storage.getConfig().screenSharePrivacy === true;
        const previousTaskbar = storage.getConfig().hideFromTaskbar === true;
        if (Object.keys(config).some(key => /Model$|Provider$|performanceMode/.test(key))) await shutdownSession();
        try {
            if ('screenSharePrivacy' in config) applyScreenSharePrivacy(mainWindow, config.screenSharePrivacy);
            if ('hideFromTaskbar' in config && process.platform !== 'darwin') mainWindow?.setSkipTaskbar(config.hideFromTaskbar);
            if ((await storage.setConfig(config)) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            if ('screenSharePrivacy' in config) applyScreenSharePrivacy(mainWindow, previousPrivacy);
            if ('hideFromTaskbar' in config && process.platform !== 'darwin') mainWindow?.setSkipTaskbar(previousTaskbar);
            console.error('Error setting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-config', async (event, key, value) => {
        const previousPrivacy = storage.getConfig().screenSharePrivacy === true;
        const previousTaskbar = storage.getConfig().hideFromTaskbar === true;
        if (/Model$|Provider$|performanceMode/.test(key) && storage.getConfig()[key] !== value) await shutdownSession();
        try {
            if (key === 'screenSharePrivacy') applyScreenSharePrivacy(mainWindow, value);
            if (key === 'hideFromTaskbar' && process.platform !== 'darwin') mainWindow?.setSkipTaskbar(value);
            if (key === 'alwaysOnTop') mainWindow?.setAlwaysOnTop(value);
            if (key === 'launchAtLogin') app.setLoginItemSettings({ openAtLogin: value });
            if ((await storage.updateConfig(key, value)) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            if (key === 'screenSharePrivacy') applyScreenSharePrivacy(mainWindow, previousPrivacy);
            if (key === 'hideFromTaskbar' && process.platform !== 'darwin') mainWindow?.setSkipTaskbar(previousTaskbar);
            console.error('Error updating config:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ CREDENTIALS ============
    ipcMain.handle('storage:get-credentials', async () => {
        try {
            return { success: true, data: { configured: true } };
        } catch (error) {
            console.error('Error getting credentials:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-credentials', async (event, credentials) => {
        try {
            if ((await storage.setCredentials(credentials)) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            console.error('Error setting credentials:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-api-key', async () => {
        try {
            return { success: true, data: storage.getApiKey() ? 'configured' : '' };
        } catch (error) {
            console.error('Error getting API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-api-key', async (event, apiKey) => {
        await shutdownSession();
        try {
            generation.registry.invalidate('gemini');
            if ((await storage.setApiKey(apiKey)) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            console.error('Error setting API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-groq-api-key', async () => {
        try {
            return { success: true, data: storage.getGroqApiKey() ? 'configured' : '' };
        } catch (error) {
            console.error('Error getting Groq API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-groq-api-key', async (event, groqApiKey) => {
        await shutdownSession();
        try {
            generation.registry.invalidate('groq');
            if ((await storage.setGroqApiKey(groqApiKey)) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            console.error('Error setting Groq API key:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ PREFERENCES ============
    ipcMain.handle('storage:get-preferences', async () => {
        try {
            return { success: true, data: storage.getPreferences() };
        } catch (error) {
            console.error('Error getting preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-preferences', async (event, preferences) => {
        try {
            if ((await storage.setPreferences(preferences)) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            console.error('Error setting preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-preference', async (event, key, value) => {
        try {
            if ((await storage.updatePreference(key, value)) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            console.error('Error updating preference:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ KEYBINDS ============
    ipcMain.handle('storage:get-keybinds', async () => {
        try {
            return { success: true, data: storage.getKeybinds() };
        } catch (error) {
            console.error('Error getting keybinds:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-keybinds', async (event, keybinds) => {
        try {
            if ((await storage.setKeybinds(keybinds)) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            console.error('Error setting keybinds:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ HISTORY ============
    ipcMain.handle('storage:get-all-sessions', async () => {
        await storage.flushStorage();
        try {
            return { success: true, data: storage.getAllSessions() };
        } catch (error) {
            console.error('Error getting sessions:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-session', async (event, sessionId) => {
        await storage.flushStorage();
        try {
            return { success: true, data: storage.getSession(sessionId) };
        } catch (error) {
            console.error('Error getting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:save-session', async (event, sessionId, data) => {
        try {
            if ((await storage.saveSession(sessionId, data)) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            console.error('Error saving session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-session', async (event, sessionId) => {
        try {
            if ((await storage.deleteSession(sessionId)) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            console.error('Error deleting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-all-sessions', async () => {
        try {
            if ((await storage.deleteAllSessions()) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            console.error('Error deleting all sessions:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ LIMITS ============
    ipcMain.handle('storage:get-today-limits', async () => {
        try {
            return { success: true, data: storage.getTodayLimits() };
        } catch (error) {
            console.error('Error getting today limits:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ CLEAR ALL ============
    ipcMain.handle('storage:clear-all', async () => {
        try {
            if ((await storage.clearAllData()) === false) throw new Error('Could not persist settings; check OS secure storage');
            return { success: true };
        } catch (error) {
            console.error('Error clearing all data:', error);
            return { success: false, error: error.message };
        }
    });
}

function setupGeneralIpcHandlers() {
    ipcMain.handle('capture:state', (_event, state) => {
        if (quitting) return { success: true };
        monitor.gauges.audioCaptureActive = state.active;
        if (tray && !tray.isDestroyed()) tray.setToolTip(state.active ? 'WeHelp — audio capture active' : 'WeHelp — audio idle');
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('capture-state', state);
        return { success: true };
    });
    ipcMain.handle('get-app-version', async () => {
        return app.getVersion();
    });

    ipcMain.handle('quit-application', async event => {
        try {
            stopMacOSAudioCapture();
            app.quit();
            return { success: true };
        } catch (error) {
            console.error('Error quitting application:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-external', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    // Debug logging from renderer
    ipcMain.on('log-message', (event, msg) => {
        console.log(msg);
    });
}
