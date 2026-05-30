const config = require('../config');
const { createSwgChatClient } = require('./swgChatClient');

const APP_NAME = 'EntBot';

let runners = [];
let started = false;

function getSettings() {
    return config.entBot || {};
}

function getEntertainers(settings) {
    if (Array.isArray(settings.entertainers) && settings.entertainers.length > 0) {
        return settings.entertainers;
    }

    return [settings];
}

function getMissingSettings(settings) {
    const missing = [];

    if (!settings.loginAddress) missing.push('loginAddress');
    if (!settings.loginPort) missing.push('loginPort');
    if (!settings.username) missing.push('username');
    if (!settings.password) missing.push('password');
    if (!settings.character) missing.push('character');

    return missing;
}

function getRunnerLabel(settings, index) {
    const name = String(settings.character || '').trim() || `entertainer-${index + 1}`;
    return `[${APP_NAME}:${name}]`;
}

function summarizeCommands(settings) {
    const commands = [];

    if (Array.isArray(settings.performanceCommands)) {
        for (const command of settings.performanceCommands) {
            const normalized = String(command || '').trim();
            if (normalized) {
                commands.push(normalized);
            }
        }
    }

    const flourishCommand = String(settings.flourishCommand || '').trim();
    if (flourishCommand) {
        commands.push(flourishCommand);
    }

    return commands;
}

function summarizeStartupCommands(settings) {
    if (!Array.isArray(settings.startupCommands)) {
        return [];
    }

    return settings.startupCommands
        .map((command) => String(command || '').trim())
        .filter(Boolean);
}

function summarizeAdvertMessages(settings) {
    if (Array.isArray(settings.advertMessages) && settings.advertMessages.length > 0) {
        return settings.advertMessages
            .map((message) => String(message || '').trim())
            .filter(Boolean);
    }

    const singleMessage = String(settings.advertMessage || '').trim();
    return singleMessage ? [singleMessage] : [];
}

function isUiActionCommand(command) {
    return /^\/?ui\s+action\b/i.test(String(command || '').trim());
}

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function executeBotCommand(client, command) {
    const normalized = String(command || '').trim();
    if (!normalized) {
        return false;
    }

    if (client.supportsGameCommand(normalized) && client.sendGameCommand(normalized)) {
        return true;
    }

    return client.sendConsoleCommand(normalized);
}

function normalizeCommandList(commands) {
    if (!Array.isArray(commands)) {
        return [];
    }

    return commands
        .map((command) => String(command || '').trim())
        .filter(Boolean);
}

function extractGroupInviteSender(message) {
    const normalizedMessage = String(message || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalizedMessage) {
        return '';
    }

    const patterns = [
        /\b([A-Za-z0-9'_-]+)\b has invited you to join (?:a |their |his |her )?group\b/i,
        /\bgroup invitation from ([A-Za-z0-9'_-]+)\b/i,
        /\byou have been invited to join (?:a |their |his |her )?group by ([A-Za-z0-9'_-]+)\b/i,
        /\b([A-Za-z0-9'_-]+)\b invited you to join (?:a |their |his |her )?group\b/i
    ];

    for (const pattern of patterns) {
        const match = normalizedMessage.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }

    return '';
}

function createRunner(settings, index) {
    const swgChatClient = createSwgChatClient();
    const label = getRunnerLabel(settings, index);
    const performanceCommands = summarizeCommands(settings);
    const startupCommands = summarizeStartupCommands(settings);
    const inviteCleanupCommands = normalizeCommandList(settings.inviteCleanupCommands);
    const advertMessages = summarizeAdvertMessages(settings);
    const petAutoCallEnabled = Boolean(settings.petAutoCallEnabled);
    const petAutoGroupEnabled = Boolean(settings.petAutoGroupEnabled);
    const petAutoGroupCommand = String(settings.petAutoGroupCommand || '').trim();
    const autoAcceptGroupInvites = Boolean(settings.autoAcceptGroupInvites);
    const groupInviteAcceptCommand = String(settings.groupInviteAcceptCommand || '').trim();
    const groupInviteResponsePauseMs = Math.max(0, Number(settings.groupInviteResponsePauseMs || 500));
    const petDiscoveryEnabled = settings.petDiscoveryEnabled !== false;
    const petDiscoveryDebug = Boolean(settings.petDiscoveryDebug);
    const petControlDeviceIds = Array.isArray(settings.petControlDeviceIds) ? settings.petControlDeviceIds : [];
    const petCallRadialId = Math.max(0, Math.min(255, Number(settings.petCallRadialId || 44)));
    const petCallPauseMs = Math.max(0, Number(settings.petCallPauseMs || 3000));
    const petAutoGroupDelayMs = Math.max(0, Number(settings.petAutoGroupDelayMs || petCallPauseMs || 3000));
    const startupCommandPauseMs = Math.max(0, Number(settings.startupCommandPauseMs || 3000));
    const inviteCleanupPauseMs = Math.max(0, Number(settings.inviteCleanupPauseMs || 750));
    let startupTimer = null;
    let performanceTimer = null;
    let advertTimer = null;
    let advertIndex = 0;
    let runnerStarted = false;
    let startupSequenceId = 0;
    let lastAcceptedInviteSignature = '';
    let lastAcceptedInviteAt = 0;
    const trackedDiscoveryObjectIds = new Set(
        petControlDeviceIds
            .map((objectId) => String(objectId || '').trim())
            .filter(Boolean)
    );

    function cancelStartupSequence() {
        startupSequenceId += 1;
    }

    function clearPerformanceLoop() {
        if (startupTimer) {
            clearTimeout(startupTimer);
            startupTimer = null;
        }

        if (performanceTimer) {
            clearInterval(performanceTimer);
            performanceTimer = null;
        }
    }

    function clearAdvertLoop() {
        if (!advertTimer) {
            return;
        }

        clearInterval(advertTimer);
        advertTimer = null;
    }

    function rememberDiscoveryObjectId(objectId) {
        const normalized = String(objectId || '').trim();
        if (!normalized) {
            return;
        }

        trackedDiscoveryObjectIds.add(normalized);
    }

    function isKnownDiscoveryObjectId(objectId) {
        const normalized = String(objectId || '').trim();
        return normalized ? trackedDiscoveryObjectIds.has(normalized) : false;
    }

    function looksPetRelatedText(...values) {
        const searchText = values
            .flatMap((value) => Array.isArray(value) ? value : [value])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        if (!searchText) {
            return false;
        }

        return /(?:^|[\s|/_-])(datapad|pcd|pet_control_device|control\s*device|helper|astromech|at_st)(?:$|[\s|/_-])/.test(searchText);
    }

    function shouldLogDiscoveryDebugEvent(event) {
        if (!event) {
            return false;
        }

        const objectId = String(event.objectId || '').trim();
        const parentId = String(event.parentId || '').trim();

        if (objectId && isKnownDiscoveryObjectId(objectId)) {
            return true;
        }

        if (parentId && isKnownDiscoveryObjectId(parentId)) {
            if (objectId) {
                rememberDiscoveryObjectId(objectId);
            }
            return true;
        }

        if (event.type === 'containment') {
            return false;
        }

        if (event.type === 'sceneCreate') {
            return false;
        }

        if (event.type === 'baseline') {
            const objectType = String(event.objectType || '').trim().toUpperCase();
            if (objectType && objectType !== 'ITNO' && objectType !== 'ONTI') {
                return false;
            }
        }

        if (looksPetRelatedText(
            event.objectType,
            event.stfFile,
            event.stfName,
            event.customName,
            event.parentLabel,
            event.hints
        )) {
            if (objectId) {
                rememberDiscoveryObjectId(objectId);
            }
            if (parentId) {
                rememberDiscoveryObjectId(parentId);
            }
            return true;
        }

        return false;
    }

    function sendPerformanceCommands() {
        let sentAny = false;

        for (const command of performanceCommands) {
            sentAny = executeBotCommand(swgChatClient, command) || sentAny;
        }

        return sentAny;
    }

    async function sendCommandSequence(commands, sequenceId, pauseMs = 0) {
        let sentAny = false;
        const normalizedCommands = normalizeCommandList(commands);

        for (let idx = 0; idx < normalizedCommands.length; idx += 1) {
            if (sequenceId !== startupSequenceId) {
                return sentAny;
            }

            const command = normalizedCommands[idx];
            if (isUiActionCommand(command)) {
                console.warn(
                    `${label} Skipping unsupported client UI command in startup sequence: ${command}`
                );
                continue;
            }

            sentAny = executeBotCommand(swgChatClient, command) || sentAny;

            if (idx < normalizedCommands.length - 1 && pauseMs > 0) {
                await wait(pauseMs);
            }
        }

        return sentAny;
    }

    async function sendPerformanceResetCommands(sequenceId) {
        return sendCommandSequence(['/stopdance', '/stopmusic'], sequenceId, 500);
    }

    async function sendStartupCommands(sequenceId) {
        return sendCommandSequence(startupCommands, sequenceId, startupCommandPauseMs);
    }

    async function sendInviteCleanupCommands(sequenceId) {
        return sendCommandSequence(inviteCleanupCommands, sequenceId, inviteCleanupPauseMs);
    }

    async function sendPetControlDeviceCalls(sequenceId) {
        let sentAny = false;

        for (let idx = 0; idx < petControlDeviceIds.length; idx += 1) {
            if (sequenceId !== startupSequenceId) {
                return sentAny;
            }

            const sent = swgChatClient.sendObjectMenuSelect({
                objectId: petControlDeviceIds[idx],
                radialId: petCallRadialId
            });
            sentAny = sent || sentAny;

            if (idx < petControlDeviceIds.length - 1 && petCallPauseMs > 0) {
                await wait(petCallPauseMs);
            }
        }

        return sentAny;
    }

    function sendAdvertMessage() {
        const channels = Array.isArray(settings.advertChannels) ? settings.advertChannels : [];

        if (!settings.advertsEnabled || channels.length === 0 || advertMessages.length === 0) {
            return false;
        }

        const message = advertMessages[advertIndex % advertMessages.length];
        advertIndex += 1;

        let sentAny = false;
        for (const channel of channels) {
            sentAny = executeBotCommand(swgChatClient, `/${channel} ${message}`) || sentAny;
        }

        return sentAny;
    }

    function startAdvertLoop() {
        clearAdvertLoop();

        const channels = Array.isArray(settings.advertChannels) ? settings.advertChannels : [];

        if (!settings.advertsEnabled || channels.length === 0 || advertMessages.length === 0) {
            return;
        }

        const intervalMs = Math.max(120000, Number(settings.advertIntervalMs || 120000));
        advertTimer = setInterval(() => {
            sendAdvertMessage();
        }, intervalMs);
    }

    async function runStartupSequence(sequenceId) {
        console.log(`${label} Resetting active performance state [commands=/stopdance | /stopmusic]`);
        await sendPerformanceResetCommands(sequenceId);

        if (sequenceId !== startupSequenceId) {
            return;
        }

        if (inviteCleanupCommands.length > 0) {
            console.log(
                `${label} Invite cleanup started [commands=${inviteCleanupCommands.join(' | ')}] `
                + `[pauseMs=${inviteCleanupPauseMs}]`
            );
            await sendInviteCleanupCommands(sequenceId);
        }

        if (sequenceId !== startupSequenceId) {
            return;
        }

        if (petDiscoveryEnabled) {
            const discoveredDevices = swgChatClient.getDiscoveredControlDevices();
            if (discoveredDevices.length > 0) {
                console.log(
                    `${label} Discovered control device candidates `
                    + `[devices=${discoveredDevices
                        .map((device) => `${device.objectId}:${device.label || device.stfFile || 'unknown'}`)
                        .join(' | ')}]`
                );
            } else {
                console.log(`${label} No control device candidates discovered yet.`);
            }
        }

        if (petControlDeviceIds.length > 0 && !petAutoCallEnabled) {
            console.log(
                `${label} Pet control device IDs configured but pet auto-call is disabled `
                + `[count=${petControlDeviceIds.length}]`
            );
        }

        if (petAutoCallEnabled) {
            if (petControlDeviceIds.length === 0) {
                console.warn(`${label} Pet auto-call skipped because no pet control device IDs are configured.`);
            } else {
                console.log(
                    `${label} Pet auto-call sequence started [count=${petControlDeviceIds.length}] `
                    + `[radialId=${petCallRadialId}] [pauseMs=${petCallPauseMs}]`
                );
                await sendPetControlDeviceCalls(sequenceId);
            }
        }

        if (sequenceId !== startupSequenceId) {
            return;
        }

        if (petAutoGroupEnabled) {
            if (!petAutoCallEnabled || petControlDeviceIds.length === 0) {
                console.warn(
                    `${label} Pet auto-group skipped because no pets were auto-called in this startup sequence.`
                );
            } else if (!petAutoGroupCommand) {
                console.warn(`${label} Pet auto-group skipped because no pet auto-group command is configured.`);
            } else {
                console.log(
                    `${label} Pet auto-group scheduled [command=${petAutoGroupCommand}] `
                    + `[delayMs=${petAutoGroupDelayMs}]`
                );

                if (petAutoGroupDelayMs > 0) {
                    await wait(petAutoGroupDelayMs);
                }

                if (sequenceId !== startupSequenceId) {
                    return;
                }

                executeBotCommand(swgChatClient, petAutoGroupCommand);
            }
        }

        if (startupCommands.length > 0) {
            console.log(
                `${label} Startup command sequence started [commands=${startupCommands.join(' | ')}] `
                + `[pauseMs=${startupCommandPauseMs}]`
            );
            await sendStartupCommands(sequenceId);
        }

        if (sequenceId !== startupSequenceId) {
            return;
        }

        if (performanceCommands.length > 0) {
            console.log(
                `${label} Performance loop started [type=${settings.performanceType}] `
                + `[commands=${performanceCommands.join(' | ')}] `
                + `[intervalMs=${settings.intervalMs || 3000}]`
            );

            if (settings.announceCommands) {
                swgChatClient.sendTell(
                    settings.character,
                    `[${APP_NAME}] started ${performanceCommands.join(' + ')} every ${settings.intervalMs || 3000}ms`
                );
            }

            sendPerformanceCommands();
            startPerformanceLoop();
        }

        if (sequenceId !== startupSequenceId) {
            return;
        }

        if (settings.advertsEnabled && advertMessages.length > 0 && settings.advertChannels.length > 0) {
            console.log(
                `${label} Advert loop started [channels=${settings.advertChannels.join(',')}] `
                + `[intervalMs=${settings.advertIntervalMs || 120000}] [messages=${advertMessages.length}]`
            );
            sendAdvertMessage();
            startAdvertLoop();
        }
    }

    function startPerformanceLoop() {
        if (performanceTimer) {
            clearInterval(performanceTimer);
            performanceTimer = null;
        }

        if (performanceCommands.length === 0) {
            return;
        }

        const intervalMs = Math.max(1000, Number(settings.intervalMs || 3000));
        performanceTimer = setInterval(() => {
            sendPerformanceCommands();
        }, intervalMs);
    }

    function attachCallbacks() {
        swgChatClient.controlDeviceDiscovered = function (device) {
            if (!petDiscoveryEnabled || !device) {
                return;
            }

            rememberDiscoveryObjectId(device.objectId);
            rememberDiscoveryObjectId(device.parentId);

            const name = device.label || device.stfFile || 'unknown';

            console.log(
                `${label} Discovered control device candidate [id=${device.objectId}] `
                + `[name=${name}]`
                + (device.parentLabel ? ` [parent=${device.parentLabel}]` : '')
                + (device.parentId ? ` [parentId=${device.parentId}]` : '')
            );
        };

        swgChatClient.discoveryDebug = function (event) {
            if (!petDiscoveryDebug || !event) {
                return;
            }

            if (!shouldLogDiscoveryDebugEvent(event)) {
                return;
            }

            if (event.type === 'sceneCreate') {
                console.log(
                    `${label} Discovery sceneCreate [objectId=${event.objectId}] `
                    + `[objectCRC=${event.objectCRC}] [byteFlag=${event.sceneCreateByteFlag}]`
                );
            }

            if (event.type === 'baseline') {
                console.log(
                    `${label} Discovery baseline [objectId=${event.objectId}] [objectType=${event.objectType}] `
                    + `[viewType=${event.viewType}] [dataSize=${event.dataSize}]`
                    + (event.stfFile ? ` [stfFile=${event.stfFile}]` : '')
                    + (event.stfName ? ` [stfName=${event.stfName}]` : '')
                    + (event.customName ? ` [customName=${event.customName}]` : '')
                    + (event.hints && event.hints.length > 0 ? ` [hints=${event.hints.join(' | ')}]` : '')
                );
            }

            if (event.type === 'containment') {
                console.log(
                    `${label} Discovery containment [objectId=${event.objectId}] `
                    + `[parentId=${event.parentId}] [arrangementId=${event.arrangementId}]`
                );
            }
        };

        swgChatClient.recvTell = function (from) {
            const sender = String(from || '').trim();
            const character = String(settings.character || '').trim();

            if (!settings.autoInviteOnTell || !sender) {
                return;
            }

            if (sender.toLowerCase() === character.toLowerCase()) {
                return;
            }

            console.log(`${label} Auto-invite requested from tell [from=${sender}]`);
            executeBotCommand(swgChatClient, `/invite ${sender}`);
        };

        swgChatClient.recvSystemMessage = function (message, packet) {
            const normalizedMessage = String(message || '')
                .replace(/\s+/g, ' ')
                .trim();

            if (!normalizedMessage) {
                return;
            }

            const sender = extractGroupInviteSender(normalizedMessage);
            if (!sender) {
                return;
            }

            console.log(`${label} Group invite detected [from=${sender}] [message=${normalizedMessage}]`);

            if (!autoAcceptGroupInvites) {
                return;
            }

            if (!groupInviteAcceptCommand) {
                console.warn(`${label} Group invite accept skipped because no accept command is configured.`);
                return;
            }

            const signature = `${sender.toLowerCase()}|${normalizedMessage.toLowerCase()}`;
            const now = Date.now();
            if (signature === lastAcceptedInviteSignature && (now - lastAcceptedInviteAt) < 15000) {
                console.log(`${label} Duplicate group invite message ignored [from=${sender}]`);
                return;
            }

            lastAcceptedInviteSignature = signature;
            lastAcceptedInviteAt = now;

            setTimeout(() => {
                if (!runnerStarted || !swgChatClient.isConnected) {
                    return;
                }

                console.log(
                    `${label} Accepting group invite [from=${sender}] `
                    + `[command=${groupInviteAcceptCommand}]`
                );
                executeBotCommand(swgChatClient, groupInviteAcceptCommand);
            }, groupInviteResponsePauseMs);

            if (packet && packet.PayloadHex && settings.verboseSwgLogging) {
                console.log(`${label} Group invite payload [hex=${packet.PayloadHex}]`);
            }
        };

        swgChatClient.serverDown = function () {
            console.warn(`${label} Lost contact with the SWG server.`);
        };

        swgChatClient.serverUp = function () {
            console.log(`${label} SWG server connection recovered.`);
        };

        swgChatClient.reconnected = function () {
            const state = swgChatClient.getState();
            cancelStartupSequence();
            clearPerformanceLoop();
            clearAdvertLoop();

            console.log(`${label} Connected [character=${state.character}]`);

            startupTimer = setTimeout(() => {
                startupTimer = null;
                startupSequenceId += 1;
                void runStartupSequence(startupSequenceId);
            }, Math.max(0, Number(settings.startupDelayMs || 2500)));
        };
    }

    return {
        label,
        start() {
            if (runnerStarted) {
                return true;
            }

            const missing = getMissingSettings(settings);
            if (missing.length > 0) {
                console.warn(`${label} Missing settings: ${missing.join(', ')}`);
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
                failureThreshold: settings.failureThreshold,
                reconnectBaseDelayMs: settings.reconnectBaseDelayMs,
                reconnectMaxDelayMs: settings.reconnectMaxDelayMs,
                reconnectJitterMs: settings.reconnectJitterMs,
                reconnectStableResetMs: settings.reconnectStableResetMs
            });

            runnerStarted = true;
            console.log(
                `${label} Starting [type=${settings.performanceType}] [intervalMs=${settings.intervalMs || 3000}] `
                + `[performanceCommands=${performanceCommands.join(' | ') || 'none'}] `
                + `[startupCommands=${startupCommands.join(' | ') || 'none'}] `
                + `[inviteCleanupCommands=${inviteCleanupCommands.join(' | ') || 'none'}] `
                + `[petDiscovery=${petDiscoveryEnabled}] `
                + `[petDiscoveryDebug=${petDiscoveryDebug}] `
                + `[petAutoCall=${petAutoCallEnabled}] `
                + `[petAutoGroup=${petAutoGroupEnabled}] `
                + `[autoAcceptGroupInvites=${autoAcceptGroupInvites}] `
                + `[petControlDeviceIds=${petControlDeviceIds.join(' | ') || 'none'}] `
                + `[petCallRadialId=${petCallRadialId}]`
            );
            return true;
        },
        stop() {
            cancelStartupSequence();
            clearPerformanceLoop();
            clearAdvertLoop();
            swgChatClient.destroy();
            runnerStarted = false;
        }
    };
}

function startEntBot() {
    if (started) {
        return true;
    }

    const settings = getSettings();
    const entertainers = getEntertainers(settings);

    if (entertainers.length === 0) {
        console.warn(`[${APP_NAME}] No entertainers configured.`);
        return false;
    }

    runners = entertainers.map((entertainer, index) => createRunner(entertainer, index));

    let startedCount = 0;
    for (const runner of runners) {
        startedCount += runner.start() ? 1 : 0;
    }

    if (startedCount === 0) {
        runners = [];
        return false;
    }

    started = true;
    console.log(
        `[${APP_NAME}] Active entertainers: ${startedCount}/${entertainers.length}`
        + (settings.bandEnabled ? ' [band mode]' : '')
    );
    return true;
}

function stopEntBot() {
    for (const runner of runners) {
        runner.stop();
    }

    runners = [];
    started = false;
}

function startEntBotWorker() {
    return startEntBot();
}

function shutdown() {
    stopEntBot();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = {
    startEntBotWorker,
    startEntBot,
    stopEntBot
};

if (require.main === module) {
    const startedSuccessfully = startEntBotWorker();
    if (!startedSuccessfully) {
        process.exit(64);
    }
}
