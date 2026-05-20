const config = require('../config');
const swgChatClient = require('./swgChatClient');

let flourishTimer = null;
let started = false;

function getSettings() {
    return config.entBot || {};
}

function getMissingSettings(settings) {
    const missing = [];

    if (!settings.loginAddress) missing.push('ENT_BOT_LOGIN_ADDRESS');
    if (!settings.loginPort) missing.push('ENT_BOT_LOGIN_PORT');
    if (!settings.username) missing.push('ENT_BOT_USERNAME');
    if (!settings.password) missing.push('ENT_BOT_PASSWORD');
    if (!settings.character) missing.push('ENT_BOT_CHARACTER');
    if (!settings.chatRoom) missing.push('ENT_BOT_ROOM');

    return missing;
}

function clearPerformanceLoop() {
    if (!flourishTimer) {
        return;
    }

    clearInterval(flourishTimer);
    flourishTimer = null;
}

function sendPerformanceCommands() {
    const settings = getSettings();

    swgChatClient.sendConsoleCommand(settings.danceCommand);
    swgChatClient.sendConsoleCommand(settings.flourishCommand);
}

function startPerformanceLoop() {
    clearPerformanceLoop();

    const settings = getSettings();
    const intervalMs = Math.max(1000, Number(settings.intervalMs || 3000));

    flourishTimer = setInterval(() => {
        sendPerformanceCommands();
    }, intervalMs);
}

function attachCallbacks() {
    swgChatClient.serverDown = function () {
        console.warn('[EntBot] Lost contact with the SWG server.');
    };

    swgChatClient.serverUp = function () {
        console.log('[EntBot] SWG server connection recovered.');
    };

    swgChatClient.reconnected = function () {
        const state = swgChatClient.getState();
        console.log(`[EntBot] Connected [character=${state.character}] [room=${state.chatRoom}]`);
        sendPerformanceCommands();
        startPerformanceLoop();
    };
}

function startEntBotWorker() {
    if (started) {
        return true;
    }

    const settings = getSettings();
    const missing = getMissingSettings(settings);

    if (missing.length > 0) {
        console.warn(`[EntBot] Missing settings: ${missing.join(', ')}`);
        return false;
    }

    attachCallbacks();

    swgChatClient.login({
        LoginAddress: settings.loginAddress,
        LoginPort: settings.loginPort,
        Username: settings.username,
        Password: settings.password,
        Character: settings.character,
        ChatRoom: settings.chatRoom,
        verboseSWGLogging: settings.verboseSwgLogging,
        connectionTimeoutMs: settings.connectionTimeoutMs,
        failureThreshold: settings.failureThreshold
    });

    started = true;
    console.log(`[EntBot] Starting [character=${settings.character}] [intervalMs=${settings.intervalMs || 3000}]`);
    return true;
}

function shutdown() {
    clearPerformanceLoop();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = {
    startEntBotWorker
};

if (require.main === module) {
    const startedSuccessfully = startEntBotWorker();
    if (!startedSuccessfully) {
        process.exit(64);
    }
}
