// Compatibility facade for existing callers; privileged operations are defined
// individually by the isolated preload, never supplied by renderer code.
const listeners = new Map();
export const ipcRenderer = {
    invoke(channel, ...args) {
        const operation = window.wehelp.operations[channel];
        if (!operation) return Promise.reject(new Error('Unsupported operation'));
        return operation(...args);
    },
    send(channel, ...args) {
        const command = window.wehelp.commands[channel];
        if (!command) throw new Error('Unsupported command');
        command(...args);
    },
    on(channel, callback) {
        const subscribe = window.wehelp.subscriptions[channel];
        if (!subscribe) throw new Error('Unsupported event');
        const remove = subscribe(data => callback(null, data));
        const entries = listeners.get(channel) || [];
        entries.push({ callback, remove });
        listeners.set(channel, entries);
    },
    removeListener(channel, callback) {
        const entries = listeners.get(channel) || [];
        entries.filter(entry => entry.callback === callback).forEach(entry => entry.remove());
        listeners.set(
            channel,
            entries.filter(entry => entry.callback !== callback)
        );
    },
    removeAllListeners(channel) {
        (listeners.get(channel) || []).forEach(entry => entry.remove());
        listeners.delete(channel);
    },
};
