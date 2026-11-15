import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { ipcRenderer } from '../../utils/bridge.js';

export class EngineSettings extends LitElement {
    static properties = {
        config: { state: true },
        models: { state: true },
        metrics: { state: true },
        error: { state: true },
        devices: { state: true },
        hardware: { state: true },
    };
    static styles = css`
        :host {
            display: block;
            margin: 12px 0;
            color: var(--text-primary);
            font: inherit;
        }
        details {
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px;
            margin: 10px 0;
        }
        summary {
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
        }
        label {
            display: grid;
            gap: 6px;
            margin: 12px 0;
            font-size: 12px;
        }
        select,
        button {
            color: var(--text-primary);
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 5px;
            padding: 7px;
            font: inherit;
        }
        button {
            cursor: pointer;
            margin: 4px;
        }
        p {
            font-size: 12px;
            color: var(--text-secondary);
            line-height: 1.5;
        }
        dl {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            font-size: 12px;
        }
        dd {
            margin: 0;
            text-align: right;
        }
        .error {
            color: var(--danger);
        }
    `;
    constructor() {
        super();
        this.config = {};
        this.models = [];
        this.metrics = {};
        this.error = '';
        this.devices = [];
        this.hardware = null;
    }
    connectedCallback() {
        super.connectedCallback();
        this.load();
    }
    async load() {
        try {
            const [result, models] = await Promise.all([ipcRenderer.invoke('storage:get-config'), ipcRenderer.invoke('models:list')]);
            this.config = result.data || {};
            this.models = models;
            this.hardware = await ipcRenderer.invoke('local:hardware');
            await this.refreshMetrics();
        } catch (error) {
            this.error = error.message;
        }
    }
    async save(key, value) {
        try {
            const result = await ipcRenderer.invoke('storage:update-config', key, value);
            if (!result.success) throw new Error(result.error);
            this.config = { ...this.config, [key]: value };
            this.error = '';
            if (key === 'transcriptionProvider')
                await this.save('transcriptionModel', value === 'groq' ? 'whisper-large-v3-turbo' : 'gemini-3.5-transcribe-live');
            if (key === 'performanceMode' || key === 'responseProvider') {
                const local = this.config.performanceMode === 'offline' || this.config.responseProvider === 'local';
                await ipcRenderer.invoke('storage:update-preference', 'providerMode', local ? 'local' : 'byok');
                this.dispatchEvent(new CustomEvent('engine-mode-changed', { detail: local ? 'local' : 'byok', bubbles: true, composed: true }));
            }
        } catch (error) {
            this.error = error.message;
        }
    }
    select(label, key, options) {
        return html`<label
            >${label}<select
                .value=${String(this.config[key] ?? '')}
                @change=${event => this.save(key, typeof options[0]?.[0] === 'number' ? Number(event.target.value) : event.target.value)}
            >
                ${options.map(([value, name]) => html`<option value=${value}>${name}</option>`)}
            </select></label
        >`;
    }
    model(label, key, provider, operation, automatic = true) {
        const models = this.models.filter(m => m.provider === provider && m.operations.includes(operation));
        return html`<label
            >${label}<select .value=${this.config[key] || 'auto'} @change=${event => this.save(key, event.target.value)}>
                ${automatic ? html`<option value="auto">Automatic</option>` : ''}
                ${models.map(m => html`<option value=${m.id} ?disabled=${m.availability === 'unavailable'}>${m.displayName} · ${m.availability}</option>`)}
            </select></label
        >`;
    }
    async refreshModels() {
        try {
            const result = await ipcRenderer.invoke('models:refresh');
            this.models = result.models;
            this.error = result.errors.join('; ');
        } catch (error) {
            this.error = error.message;
        }
    }
    async refreshMetrics() {
        this.metrics = await ipcRenderer.invoke('performance:snapshot');
    }
    async exportMetrics(format) {
        const data = await ipcRenderer.invoke('performance:export', format);
        const url = URL.createObjectURL(new Blob([data], { type: format === 'json' ? 'application/json' : 'text/csv' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `wehelp-benchmark.${format}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async listDevices() {
        // No permission request or capture on opening settings.
        this.devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    }
    render() {
        const m = this.metrics,
            ms = value => (value == null ? '—' : `${value.toFixed(1)} ms`);
        return html` <details>
                <summary>Response engine and audio</summary>
                <p>Changing provider, model or mode stops the active session. Models remain unverified until account discovery succeeds.</p>
                ${this.select('Performance mode', 'performanceMode', [
                    ['instant', 'Instant'],
                    ['balanced', 'Balanced'],
                    ['deep', 'Deep'],
                    ['live-voice', 'Live Voice'],
                    ['offline', 'Offline'],
                ])}
                ${this.select('Response provider', 'responseProvider', [
                    ['auto', 'Automatic (Groq when configured)'],
                    ['gemini', 'Gemini'],
                    ['groq', 'Groq'],
                    ['local', 'Local AI'],
                ])}
                ${this.select('Response style', 'responseStyle', [
                    ['concise', 'Concise'],
                    ['standard', 'Standard'],
                    ['detailed', 'Detailed'],
                ])}
                ${this.model('Gemini response and vision', 'geminiChatModel', 'gemini', 'text')}
                ${this.model('Groq response', 'groqModel', 'groq', 'text')} ${this.model('Groq vision', 'groqImageModel', 'groq', 'vision')}
                ${this.model('Gemini native voice', 'geminiLiveModel', 'gemini', 'live', false)}
                ${this.select('Transcription provider', 'transcriptionProvider', [
                    ['gemini', 'Gemini streaming transcription'],
                    ['groq', 'Groq Whisper (utterance upload)'],
                ])}
                ${this.model('Transcription model', 'transcriptionModel', this.config.transcriptionProvider || 'gemini', this.config.transcriptionProvider === 'groq' ? 'transcription' : 'transcription-live', false)}
                ${this.select('Audio chunk duration', 'audioChunkMs', [
                    [20, '20 ms'],
                    [40, '40 ms'],
                    [60, '60 ms'],
                    [100, '100 ms (compatibility default)'],
                ])}
                ${this.select('End-of-speech silence', 'endpointSilenceMs', [
                    [400, '400 ms'],
                    [700, '700 ms (default)'],
                    [1000, '1000 ms'],
                    [1500, '1500 ms'],
                ])}
                ${this.hardware ? html`<p>${this.hardware.memoryGiB} GiB RAM · ${this.hardware.logicalCpus} logical CPUs. ${this.hardware.acceleration}. ${this.hardware.runtimeSupported ? '' : 'Existing native runtime downloads do not support this OS.'}</p>` : ''}
                <button
                    @click=${async () => {
                        const model = (this.hardware?.memoryGiB || 0) < 12 ? 'unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M' : 'unsloth/Qwen3.5-4B-GGUF:Q4_K_M';
                        await ipcRenderer.invoke('storage:update-preference', 'localLlmModel', model);
                        this.dispatchEvent(new CustomEvent('local-profile-changed', { detail: model, bubbles: true, composed: true }));
                    }}
                >
                    Apply local model suggestion (no download)
                </button>
                <button @click=${this.refreshModels}>Verify model availability</button>
                <button @click=${this.listDevices}>List microphones</button>
                ${
                    this.devices.length
                        ? html`<label
                              >Microphone<select
                                  @change=${event => ipcRenderer.invoke('storage:update-preference', 'audioDeviceId', event.target.value)}
                              >
                                  <option value="">System default</option>
                                  ${this.devices.map(d => html`<option value=${d.deviceId}>${d.label || 'Microphone (name available after permission)'}</option>`)}
                              </select></label
                          >`
                        : ''
                }
                <details>
                    <summary>Screen-sharing privacy</summary>
                    <label
                        ><span
                            ><input
                                type="checkbox"
                                .checked=${!!this.config.screenSharePrivacy}
                                ?disabled=${window.wehelp.platform !== 'win32'}
                                @change=${event => this.save('screenSharePrivacy', event.target.checked)}
                            />
                            Hide WeHelp from screen capture (Windows)</span
                        ></label
                    >
                    <p>
                        ${window.wehelp.platform !== 'win32' ? 'This option is currently supported on Windows only. ' : ''}Uses Windows capture
                        exclusion. WeHelp stays visible to you. Google Meet or other sharing methods may still capture it: verify the view from
                        another participant/device before relying on it. Sharing a specific app window is more reliable.
                    </p>
                    <p>Off by default. Changes apply immediately and are saved for the next launch.</p>
                </details>
                ${['alwaysOnTop', 'minimizeToTray', 'launchAtLogin'].map(
                    key =>
                        html`<label
                            ><span
                                ><input type="checkbox" .checked=${!!this.config[key]} @change=${event => this.save(key, event.target.checked)} />
                                ${{ alwaysOnTop: 'Always on top', minimizeToTray: 'Minimize to tray', launchAtLogin: 'Launch at login' }[key]}</span
                            ></label
                        >`
                )}
            </details>
            <details
                @toggle=${event => {
                    if (event.target.open) this.refreshMetrics();
                }}
            >
                <summary>Performance</summary>
                <p>
                    Observed session measurements. No provider credentials, transcripts, images or audio are included. Throughput is a character-based
                    estimate.
                </p>
                <dl>
                    <dt>Provider / model</dt>
                    <dd>${m.provider || '—'} / ${m.model || '—'}</dd>
                    <dt>Startup</dt>
                    <dd>${ms(m.startupMs)}</dd>
                    <dt>Last visible response</dt>
                    <dd>${ms(m.lastLatencyMs)}</dd>
                    <dt>Average / P50</dt>
                    <dd>${ms(m.averageMs)} / ${ms(m.p50Ms)}</dd>
                    <dt>P95 / P99</dt>
                    <dd>${ms(m.p95Ms)} / ${ms(m.p99Ms)}</dd>
                    <dt>Estimated tokens/sec</dt>
                    <dd>${m.estimatedTokensPerSecond?.toFixed(1) || '—'}</dd>
                    <dt>Memory (main process)</dt>
                    <dd>${m.rssBytes ? (m.rssBytes / 1048576).toFixed(1) + ' MB' : '—'}</dd>
                    <dt>Active sessions / requests</dt>
                    <dd>${m.activeSessions || 0} / ${m.requests || 0}</dd>
                    <dt>Reconnections</dt>
                    <dd>${m.reconnections || 0}</dd>
                    <dt>Audio backlog</dt>
                    <dd>${m.audioBacklog || 0}</dd>
                    <dt>Audio transport</dt>
                    <dd>${ms(m.audioTransportMs)}</dd>
                    <dt>Event loop P95</dt>
                    <dd>${ms(m.eventLoopP95Ms)}</dd>
                </dl>
                <button @click=${this.refreshMetrics}>Refresh</button><button @click=${() => this.exportMetrics('json')}>Export JSON</button
                ><button @click=${() => this.exportMetrics('csv')}>Export CSV</button>
            </details>
            <button @click=${() => ipcRenderer.invoke('cancel-request')}>Cancel current answer</button>
            ${this.error ? html`<p class="error">${this.error}</p>` : ''}`;
    }
}
customElements.define('engine-settings', EngineSettings);
