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
        statusEnabled
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
    downloadUrl: env('DOWNLOAD_URL', 'https://swg-starforge.com/launcher/StarforgeInstaller.exe'),

    webListener: {
        enabled: webApiEnabled,
        port: envInt('WEB_LISTENER_PORT', isTcMode ? 44557 : 44567),
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

        launcherTcSessionApiUrl: env('LAUNCHER_TC_SESSION_API_URL', 'http://testcenter.swg-starforge.com:44557/api/internal/tc-game-session'),
        launcherTcSessionApiKey: env('LAUNCHER_TC_SESSION_API_KEY', '')
    },

    registrationMirror: {
        enabled: envBool('TC_MIRROR_ENABLED', true),
        tcRegisterUrl: env('TC_REGISTER_MIRROR_URL', 'http://testcenter.swg-starforge.com:44557/api/internal/register-mirror'),
        tcActivateUrl: env('TC_ACTIVATE_MIRROR_URL', 'http://testcenter.swg-starforge.com:44557/api/internal/activate-mirror'),
        tcStatusUrl: env('TC_ACCOUNT_STATUS_URL', 'http://testcenter.swg-starforge.com:44557/api/internal/account-status'),
        tcImportUrl: env('TC_ACCOUNT_IMPORT_URL', 'http://testcenter.swg-starforge.com:44557/api/internal/import-account'),
        tcSharedSecret: env('TC_SHARED_SECRET', env('LAUNCHER_TC_SESSION_API_KEY', ''))
    },

    serverStatus: {
        enabled: statusEnabled,
        host: env('STATUS_HOST', '127.0.0.1'),
        port: envInt('STATUS_PORT', isTcMode ? 44455 : 44555),
        timeoutMs: envInt('STATUS_TIMEOUT_MS', 7000),
        intervalMs: envInt('STATUS_INTERVAL_MS', 30000),
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
