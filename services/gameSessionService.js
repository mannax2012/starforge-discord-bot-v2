const crypto = require('crypto');
const pool = require('./database');
const config = require('../config');

function makeRawSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function makePasswordHash(password, salt) {
    return crypto
        .createHash('sha256')
        .update(config.dbSecret + password + salt)
        .digest('hex');
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
    const minutes = Number(config.launcher.GameSessionMinutes || 5);
    const expiresDate = new Date(Date.now() + (minutes * 60 * 1000));

    return {
        expiresAtUtcIso: expiresDate.toISOString(),
        expiresForMySql: toMySqlDateTimeUtc(expiresDate)
    };
}

function getLaunchSettings(username, rawSessionId) {
    const loginServerAddress = String(config.launcher.LoginServerAddress || 'login.swg-starforge.com').trim();
    const loginServerPort = Number(config.launcher.LoginServerPort || 44553);
    const subscriptionFeatures = Number(config.launcher.SubscriptionFeatures || 1);
    const gameFeatures = Number(config.launcher.GameFeatures || 65535);
    const allowMultipleInstances = Boolean(
        config.launcher.AllowMultipleInstances === undefined
            ? true
            : config.launcher.AllowMultipleInstances
    );

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

async function createGameSessionForUser(username, ipAddress) {
    const normalizedUsername = String(username || '').trim();

    if (!normalizedUsername) {
        return {
            success: false,
            statusCode: 400,
            message: 'Username is required.'
        };
    }

    if (!config.dbSecret) {
        return {
            success: false,
            statusCode: 500,
            message: 'DB secret is not configured on the Starforge API host.'
        };
    }

    const [accountRows] = await pool.execute(
        `SELECT account_id, username, active, salt, station_id
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
    const salt = String(account.salt || '');
    const storedSessionId = makePasswordHash(rawSessionId, salt);
    const expiry = getExpiryValues();

    let safeIp = String(ipAddress || '').trim();
    if (!safeIp) {
        safeIp = '0.0.0.0';
    }

    if (safeIp.startsWith('::ffff:')) {
        safeIp = safeIp.substring(7);
    }

    await pool.execute(
        `REPLACE INTO sessions (account_id, session_id, ip, expires)
         VALUES (?, ?, ?, ?)`,
        [
            Number(account.account_id),
            storedSessionId,
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
            sessionIdStoredMode: 'saltedSha256',
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