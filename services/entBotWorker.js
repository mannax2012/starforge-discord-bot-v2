const config = require('../config');
const swgChatClient = require('./swgChatClient');

let flourishTimer = null;
let startupTimer = null;
let advertTimer = null;
let advertIndex = 0;
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

    return missing;
}

function clearPerformanceLoop() {
    if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
    }

    if (!flourishTimer) {
        return;
    }

    clearInterval(flourishTimer);
    flourishTimer = null;
}

function clearAdvertLoop() {
    if (!advertTimer) {
        return;
    }

    clearInterval(advertTimer);
    advertTimer = null;
}

function sendAdvertMessage() {
    const settings = getSettings();
    const channels = Array.isArray(settings.advertChannels) ? settings.advertChannels : [];
    const messages = Array.isArray(settings.advertMessages) ? settings.advertMessages : [];

    if (!settings.advertsEnabled || channels.length === 0 || messages.length === 0) {
        return false;
    }

    const message = messages[advertIndex % messages.length];
    advertIndex += 1;

    for (const channel of channels) {
        swgChatClient.sendGameCommand(`/${channel} ${message}`);
    }

    return true;
}

function startAdvertLoop() {
    clearAdvertLoop();

    const settings = getSettings();
    const channels = Array.isArray(settings.advertChannels) ? settings.advertChannels : [];
    const messages = Array.isArray(settings.advertMessages) ? settings.advertMessages : [];

    if (!settings.advertsEnabled || channels.length === 0 || messages.length === 0) {
        return;
    }

    const intervalMs = Math.max(120000, Number(settings.advertIntervalMs || 120000));
    advertTimer = setInterval(() => {
        sendAdvertMessage();
    }, intervalMs);
}

function sendPerformanceCommands() {
    const settings = getSettings();

    swgChatClient.sendGameCommand(settings.danceCommand);
    swgChatClient.sendGameCommand(settings.flourishCommand);
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
    swgChatClient.recvTell = function (from, message) {
        const settings = getSettings();
        const sender = String(from || '').trim();
        const character = String(settings.character || '').trim();

        if (!settings.autoInviteOnTell || !sender) {
            return;
        }

        if (sender.toLowerCase() === character.toLowerCase()) {
            return;
        }

        console.log(`[EntBot] Auto-invite requested from tell [from=${sender}]`);
        swgChatClient.sendGameCommand(`/invite ${sender}`);
    };

    swgChatClient.serverDown = function () {
        console.warn('[EntBot] Lost contact with the SWG server.');
    };

    swgChatClient.serverUp = function () {
        console.log('[EntBot] SWG server connection recovered.');
    };

    swgChatClient.reconnected = function () {
        const state = swgChatClient.getState();
        const settings = getSettings();
        console.log(`[EntBot] Connected [character=${state.character}] [room=${state.chatRoom}]`);
        clearPerformanceLoop();
        clearAdvertLoop();
        startupTimer = setTimeout(() => {
            startupTimer = null;
            console.log(
                `[EntBot] Performance loop started [dance=${settings.danceCommand}] `
                + `[flourish=${settings.flourishCommand}] [intervalMs=${settings.intervalMs || 3000}]`
            );
            if (settings.announceCommands) {
                swgChatClient.sendTell(
                    settings.character,
                    `[EntBot] started ${settings.danceCommand} + ${settings.flourishCommand} every ${settings.intervalMs || 3000}ms`
                );
            }
            sendPerformanceCommands();
            startPerformanceLoop();
            if (settings.advertsEnabled && settings.advertMessages.length > 0 && settings.advertChannels.length > 0) {
                console.log(
                    `[EntBot] Advert loop started [channels=${settings.advertChannels.join(',')}] `
                    + `[intervalMs=${settings.advertIntervalMs || 120000}] [messages=${settings.advertMessages.length}]`
                );
                sendAdvertMessage();
                startAdvertLoop();
            }
        }, 2500);
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
        JoinChatRoom: false,
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
    clearAdvertLoop();
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
