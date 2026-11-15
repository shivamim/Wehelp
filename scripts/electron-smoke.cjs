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
            const result = await win.webContents.executeJavaScript(`(async () => {
                await customElements.whenDefined('cheating-daddy-app');
                const app = document.querySelector('cheating-daddy-app');
                await app.updateComplete;
                const isolation = { require: typeof require, process: typeof process, bridge: !!window.wehelp, genericInvoke: typeof window.wehelp.invoke };
                const config = await window.wehelp.operations['storage:get-config']();
                if (!config.success) throw new Error('Storage unavailable');
                app.currentView = 'customize'; await app.updateComplete;
                const settings = app.shadowRoot.querySelector('customize-view'); await settings.updateComplete;
                const engine = settings.shadowRoot.querySelector('engine-settings'); await engine.load(); await engine.updateComplete;
                if (!engine.shadowRoot.textContent.includes('Performance')) throw new Error('Missing dashboard');
                const models = await window.wehelp.operations['models:list']();
                if (!models.length) throw new Error('No model registry');
                app.currentView = 'assistant'; await app.updateComplete;
                const view = app.shadowRoot.querySelector('assistant-view'); await view.updateComplete;
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
                return { isolation, modelCount: models.length, metrics: await window.wehelp.operations['performance:snapshot'](), unsafeExecuted: !!window.__unsafe, settings: !!engine, workletChunks: chunks, allTracksStopped };
            })()`);
            if (
                result.isolation.require !== 'undefined' ||
                result.isolation.process !== 'undefined' ||
                result.isolation.genericInvoke !== 'undefined' ||
                !result.isolation.bridge ||
                result.unsafeExecuted
            )
                throw new Error('Isolation or HTML safety failed');
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
