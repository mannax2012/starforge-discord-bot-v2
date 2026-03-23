const crypto = require('crypto');
const pool = require('./database');
const config = require('../config');

const launcherConfig = config.launcher || {};

function makeRawSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function toMySqlDateTimeUtc(date) {
    return (
        date.getUTCFullYear() + '-' +
        pad2(date.getUTCMonth() + 1) + '-' +
        pad2(date.getUTCDate()) + ' ' +
        pad2(date.getUTCHours()) + ':' +
        pad2(date.getUTCMinutes()) + ':' +
        pad2(date.getUTCSeconds())
    );
}

function getExpiryValues() {
    const minutes = Number(launcherConfig.launcherGameSessionMinutes || 5);
    const expiresDate = new Date(Date.now() + (minutes * 60 * 1000));

    return {
        expiresAtUtcIso: expiresDate.toISOString(),
        expiresForMySql: toMySqlDateTimeUtc(expiresDate)
    };
}

function getLaunchSettings(username, rawSessionId) {
    const loginServerAddress = String(
        launcherConfig.launcherLoginServerAddress || 'login.swg-starforge.com'
    ).trim();

    const loginServerPort = Number(launcherConfig.launcherLoginServerPort || 44553);
    const subscriptionFeatures = Number(launcherConfig.launcherSubscriptionFeatures || 1);
    const gameFeatures = Number(launcherConfig.launcherGameFeatures || 65535);

    const allowMultipleInstances =
        launcherConfig.launcherAllowMultipleInstances === undefined
            ? true
            : Boolean(launcherConfig.launcherAllowMultipleInstances);

    return {
        clientGame: {
            loginServerAddress0: loginServerAddress,
            loginServerPort0: loginServerPort,
            loginClientID: String(username || '')
        },
        station: {
            subscriptionFeatures: subscriptionFeatures,
            gameFeatures: gameFeatures,
            sessionId: String(rawSessionId || '')
        },
        swgClient: {
            allowMultipleInstances: allowMultipleInstances
        }
    };
}

function normalizeIpAddress(ipAddress) {
    let safeIp = String(ipAddress || '').trim();

    if (!safeIp) {
        safeIp = '0.0.0.0';
    }

    if (safeIp.startsWith('::ffff:')) {
        safeIp = safeIp.substring(7);
    }

    return safeIp;
}

async function createGameSessionForUser(username, ipAddress) {
    const normalizedUsername = String(username || '').trim();

    if (!normalizedUsername) {
        return {
            success: false,
            statusCode: 400,
            message: 'Username is required.'
        };
    }

    const [accountRows] = await pool.execute(
        `SELECT account_id, username, active, station_id
         FROM accounts
         WHERE username = ?
         LIMIT 1`,
        [normalizedUsername]
    );

    if (!accountRows.length) {
        return {
            success: false,
            statusCode: 404,
            message: 'Account not found.'
        };
    }

    const account = accountRows[0];

    if (Number(account.active || 0) !== 1) {
        return {
            success: false,
            statusCode: 403,
            message: 'Account is not active yet.'
        };
    }

    const rawSessionId = makeRawSessionId();
    const expiry = getExpiryValues();
    const safeIp = normalizeIpAddress(ipAddress);

    // IMPORTANT:
    // For this test, store the RAW session token exactly as returned to the launcher.
    // That keeps the bot -> launcher -> client -> server handoff identical.
    await pool.execute(
        `REPLACE INTO sessions (account_id, session_id, ip, expires)
         VALUES (?, ?, ?, ?)`,
        [
            Number(account.account_id),
            rawSessionId,
            safeIp,
            expiry.expiresForMySql
        ]
    );

    const launchSettings = getLaunchSettings(account.username, rawSessionId);

    return {
        success: true,
        statusCode: 200,
        message: 'Game session created.',
        data: {
            username: String(account.username || ''),
            stationId: String(account.station_id || ''),
            accountId: Number(account.account_id || 0),
            sessionId: rawSessionId,
            sessionIdStoredMode: 'raw',
            expiresAtUtc: expiry.expiresAtUtcIso,
            clientGame: launchSettings.clientGame,
            station: launchSettings.station,
            swgClient: launchSettings.swgClient
        }
    };
}

module.exports = {
    createGameSessionForUser
};