const config = require('../config');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const swgChatClient = require('./swgChatClient');
const { logToBotChannel } = require('./logging');

let started = false;
let startPromise = null;
let chatChannel = null;
let notificationChannel = null;
let statusDiscordClient = null;
let chatDiscordClient = null;
let statusMessageId = '';
let currentServerStatus = 'connecting';

const STATUS_STATE_PATH = path.join(__dirname, '..', 'data', 'swg_chat_status_message.json');

function bridgeEnabled() {
    return !!(config.features && config.features.swgChatEnabled);
}

function getSettings() {
    return config.swgChatBridge || {};
}

function usesSeparateChatClient() {
    return String(getSettings().discordToken || '').trim() !== '';
}

function ensureDirectoryForFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readStatusState() {
    try {
        if (!fs.existsSync(STATUS_STATE_PATH)) {
            return null;
        }

        const raw = fs.readFileSync(STATUS_STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);

        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        return null;
    }
}

function writeStatusState(state) {
    ensureDirectoryForFile(STATUS_STATE_PATH);
    fs.writeFileSync(STATUS_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function formatStatusLabel(status) {
    const normalized = String(status || '').trim().toLowerCase();

    if (normalized === 'up' || normalized === 'online') {
        return 'ONLINE';
    }

    if (normalized === 'down' || normalized === 'offline') {
        return 'OFFLINE';
    }

    return 'CONNECTING';
}

function buildStatusMessageContent(status, detail) {
    const settings = getSettings();
    const serverName = settings.serverName || 'Starforge';
    const label = formatStatusLabel(status);
    const lines = [
        `**${serverName} Server Status**`,
        `Status: ${label}`,
        `Updated: <t:${Math.floor(Date.now() / 1000)}:F>`
    ];

    if (detail) {
        lines.push(`Detail: ${detail}`);
    }

    return lines.join('\n');
}

async function fetchExistingStatusMessage() {
    if (!notificationChannel || !statusMessageId) {
        return null;
    }

    try {
        return await notificationChannel.messages.fetch(statusMessageId);
    } catch (error) {
        return null;
    }
}

function verboseDiscordLoggingEnabled() {
    return !!getSettings().verboseDiscordLogging;
}

function getChatClientLabel() {
    if (chatDiscordClient && chatDiscordClient.user) {
        return chatDiscordClient.user.tag;
    }

    if (statusDiscordClient && statusDiscordClient.user) {
        return statusDiscordClient.user.tag;
    }

    return usesSeparateChatClient() ? 'secondary chat client' : 'primary Starforge client';
}

function getMissingSettings(settings) {
    const missing = [];

    if (!settings.loginAddress) missing.push('SWG_CHAT_LOGIN_ADDRESS');
    if (!settings.loginPort) missing.push('SWG_CHAT_LOGIN_PORT');
    if (!settings.username) missing.push('SWG_CHAT_USERNAME');
    if (!settings.password) missing.push('SWG_CHAT_PASSWORD');
    if (!settings.character) missing.push('SWG_CHAT_CHARACTER');
    if (!settings.chatRoom) missing.push('SWG_CHAT_ROOM');
    if (!settings.chatChannelId && !settings.chatChannelName) missing.push('SWG_CHAT_CHANNEL_ID or SWG_CHAT_CHANNEL_NAME');

    return missing;
}

async function resolveTextChannel(client, channelId, channelName) {
    let channel = null;

    if (channelId) {
        try {
            channel = await client.channels.fetch(channelId);
        } catch (error) {
            console.error(`Failed to fetch Discord channel ${channelId}:`, error.message);
        }
    }

    if (!channel && channelName) {
        channel = client.channels.cache.find((candidate) => candidate && candidate.name === channelName) || null;
    }

    if (!channel || !channel.isTextBased()) {
        return null;
    }

    return channel;
}

function createChatDiscordClient() {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ],
        partials: [Partials.Channel]
    });
}

async function startSecondaryChatDiscordClient() {
    const settings = getSettings();
    const discordToken = String(settings.discordToken || '').trim();

    if (!discordToken) {
        return null;
    }

    const client = createChatDiscordClient();

    client.on('messageCreate', async (message) => {
        if (message.author.bot) {
            return;
        }

        try {
            await handleDiscordMessage(message, client);
        } catch (error) {
            console.error('Secondary SWG chat client message handler failed:', error);
        }
    });

    await client.login(discordToken);
    return client;
}

function buildNotificationPayload(text) {
    const settings = getSettings();
    const allowedMentions = { parse: [] };
    let prefix = '';

    if (settings.notificationRoleId) {
        prefix = `<@&${settings.notificationRoleId}> `;
        allowedMentions.roles = [settings.notificationRoleId];
    } else if (settings.notificationUserId) {
        prefix = `<@${settings.notificationUserId}> `;
        allowedMentions.users = [settings.notificationUserId];
    }

    return {
        content: `${prefix}${text}`,
        allowedMentions
    };
}

async function upsertStatusNotification(status, detail) {
    if (!notificationChannel) {
        return;
    }

    currentServerStatus = String(status || 'connecting').trim().toLowerCase();

    try {
        const content = buildStatusMessageContent(currentServerStatus, detail);
        let message = await fetchExistingStatusMessage();

        if (message) {
            await message.edit({
                content,
                allowedMentions: { parse: [] }
            });
        } else {
            message = await notificationChannel.send({
                content,
                allowedMentions: { parse: [] }
            });
            statusMessageId = message.id;
        }

        writeStatusState({
            channelId: notificationChannel.id,
            messageId: message.id,
            status: currentServerStatus,
            updatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Failed to upsert SWG chat status notification:', error);
    }
}

function buildRelayContent(message) {
    const parts = [];
    const text = String(message.cleanContent || message.content || '').trim();

    if (text) {
        parts.push(text);
    }

    const attachmentUrls = Array.from(message.attachments.values())
        .map((attachment) => String(attachment.url || '').trim())
        .filter(Boolean);

    if (attachmentUrls.length > 0) {
        parts.push(attachmentUrls.join(' '));
    }

    return parts.join(' ').trim();
}

async function relayGameChatToDiscord(message, player) {
    if (!chatChannel) {
        return;
    }

    if (verboseDiscordLoggingEnabled()) {
        console.log(`[SWG Chat] game -> Discord | ${player}: ${message}`);
    }

    try {
        await chatChannel.send({
            content: `**${player}:** ${message}`,
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error('Failed to relay SWG chat message to Discord:', error);
    }
}

function attachSwgCallbacks() {
    const settings = getSettings();

    swgChatClient.recvChat = relayGameChatToDiscord;
    swgChatClient.serverDown = function () {
        upsertStatusNotification('down', 'The chat bridge lost contact with the server.');
    };
    swgChatClient.serverUp = function () {
        upsertStatusNotification('up', 'The chat bridge is connected and receiving server chat.');
    };
    swgChatClient.reconnected = function () {
        const state = swgChatClient.getState();
        upsertStatusNotification('up', `Connected as ${state.character || settings.character} in room ${state.chatRoom || settings.chatRoom}.`);
        logToBotChannel(
            statusDiscordClient,
            `SWG chat bridge connected as ${state.character || settings.character} in room ${state.chatRoom || settings.chatRoom} via ${getChatClientLabel()}.`
        );
    };
    swgChatClient.recvTell = function (from, message) {
        const normalizedFrom = String(from || '').trim().toLowerCase();
        const normalizedCharacter = String(settings.character || '').trim().toLowerCase();

        if (!normalizedFrom || normalizedFrom === normalizedCharacter) {
            return;
        }

        console.log(`[SWG Chat] tell from ${from}: ${message}`);

        if (settings.autoReplyToUnknownTells) {
            swgChatClient.sendTell(from, settings.autoReplyToUnknownTells);
        }
    };
}

async function startSwgChatBridge(client) {
    if (!bridgeEnabled()) {
        return false;
    }

    if (started) {
        return true;
    }

    if (startPromise) {
        return startPromise;
    }

    startPromise = (async () => {
        try {
            const settings = getSettings();
            const missing = getMissingSettings(settings);

            if (missing.length > 0) {
                console.warn(`SWG chat bridge is enabled but missing settings: ${missing.join(', ')}`);
                return false;
            }

            statusDiscordClient = client;
            chatDiscordClient = usesSeparateChatClient()
                ? await startSecondaryChatDiscordClient()
                : client;

            chatChannel = await resolveTextChannel(chatDiscordClient, settings.chatChannelId, settings.chatChannelName);
            notificationChannel = await resolveTextChannel(client, settings.notificationChannelId, settings.notificationChannelName);
            const storedState = readStatusState();

            if (storedState && notificationChannel && storedState.channelId === notificationChannel.id) {
                statusMessageId = String(storedState.messageId || '').trim();
                currentServerStatus = String(storedState.status || 'connecting').trim().toLowerCase();
            }

            if (!chatChannel) {
                console.warn('SWG chat bridge could not find the configured Discord chat channel.');
                return false;
            }

            attachSwgCallbacks();

            swgChatClient.login({
                LoginAddress: settings.loginAddress,
                LoginPort: settings.loginPort,
                Username: settings.username,
                Password: settings.password,
                Character: settings.character,
                ChatRoom: settings.chatRoom,
                SWGServerName: settings.serverName,
                verboseSWGLogging: settings.verboseSwgLogging,
                verboseDiscordLogging: settings.verboseDiscordLogging,
                defaultTellResponse: settings.autoReplyToUnknownTells,
                connectionTimeoutMs: settings.connectionTimeoutMs,
                failureThreshold: settings.failureThreshold
            });

            started = true;

            if (notificationChannel) {
                await upsertStatusNotification(
                    currentServerStatus || 'connecting',
                    `Connecting as ${settings.character} to room ${settings.chatRoom}.`
                );
            }

            await logToBotChannel(
                client,
                `SWG chat bridge enabled for #${chatChannel.name} using character ${settings.character} via ${getChatClientLabel()}.`
            );

            return true;
        } catch (error) {
            console.error('SWG chat bridge startup failed:', error);

            try {
                await logToBotChannel(client, `SWG chat bridge failed to start: ${error.message}`);
            } catch (logError) {
                console.error('Failed to log SWG chat bridge startup error:', logError);
            }

            return false;
        }
    })().finally(() => {
        startPromise = null;
    });

    return startPromise;
}

async function handleDiscordMessage(message, client) {
    if (!bridgeEnabled() || !started || !chatChannel) {
        return false;
    }

    if (usesSeparateChatClient()) {
        if (!chatDiscordClient || !chatDiscordClient.user || !client || !client.user) {
            return false;
        }

        if (client.user.id !== chatDiscordClient.user.id) {
            return false;
        }
    }

    if (!message.guild || message.channel.id !== chatChannel.id) {
        return false;
    }

    const relayContent = buildRelayContent(message);
    if (!relayContent) {
        return true;
    }

    const sender = message.member && message.member.displayName
        ? message.member.displayName
        : message.author.displayName || message.author.username;

    if (verboseDiscordLoggingEnabled()) {
        console.log(`[SWG Chat] Discord -> game | ${sender}: ${relayContent}`);
    }

    swgChatClient.sendChat(relayContent, sender);
    return true;
}

function getSwgChatState() {
    return Object.assign(
        {
            enabled: bridgeEnabled(),
            started,
            chatChannelId: chatChannel ? chatChannel.id : '',
            chatChannelName: chatChannel ? chatChannel.name : '',
            notificationChannelId: notificationChannel ? notificationChannel.id : '',
            notificationChannelName: notificationChannel ? notificationChannel.name : '',
            notificationMessageId: statusMessageId,
            serverStatus: formatStatusLabel(currentServerStatus),
            chatClientTag: getChatClientLabel(),
            usingSeparateChatClient: usesSeparateChatClient()
        },
        swgChatClient.getState()
    );
}

function toggleSwgChatPause(forceValue) {
    if (typeof forceValue === 'boolean') {
        return swgChatClient.setPaused(forceValue);
    }

    return swgChatClient.setPaused(!swgChatClient.paused);
}

function restartSwgChatBridge() {
    if (!started) {
        return false;
    }

    swgChatClient.restart();
    return true;
}

function enableSwgChatDebug() {
    swgChatClient.debug();
    return true;
}

module.exports = {
    enableSwgChatDebug,
    getSwgChatState,
    handleDiscordMessage,
    restartSwgChatBridge,
    startSwgChatBridge,
    toggleSwgChatPause
};
