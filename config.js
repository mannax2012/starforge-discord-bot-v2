require('dotenv').config();

function env(name, fallback = '') {
    const value = process.env[name];
    if (typeof value === 'string' && value !== '') {
        return value;
    }
    return fallback;
}

function envInt(name, fallback = 0) {
    const raw = env(name, '');
    if (raw === '') {
        return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function envBool(name, fallback = false) {
    const raw = String(env(name, fallback ? 'true' : 'false')).trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function envJson(name, fallback = null) {
    const raw = env(name, '');
    if (raw === '') {
        return fallback;
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.warn(`[config] Failed to parse ${name} as JSON: ${error.message}`);
        return fallback;
    }
}

function normalizeString(value, fallback = '') {
    if (value === undefined || value === null) {
        return fallback;
    }

    return String(value);
}

function normalizeInt(value, fallback = 0) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeBool(value, fallback = false) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    const raw = String(value).trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function normalizeStringArray(value, fallback = []) {
    const resolved = value === undefined || value === null || value === ''
        ? fallback
        : value;

    if (Array.isArray(resolved)) {
        return resolved
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
    }

    return String(resolved || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function normalizeUnsignedId(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return BigInt(value).toString();
    }

    const normalized = String(value).trim();
    if (!normalized) {
        return null;
    }

    if (/^\d+$/.test(normalized) || /^0x[0-9a-f]+$/i.test(normalized)) {
        try {
            return BigInt(normalized).toString();
        } catch (error) {
            return null;
        }
    }

    return null;
}

function normalizeUnsignedIdArray(value, fallback = []) {
    const resolved = value === undefined || value === null || value === ''
        ? fallback
        : value;

    const entries = Array.isArray(resolved)
        ? resolved
        : String(resolved || '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);

    const uniqueIds = [];
    for (const entry of entries) {
        const objectId = normalizeUnsignedId(entry);
        if (objectId === null || uniqueIds.includes(objectId)) {
            continue;
        }

        uniqueIds.push(objectId);
    }

    return uniqueIds;
}

function normalizeByte(value, fallback = 0) {
    const parsed = normalizeInt(value, fallback);
    if (parsed < 0) {
        return fallback;
    }

    if (parsed > 255) {
        return 255;
    }

    return parsed;
}

function normalizeCommandList(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
    }

    const command = String(value || '').trim();
    return command ? [command] : [];
}

function resolvePerformanceCommands(settings) {
    const explicitList = normalizeCommandList(settings.performanceCommands);
    if (explicitList.length > 0) {
        return explicitList;
    }

    const explicitCommand = String(settings.performanceCommand || '').trim();
    if (explicitCommand) {
        return [explicitCommand];
    }

    const performanceType = String(settings.performanceType || 'dance').trim().toLowerCase();
    if (performanceType === 'music') {
        const musicCommand = String(settings.musicCommand || '/startmusic').trim();
        return musicCommand ? [musicCommand] : [];
    }

    const danceCommand = String(settings.danceCommand || '/startdance').trim();
    return danceCommand ? [danceCommand] : [];
}

function resolveAdvertMessages(value, fallback = []) {
    const normalized = normalizeStringArray(value, fallback);
    if (normalized.length > 0) {
        return normalized;
    }

    const single = String(value || '').trim();
    return single ? [single] : [];
}

function buildEntertainerSettings(baseSettings, overrides = {}) {
    const merged = {
        ...baseSettings,
        ...(overrides && typeof overrides === 'object' ? overrides : {})
    };

    const advertMessages = resolveAdvertMessages(merged.advertMessages, baseSettings.advertMessages);
    const fallbackAdvertMessage = normalizeString(merged.advertMessage, '').trim();
    if (advertMessages.length === 0 && fallbackAdvertMessage) {
        advertMessages.push(fallbackAdvertMessage);
    }

    const settings = {
        loginAddress: normalizeString(merged.loginAddress, baseSettings.loginAddress),
        loginPort: normalizeInt(merged.loginPort, baseSettings.loginPort),
        username: normalizeString(merged.username, ''),
        password: normalizeString(merged.password, ''),
        character: normalizeString(merged.character, ''),
        chatRoom: normalizeString(merged.chatRoom, baseSettings.chatRoom),
        performanceType: normalizeString(merged.performanceType, 'dance').trim().toLowerCase() || 'dance',
        performanceCommand: normalizeString(merged.performanceCommand, ''),
        performanceCommands: normalizeCommandList(merged.performanceCommands),
        startupCommands: normalizeCommandList(merged.startupCommands),
        inviteCleanupCommands: normalizeCommandList(merged.inviteCleanupCommands),
        petAutoCallEnabled: normalizeBool(merged.petAutoCallEnabled, false),
        petAutoGroupEnabled: normalizeBool(merged.petAutoGroupEnabled, false),
        petAutoGroupCommand: normalizeString(merged.petAutoGroupCommand, '/tellpet group'),
        petDiscoveryEnabled: normalizeBool(merged.petDiscoveryEnabled, true),
        petDiscoveryDebug: normalizeBool(merged.petDiscoveryDebug, false),
        petControlDeviceIds: normalizeUnsignedIdArray(merged.petControlDeviceIds, baseSettings.petControlDeviceIds),
        petCallRadialId: normalizeByte(merged.petCallRadialId, 44),
        petCallPauseMs: Math.max(0, normalizeInt(merged.petCallPauseMs, 3000)),
        danceCommand: normalizeString(merged.danceCommand, '/startdance'),
        musicCommand: normalizeString(merged.musicCommand, '/startmusic'),
        flourishCommand: normalizeString(merged.flourishCommand, ''),
        startupCommandPauseMs: Math.max(0, normalizeInt(merged.startupCommandPauseMs, 3000)),
        inviteCleanupPauseMs: Math.max(0, normalizeInt(merged.inviteCleanupPauseMs, 750)),
        startupDelayMs: Math.max(0, normalizeInt(merged.startupDelayMs, 2500)),
        intervalMs: normalizeInt(merged.intervalMs, 3000),
        announceCommands: normalizeBool(merged.announceCommands, true),
        autoInviteOnTell: normalizeBool(merged.autoInviteOnTell, false),
        autoAcceptGroupInvites: normalizeBool(merged.autoAcceptGroupInvites, false),
        groupInviteAcceptCommand: normalizeString(merged.groupInviteAcceptCommand, '/join'),
        groupInviteResponsePauseMs: Math.max(0, normalizeInt(merged.groupInviteResponsePauseMs, 500)),
        advertsEnabled: normalizeBool(merged.advertsEnabled, false),
        advertIntervalMs: normalizeInt(merged.advertIntervalMs, 120000),
        advertChannels: normalizeStringArray(merged.advertChannels, ['spatialChat', 'planetSay']),
        advertMessages,
        advertMessage: advertMessages[0] || '',
        connectionTimeoutMs: normalizeInt(merged.connectionTimeoutMs, 10000),
        failureThreshold: normalizeInt(merged.failureThreshold, 3),
        reconnectBaseDelayMs: normalizeInt(merged.reconnectBaseDelayMs, 5000),
        reconnectMaxDelayMs: normalizeInt(merged.reconnectMaxDelayMs, 60000),
        reconnectJitterMs: normalizeInt(merged.reconnectJitterMs, 1500),
        reconnectStableResetMs: normalizeInt(merged.reconnectStableResetMs, 300000),
        verboseSwgLogging: normalizeBool(merged.verboseSwgLogging, false)
    };

    settings.performanceCommands = resolvePerformanceCommands(settings);
    settings.petAutoGroupDelayMs = Math.max(
        0,
        normalizeInt(merged.petAutoGroupDelayMs, settings.petCallPauseMs)
    );

    return settings;
}

const botMode = String(env('BOT_MODE', 'live')).trim().toLowerCase();
const isTcMode = botMode === 'tc' || botMode === 'testcenter';
const isLiveMode = !isTcMode;

const discordEnabled = envBool('DISCORD_ENABLED', isLiveMode);
const reviewPostsEnabled = envBool('DISCORD_REVIEW_POSTS_ENABLED', isLiveMode);
const commandsEnabled = envBool('DISCORD_COMMANDS_ENABLED', isLiveMode);
const welcomeEnabled = envBool('DISCORD_WELCOME_ENABLED', isLiveMode);
const botLogEnabled = envBool('DISCORD_BOT_LOG_ENABLED', isLiveMode);
const webApiEnabled = envBool('WEB_LISTENER_ENABLED', true);
const statusEnabled = envBool('STATUS_MONITOR_ENABLED', true);
const swgChatEnabled = envBool('SWG_CHAT_ENABLED', false);
const entBotEnabled = envBool('ENT_BOT_ENABLED', false);

const baseEntBotSettings = {
    loginAddress: env(
        'ENT_BOT_LOGIN_ADDRESS',
        isTcMode
            ? env('LAUNCHER_TC_LOGIN_SERVER_ADDRESS', 'testcenter.swg-starforge.com')
            : env('LAUNCHER_LOGIN_SERVER_ADDRESS', 'login.swg-starforge.com')
    ),
    loginPort: envInt(
        'ENT_BOT_LOGIN_PORT',
        isTcMode
            ? envInt('LAUNCHER_TC_LOGIN_SERVER_PORT', 44453)
            : envInt('LAUNCHER_LOGIN_SERVER_PORT', 44553)
    ),
    username: env('ENT_BOT_USERNAME'),
    password: env('ENT_BOT_PASSWORD'),
    character: env('ENT_BOT_CHARACTER'),
    chatRoom: env('ENT_BOT_ROOM', 'General'),
    performanceType: env('ENT_BOT_PERFORMANCE_TYPE', 'dance'),
    performanceCommand: env('ENT_BOT_PERFORMANCE_COMMAND'),
    performanceCommands: envJson('ENT_BOT_PERFORMANCE_COMMANDS', []),
    startupCommands: envJson('ENT_BOT_STARTUP_COMMANDS', []),
    inviteCleanupCommands: envJson('ENT_BOT_INVITE_CLEANUP_COMMANDS', ['/decline', '/disband']),
    petAutoCallEnabled: envBool('ENT_BOT_PET_AUTO_CALL_ENABLED', false),
    petAutoGroupEnabled: envBool('ENT_BOT_PET_AUTO_GROUP_ENABLED', false),
    petAutoGroupCommand: env('ENT_BOT_PET_AUTO_GROUP_COMMAND', '/tellpet group'),
    petDiscoveryEnabled: envBool('ENT_BOT_PET_DISCOVERY_ENABLED', true),
    petDiscoveryDebug: envBool('ENT_BOT_PET_DISCOVERY_DEBUG', false),
    petControlDeviceIds: normalizeUnsignedIdArray(env('ENT_BOT_PET_CONTROL_DEVICE_IDS', '')),
    petCallRadialId: normalizeByte(env('ENT_BOT_PET_CALL_RADIAL_ID', '44'), 44),
    petCallPauseMs: envInt('ENT_BOT_PET_CALL_PAUSE_MS', 3000),
    petAutoGroupDelayMs: envInt('ENT_BOT_PET_AUTO_GROUP_DELAY_MS', 3000),
    danceCommand: env('ENT_BOT_DANCE_COMMAND', '/startdance'),
    musicCommand: env('ENT_BOT_MUSIC_COMMAND', '/startmusic'),
    flourishCommand: env('ENT_BOT_FLOURISH_COMMAND', '/flourish'),
    startupCommandPauseMs: envInt('ENT_BOT_STARTUP_COMMAND_PAUSE_MS', 3000),
    inviteCleanupPauseMs: envInt('ENT_BOT_INVITE_CLEANUP_PAUSE_MS', 750),
    startupDelayMs: envInt('ENT_BOT_STARTUP_DELAY_MS', 2500),
    intervalMs: envInt('ENT_BOT_INTERVAL_MS', 3000),
    announceCommands: envBool('ENT_BOT_ANNOUNCE_COMMANDS', true),
    autoInviteOnTell: envBool('ENT_BOT_AUTO_INVITE_ON_TELL', false),
    autoAcceptGroupInvites: envBool('ENT_BOT_AUTO_ACCEPT_GROUP_INVITES', false),
    groupInviteAcceptCommand: env('ENT_BOT_GROUP_INVITE_ACCEPT_COMMAND', '/join'),
    groupInviteResponsePauseMs: envInt('ENT_BOT_GROUP_INVITE_RESPONSE_PAUSE_MS', 500),
    advertsEnabled: envBool('ENT_BOT_ADVERTS_ENABLED', false),
    advertIntervalMs: envInt('ENT_BOT_ADVERT_INTERVAL_MS', 120000),
    advertChannels: normalizeStringArray(env('ENT_BOT_ADVERT_CHANNELS', 'spatialChat,planetSay')),
    advertMessages: resolveAdvertMessages(
        envJson('ENT_BOT_ADVERT_MESSAGES', []),
        [
            env(
                'ENT_BOT_ADVERT_MESSAGE',
                env(
                    'ENT_BOT_ADVERT_MESSAGE_1',
                    'Buff service available in Mos Eisley Cantina. Come get your entertainer buffs.'
                )
            ),
            env('ENT_BOT_ADVERT_MESSAGE_2', '')
        ]
    ),
    connectionTimeoutMs: envInt('ENT_BOT_CONNECTION_TIMEOUT_MS', 10000),
    failureThreshold: envInt('ENT_BOT_FAILURE_THRESHOLD', 3),
    reconnectBaseDelayMs: envInt('ENT_BOT_RECONNECT_BASE_DELAY_MS', 5000),
    reconnectMaxDelayMs: envInt('ENT_BOT_RECONNECT_MAX_DELAY_MS', 60000),
    reconnectJitterMs: envInt('ENT_BOT_RECONNECT_JITTER_MS', 1500),
    reconnectStableResetMs: envInt('ENT_BOT_RECONNECT_STABLE_RESET_MS', 300000),
    verboseSwgLogging: envBool('ENT_BOT_VERBOSE_SWG_LOGGING', false)
};

const configuredEntertainers = envJson('ENT_BOT_ENTERTAINERS', []);
const entertainers = Array.isArray(configuredEntertainers) && configuredEntertainers.length > 0
    ? configuredEntertainers.map((entertainer) => buildEntertainerSettings(baseEntBotSettings, entertainer))
    : [buildEntertainerSettings(baseEntBotSettings)];

module.exports = {
    mode: isTcMode ? 'tc' : 'live',
    isLiveMode,
    isTcMode,

    features: {
        discordEnabled,
        reviewPostsEnabled,
        commandsEnabled,
        welcomeEnabled,
        botLogEnabled,
        webApiEnabled,
        statusEnabled,
        swgChatEnabled,
        entBotEnabled
    },

    token: env('DISCORD_TOKEN'),
    prefix: env('COMMAND_PREFIX', '!'),
    autoRoleName: env('AUTO_ROLE_NAME', 'Player'),
    playerRoleId: env('PLAYER_ROLE_ID'),
    playerRoleName: env('PLAYER_ROLE_NAME', 'Player'),
    adminRoleId: env('ADMIN_ROLE_ID'),
    adminRoleName: env('ADMIN_ROLE_NAME', 'Starforge Admin'),
    welcomeChannelName: env('WELCOME_CHANNEL_NAME', 'general'),
    accountReviewChannelId: env('ACCOUNT_REVIEW_CHANNEL_ID'),
    botLogChannelId: env('BOT_LOG_CHANNEL_ID'),
    patchNotesChannelId: env('PATCH_NOTES_CHANNEL_ID'),
    downloadUrl: env('DOWNLOAD_URL', 'https://download.swg-starforge.com/StarforgeInstaller.exe?v=1'),

    webListener: {
        enabled: webApiEnabled,
        port: envInt('WEB_LISTENER_PORT', isTcMode ? 44567 : 44557),
        path: env('WEB_LISTENER_PATH', '/notify'),
        sharedSecret: env('WEBHOOK_SHARED_SECRET')
    },

    launcher: {
        launcherGameSessionMinutes: envInt('LAUNCHER_GAME_SESSION_MINUTES', 5),

        launcherLoginServerAddress: env('LAUNCHER_LOGIN_SERVER_ADDRESS', 'login.swg-starforge.com'),
        launcherLoginServerPort: envInt('LAUNCHER_LOGIN_SERVER_PORT', 44553),

        launcherTcLoginServerAddress: env('LAUNCHER_TC_LOGIN_SERVER_ADDRESS', 'testcenter.swg-starforge.com'),
        launcherTcLoginServerPort: envInt('LAUNCHER_TC_LOGIN_SERVER_PORT', 44453),

        launcherSubscriptionFeatures: envInt('LAUNCHER_SUBSCRIPTION_FEATURES', 1),
        launcherGameFeatures: envInt('LAUNCHER_GAME_FEATURES', 65535),
        launcherAllowMultipleInstances: envBool('LAUNCHER_ALLOW_MULTIPLE_INSTANCES', true),

        launcherTcSessionApiUrl: env('LAUNCHER_TC_SESSION_API_URL', 'http://testcenter.swg-starforge.com:44567/api/internal/tc-game-session'),
        launcherTcSessionApiKey: env('LAUNCHER_TC_SESSION_API_KEY', '')
    },

    registrationMirror: {
        enabled: envBool('TC_MIRROR_ENABLED', true),
        tcRegisterUrl: env('TC_REGISTER_MIRROR_URL', 'http://testcenter.swg-starforge.com:44567/api/internal/register-mirror'),
        tcActivateUrl: env('TC_ACTIVATE_MIRROR_URL', 'http://testcenter.swg-starforge.com:44567/api/internal/activate-mirror'),
        tcStatusUrl: env('TC_ACCOUNT_STATUS_URL', 'http://testcenter.swg-starforge.com:44567/api/internal/account-status'),
        tcImportUrl: env('TC_ACCOUNT_IMPORT_URL', 'http://testcenter.swg-starforge.com:44567/api/internal/import-account'),
        tcSharedSecret: env('TC_SHARED_SECRET', env('LAUNCHER_TC_SESSION_API_KEY', ''))
    },

    accountNotifications: {
        activationEmailEnabled: envBool('ACTIVATION_EMAIL_ENABLED', isLiveMode),
        activationEmailUrl: env('ACTIVATION_EMAIL_URL', ''),
        activationEmailSharedSecret: env('ACTIVATION_EMAIL_SHARED_SECRET', env('WEBHOOK_SHARED_SECRET', '')),
        activationEmailTimeoutMs: envInt('ACTIVATION_EMAIL_TIMEOUT_MS', 10000)
    },

    serverStatus: {
        enabled: statusEnabled,
        host: env('STATUS_HOST', '127.0.0.1'),
        port: envInt('STATUS_PORT', isTcMode ? 44465 : 44555),
        timeoutMs: envInt('STATUS_TIMEOUT_MS', 7000),
        intervalMs: envInt('STATUS_INTERVAL_MS', 30000),
        failureThreshold: envInt('STATUS_FAILURE_THRESHOLD', 5),
        keepAliveGraceMs: envInt('STATUS_KEEPALIVE_GRACE_MS', 180000),
        outputPath: env(
            'STATUS_OUTPUT_PATH',
            isTcMode
                ? '/var/www/html/website/server_status_tc.json'
                : '/var/www/html/website/server_status.json'
        ),
        statePath: env(
            'STATUS_STATE_PATH',
            isTcMode
                ? './data/server_status_state_tc.json'
                : './data/server_status_state.json'
        )
    },

    swgChatBridge: {
        enabled: swgChatEnabled,
        serverName: env('SWG_CHAT_SERVER_NAME', isTcMode ? 'Starforge Test Center' : 'Starforge'),
        discordToken: env('SWG_CHAT_DISCORD_TOKEN', env('HOLO_NET_DISCORD_TOKEN')),
        loginAddress: env(
            'SWG_CHAT_LOGIN_ADDRESS',
            isTcMode
                ? env('LAUNCHER_TC_LOGIN_SERVER_ADDRESS', 'testcenter.swg-starforge.com')
                : env('LAUNCHER_LOGIN_SERVER_ADDRESS', 'login.swg-starforge.com')
        ),
        loginPort: envInt(
            'SWG_CHAT_LOGIN_PORT',
            isTcMode
                ? envInt('LAUNCHER_TC_LOGIN_SERVER_PORT', 44453)
                : envInt('LAUNCHER_LOGIN_SERVER_PORT', 44553)
        ),
        username: env('SWG_CHAT_USERNAME'),
        password: env('SWG_CHAT_PASSWORD'),
        character: env('SWG_CHAT_CHARACTER'),
        chatRoom: env('SWG_CHAT_ROOM'),
        chatChannelId: env('SWG_CHAT_CHANNEL_ID'),
        chatChannelName: env('SWG_CHAT_CHANNEL_NAME'),
        notificationChannelId: env('SWG_CHAT_NOTIFICATION_CHANNEL_ID'),
        notificationChannelName: env('SWG_CHAT_NOTIFICATION_CHANNEL_NAME'),
        notificationRoleId: env('SWG_CHAT_NOTIFICATION_ROLE_ID'),
        notificationUserId: env('SWG_CHAT_NOTIFICATION_USER_ID'),
        autoReplyToUnknownTells: env('SWG_CHAT_TELL_AUTO_REPLY', "[Chat Bot] This message is automated: Please contact server administration for any questions or issues."),
        connectionTimeoutMs: envInt('SWG_CHAT_CONNECTION_TIMEOUT_MS', 10000),
        failureThreshold: envInt('SWG_CHAT_FAILURE_THRESHOLD', 3),
        reconnectBaseDelayMs: envInt('SWG_CHAT_RECONNECT_BASE_DELAY_MS', 5000),
        reconnectMaxDelayMs: envInt('SWG_CHAT_RECONNECT_MAX_DELAY_MS', 60000),
        reconnectJitterMs: envInt('SWG_CHAT_RECONNECT_JITTER_MS', 1500),
        reconnectStableResetMs: envInt('SWG_CHAT_RECONNECT_STABLE_RESET_MS', 300000),
        verboseSwgLogging: envBool('SWG_CHAT_VERBOSE_SWG_LOGGING', false),
        verboseDiscordLogging: envBool('SWG_CHAT_VERBOSE_DISCORD_LOGGING', false)
    },

    entBot: {
        enabled: entBotEnabled,
        ...baseEntBotSettings,
        entertainers,
        bandEnabled: entertainers.length > 1
    },

    db: {
        host: env('DB_HOST', '127.0.0.1'),
        port: envInt('DB_PORT', 3306),
        user: env('DB_USER', 'swgemu'),
        password: env('DB_PASSWORD'),
        database: env('DB_NAME', 'swgemu'),
        charset: 'utf8mb4'
    },

    dbSecret: env('DB_SECRET')
};
