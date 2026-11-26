// Run with Electron and disposable WEHELP_DATA_DIR / XDG_CONFIG_HOME. No API calls.
const { app } = require('electron');
const fs = require('node:fs');
app.disableHardwareAcceleration();
const errors = [];
const timeout = setTimeout(() => {
    console.error('Electron smoke timeout', errors);
    app.exit(1);
}, 20000);
app.on('browser-window-created', (_event, win) => {
    win.webContents.on('console-message', event => {
        if (event.level === 'error' && !event.message.startsWith('Executing inline event handler violates')) errors.push(event.message);
    });
    win.webContents.on('did-finish-load', async () => {
        try {
            const { generation } = require('../src/utils/gemini');
            generation.getKeys = () => ({ groq: 'smoke-fixture' });
            generation.adapters = {
                groq: {
                    async *chat({ messages }) {
                        if (!messages[0].content.includes('Use degrees.')) throw new Error('Pinned session context was missing');
                        yield messages[0].content.includes('Explain thoroughly') ? 'The hour hand moves 0.5° per minute.' : '7.5°. ';
                    },
                },
            };
            generation.start();
            const result = await win.webContents.executeJavaScript(`(async () => {
                await customElements.whenDefined('cheating-daddy-app');
                const app = document.querySelector('cheating-daddy-app');
                await app.updateComplete;
                const isolation = { require: typeof require, process: typeof process, bridge: !!window.wehelp, genericInvoke: typeof window.wehelp.invoke };
                const config = await window.wehelp.operations['storage:get-config']();
                if (!config.success) throw new Error('Storage unavailable');
                app.currentView = 'main'; await app.updateComplete;
                const homeBeforeStart = app.shadowRoot.querySelector('main-view'); await homeBeforeStart.updateComplete;
                if (window.wehelp.platform === 'win32') {
                    await homeBeforeStart._saveGeminiKey('credential-persistence-fixture');
                    if (homeBeforeStart._credentialError || !homeBeforeStart._hasGeminiKey) throw new Error('Windows secure key save failed: ' + homeBeforeStart._credentialError);
                    if (await cheatingDaddy.storage.getApiKey() !== 'configured') throw new Error('Saved key marker missing');
                }
                const originalKeyGetter = cheatingDaddy.storage.getApiKey;
                const originalInitialize = cheatingDaddy.initializeGemini;
                cheatingDaddy.storage.getApiKey = async () => 'configured';
                cheatingDaddy.initializeGemini = async () => { throw new Error('Fixture model is not available'); };
                try { await app.handleStart(); } finally {
                    cheatingDaddy.storage.getApiKey = originalKeyGetter;
                    cheatingDaddy.initializeGemini = originalInitialize;
                }
                if (window.wehelp.platform === 'win32') await cheatingDaddy.storage.setApiKey('');
                await app.updateComplete;
                const home = app.shadowRoot.querySelector('main-view'); await home.updateComplete;
                if (!home.shadowRoot.textContent.includes('Fixture model is not available')) throw new Error('Startup failure is hidden on Home');
                if (home.shadowRoot.querySelector('.start-button').disabled) throw new Error('Start remains disabled after failure');
                app.currentView = 'customize'; await app.updateComplete;
                const settings = app.shadowRoot.querySelector('customize-view'); await settings.updateComplete;
                const engine = settings.shadowRoot.querySelector('engine-settings'); await engine.load(); await engine.updateComplete;
                if (!engine.shadowRoot.textContent.includes('Performance')) throw new Error('Missing dashboard');
                const models = await window.wehelp.operations['models:list']();
                if (!models.length) throw new Error('No model registry');
                for (const [key, value] of [['responseStyle', 'quick'], ['responseProvider', 'groq']]) {
                    const saved = await window.wehelp.operations['storage:update-config'](key, value);
                    if (!saved.success) throw new Error('Quick Answer settings did not save');
                }
                app.quickAnswerEnabled = true;
                app.currentView = 'assistant'; await app.updateComplete;
                const view = app.shadowRoot.querySelector('assistant-view'); await view.updateComplete;
                const form = view.shadowRoot.querySelector('.quick-answer-context form');
                form.querySelector('input').value = 'Use degrees.';
                form.requestSubmit();
                const waitFor = async condition => {
                    for (let i = 0; i < 100; i++) {
                        if (condition()) return;
                        await new Promise(resolve => setTimeout(resolve, 20));
                    }
                    throw new Error('Quick Answer controls did not finish');
                };
                await waitFor(() => app.quickAnswerPin === 'Use degrees.');
                const quick = await window.wehelp.operations['send-text-message']('What is the angle at 3:15?');
                if (!quick.success) throw new Error(quick.error);
                const deepenButton = () => Array.from(view.shadowRoot.querySelectorAll('button')).find(b => b.textContent.trim() === 'Go deeper');
                await waitFor(deepenButton);
                if (app.responses.at(-1).trim() !== '7.5°.') throw new Error('Quick Answer failed to render');
                deepenButton().click();
                await waitFor(() => app.responses.at(-1) === 'The hour hand moves 0.5° per minute.');

                app.addNewResponse('# Answer\\n\\n<img src=x onerror="window.__unsafe=true"><script>window.__unsafe=true</script>');
                await app.updateComplete; await view.updateComplete;
                view._streamRenderer.finalize(app.responses.at(-1));
                const unsafeDOM = !!view.shadowRoot.querySelector('script, [onerror], iframe');
                const { AudioSession } = await import(new URL('audio/audio-session.js', document.baseURI).href);
                const context = new AudioContext({ sampleRate: 24000 });
                const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
                oscillator.connect(destination); oscillator.start(); await context.resume();
                let chunks = 0;
                const capture = new AudioSession({ send: async () => { chunks++; return { success: true }; }, onError: error => { throw error; } });
                await capture.add(destination.stream, 'mic', 40);
                await new Promise(resolve => setTimeout(resolve, 220));
                await capture.stop(); oscillator.stop(); await context.close();
                const allTracksStopped = destination.stream.getTracks().every(track => track.readyState === 'ended');
                if (!chunks || !allTracksStopped || unsafeDOM) throw new Error('Worklet capture/cleanup or sanitized DOM failed');
                app.currentView = 'main'; await app.updateComplete;
                await window.wehelp.operations['close-session']();
                return { isolation, modelCount: models.length, metrics: await window.wehelp.operations['performance:snapshot'](), unsafeExecuted: !!window.__unsafe, settings: !!engine, startupFailureVisible: true, quickAnswer: true, workletChunks: chunks, allTracksStopped };
            })()`);
            if (
                result.isolation.require !== 'undefined' ||
                result.isolation.process !== 'undefined' ||
                result.isolation.genericInvoke !== 'undefined' ||
                !result.isolation.bridge ||
                result.unsafeExecuted
            )
                throw new Error('Isolation or HTML safety failed');
            if (process.platform === 'win32') {
                const enabled = await win.webContents.executeJavaScript(
                    "window.wehelp.operations['storage:update-config']('screenSharePrivacy', true)"
                );
                if (!enabled.success || !win.isContentProtected()) throw new Error('Native screen-sharing privacy did not enable');
                const saved = await win.webContents.executeJavaScript("window.wehelp.operations['storage:get-config']()");
                if (!saved.data.screenSharePrivacy) throw new Error('Screen-sharing privacy setting was not saved');
                const disabled = await win.webContents.executeJavaScript(
                    "window.wehelp.operations['storage:update-config']('screenSharePrivacy', false)"
                );
                if (!disabled.success || win.isContentProtected()) throw new Error('Native screen-sharing privacy did not disable');
                result.nativeCapturePrivacyToggle = true;
            }
            if (errors.length) throw new Error('Renderer errors: ' + errors.join('; '));
            console.log('ELECTRON_SMOKE_PASS', JSON.stringify(result));
            if (process.env.WEHELP_SMOKE_SCREENSHOT)
                fs.writeFileSync(process.env.WEHELP_SMOKE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
            clearTimeout(timeout);
            app.quit();
        } catch (error) {
            console.error('ELECTRON_SMOKE_FAIL', error, errors);
            clearTimeout(timeout);
            app.exit(1);
        }
    });
});
require('../src/index.js');
