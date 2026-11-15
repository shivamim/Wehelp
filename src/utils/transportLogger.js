// Compatibility API. Raw provider payloads are deliberately not persisted.
// Use performance-monitor for bounded, content-free diagnostic measurements.
function startTransportLog() {}
function logTransportEvent() {}
function closeTransportLog() {}
module.exports = { startTransportLog, logTransportEvent, closeTransportLog };
