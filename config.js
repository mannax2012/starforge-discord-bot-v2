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

module.exports = {
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
    downloadUrl: env('DOWNLOAD_URL', 'https://www.dropbox.com/scl/fi/16mr43e42i7onbvmvcy1k/SWG-StarforgeInstaller.exe?rlkey=9lyr7jkiaj5nfzpchgu65sety&st=fixgflf9&dl=1'),

    webListener: {
        enabled: env('WEB_LISTENER_ENABLED', 'true').toLowerCase() === 'true',
        port: envInt('WEB_LISTENER_PORT', 44467),
        path: env('WEB_LISTENER_PATH', '/notify'),
        sharedSecret: env('WEBHOOK_SHARED_SECRET')
    },

    serverStatus: {
        enabled: true,
        host: '15.204.89.4',
        port: 44465,
        timeoutMs: 7000,
        intervalMs: 30000,
        outputPath: 'D:\\xampp\\htdocs\\website\\server_status.json',
        statePath: './data/server_status_state.json'
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