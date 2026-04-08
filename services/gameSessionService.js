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

function normalizeChannel(options) {
    const raw = String(
        options && options.channel ? options.channel : 'Live'
    ).trim();

    return raw.toLowerCase() === 'testcenter' ? 'TestCenter' : 'Live';
}

function isTestCenterChannel(options) {
    return normalizeChannel(options) === 'TestCenter';
}

function getLaunchSettings(username, rawSessionId, options) {
    const isTestCenter = isTestCenterChannel(options);

    const loginServerAddress = String(
        isTestCenter
            ? (launcherConfig.launcherTcLoginServerAddress || launcherConfig.launcherLoginServerAddress || 'testcenter.swg-starforge.com')
            : (launcherConfig.launcherLoginServerAddress || 'login.swg-starforge.com')
    ).trim();

    const loginServerPort = Number(
        isTestCenter
            ? (launcherConfig.launcherTcLoginServerPort || launcherConfig.launcherLoginServerPort || 44453)
            : (launcherConfig.launcherLoginServerPort || 44553)
    );

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

async function loadAccount(normalizedUsername) {
    const [accountRows] = await pool.execute(
        `SELECT account_id, username, active, station_id
         FROM accounts
         WHERE username = ?
         LIMIT 1`,
        [normalizedUsername]
    );

    if (!accountRows.length) {
        return null;
    }

    return accountRows[0];
}

async function createLocalGameSession(account, ipAddress, options) {
    const rawSessionId = makeRawSessionId();
    const expiry = getExpiryValues();
    const safeIp = normalizeIpAddress(ipAddress);

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

    const launchSettings = getLaunchSettings(account.username, rawSessionId, options);

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

async function createRemoteTcGameSession(account, ipAddress, options) {
    const endpoint = String(launcherConfig.launcherTcSessionApiUrl || '').trim();

    if (!endpoint) {
        return {
            success: false,
            statusCode: 500,
            message: 'Test Center session API URL is not configured.'
        };
    }

    const sharedSecret = String(
        launcherConfig.launcherTcSessionApiKey ||
        launcherConfig.launcherTcSharedSecret ||
        ''
    ).trim();

    const payload = {
        username: String(account.username || ''),
        accountId: Number(account.account_id || 0),
        stationId: String(account.station_id || ''),
        ipAddress: normalizeIpAddress(ipAddress),
        channel: normalizeChannel(options)
    };

    const headers = {
        'Content-Type': 'application/json'
    };

    if (sharedSecret) {
        headers['X-Starforge-Key'] = sharedSecret;
    }

    let response;
    let json;

    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
    } catch (error) {
        return {
            success: false,
            statusCode: 502,
            message: `Failed to reach Test Center session API: ${error.message}`
        };
    }

    try {
        json = await response.json();
    } catch (error) {
        return {
            success: false,
            statusCode: 502,
            message: 'Test Center session API returned unreadable JSON.'
        };
    }

    if (!response.ok || !json || !json.success || !json.data) {
        return {
            success: false,
            statusCode: response.status || 502,
            message: (json && json.message) || 'Test Center session API returned an error.'
        };
    }

    return {
        success: true,
        statusCode: 200,
        message: json.message || 'Test Center game session created.',
        data: json.data
    };
}

async function createGameSessionForUser(username, ipAddress, options) {
    const normalizedUsername = String(username || '').trim();

    if (!normalizedUsername) {
        return {
            success: false,
            statusCode: 400,
            message: 'Username is required.'
        };
    }

    const account = await loadAccount(normalizedUsername);

    if (!account) {
        return {
            success: false,
            statusCode: 404,
            message: 'Account not found.'
        };
    }

    if (Number(account.active || 0) !== 1) {
        return {
            success: false,
            statusCode: 403,
            message: 'Account is not active yet.'
        };
    }

    if (isTestCenterChannel(options)) {
        return await createRemoteTcGameSession(account, ipAddress, options);
    }

    return await createLocalGameSession(account, ipAddress, options);
}

module.exports = {
    createGameSessionForUser
};