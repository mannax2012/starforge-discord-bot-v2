const crypto = require('crypto');
const pool = require('./database');
const config = require('../config');

function makeSessionId() {
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
    const minutes = Number(config.launcherGameSessionMinutes || 5);
    const expiresDate = new Date(Date.now() + (minutes * 60 * 1000));

    return {
        expiresAtUtcIso: expiresDate.toISOString(),
        expiresForMySql: toMySqlDateTimeUtc(expiresDate)
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

    const [accountRows] = await pool.execute(
        `SELECT account_id, username, active
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

    const sessionId = makeSessionId();
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
            sessionId,
            safeIp,
            expiry.expiresForMySql
        ]
    );

    return {
        success: true,
        statusCode: 200,
        message: 'Game session created.',
        data: {
            username: String(account.username || ''),
            sessionId: sessionId,
            expiresAtUtc: expiry.expiresAtUtcIso
        }
    };
}

module.exports = {
    createGameSessionForUser
};