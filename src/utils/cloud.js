const WebSocket = require('ws');
const { BrowserWindow } = require('electron');

let cloudWs = null;
let isCloudConnected = false;
let currentCloudResponse = '';
let currentTranscription = '';
let isFirstChunk = true;
let audioChunkCount = 0;
let onTurnComplete = null;

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

function setOnTurnComplete(callback) {
    onTurnComplete = callback;
}

function connectCloud(token, profile, userContext, onDisconnect) {
    // Close existing connection
    if (cloudWs) {
        try {
            cloudWs.close();
        } catch (e) {}
        cloudWs = null;
        isCloudConnected = false;
    }

    audioChunkCount = 0;
    currentCloudResponse = currentTranscription = '';
    isFirstChunk = true;

    return new Promise((resolve, reject) => {
        const url = `wss://api.cheatingdaddy.com/ws?token=${encodeURIComponent(token)}`;
        console.log('[Cloud] Connecting');

        const socket = (cloudWs = new WebSocket(url));
        let opened = false;
        const timeout = setTimeout(() => {
            socket.close();
            reject(new Error('Cloud connection timeout'));
        }, 10000);

        socket.on('open', () => {
            if (socket !== cloudWs) return;
            opened = true;
            isCloudConnected = true;
            clearTimeout(timeout);
            socket.send(JSON.stringify({ type: 'set_config', profile: profile || 'interview', user_context: userContext || '' }));
            sendToRenderer('update-status', 'Cloud connected');
            resolve(true);
        });

        socket.on('message', data => {
            if (socket !== cloudWs) return;
            try {
                const message = JSON.parse(data.toString());
                handleMessage(message);
                if (message.type === 'session_end') socket.close();
            } catch (error) {
                console.error('[Cloud] Parse error:', error.message);
            }
        });

        socket.on('close', () => {
            clearTimeout(timeout);
            if (!opened) reject(new Error('Cloud connection closed'));
            if (socket !== cloudWs) return;
            isCloudConnected = false;
            if (opened) onDisconnect?.();
        });

        socket.on('error', error => {
            if (!opened) reject(error);
            socket.close();
        });
    });
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'connected':
            console.log('[Cloud] Server confirmed connected');
            break;

        case 'transcription':
            currentTranscription = msg.text || '';
            sendToRenderer('update-status', 'Generating response...');
            break;

        case 'response_start':
            currentCloudResponse = '';
            isFirstChunk = true;
            break;

        case 'response_chunk':
            currentCloudResponse += msg.text;
            sendToRenderer(isFirstChunk ? 'new-response' : 'update-response', currentCloudResponse);
            isFirstChunk = false;
            break;

        case 'response_end':
            if (onTurnComplete && currentCloudResponse.trim()) {
                onTurnComplete(currentTranscription, currentCloudResponse);
            }
            currentTranscription = '';
            sendToRenderer('update-status', 'Listening...');
            break;

        case 'session_end':
            console.log('[Cloud] Session ended by server');
            isCloudConnected = false;
            break;

        case 'error':
            console.error('[Cloud] Server error:', msg.message);
            sendToRenderer('update-status', 'Cloud error: ' + msg.message);
            break;

        default:
            console.log('[Cloud] Event:', msg.type);
    }
}

function sendCloudAudio(pcmBuffer) {
    if (!cloudWs || !isCloudConnected || cloudWs.readyState !== WebSocket.OPEN) {
        return;
    }

    cloudWs.send(pcmBuffer, { binary: true }, err => {
        if (err) {
            console.error('[Cloud] Audio send error:', err.message);
        }
    });

    audioChunkCount++;
    process.stdout.write('.');
}

function sendCloudText(text) {
    if (cloudWs && isCloudConnected && cloudWs.readyState === WebSocket.OPEN) {
        cloudWs.send(
            JSON.stringify({
                type: 'test_text',
                text: text,
            })
        );
    }
}

function sendCloudImage(base64Data) {
    if (!cloudWs || !isCloudConnected || cloudWs.readyState !== WebSocket.OPEN) {
        return false;
    }
    cloudWs.send(
        JSON.stringify({
            type: 'image',
            image: base64Data,
        })
    );
    return true;
}

function closeCloud() {
    console.log('[Cloud] Closing. Audio chunks sent:', audioChunkCount);
    if (cloudWs) {
        try {
            if (cloudWs.readyState === WebSocket.OPEN) {
                cloudWs.send(JSON.stringify({ type: 'end_connection' }));
            }
            cloudWs.close();
        } catch (e) {
            console.error('[Cloud] Close error:', e);
        }
        cloudWs = null;
    }
    isCloudConnected = false;
    currentCloudResponse = '';
    currentTranscription = '';
    isFirstChunk = true;
    audioChunkCount = 0;
    onTurnComplete = null;
}

function isCloudActive() {
    return isCloudConnected && cloudWs && cloudWs.readyState === WebSocket.OPEN;
}

module.exports = {
    connectCloud,
    sendCloudAudio,
    sendCloudText,
    sendCloudImage,
    closeCloud,
    isCloudActive,
    setOnTurnComplete,
};
