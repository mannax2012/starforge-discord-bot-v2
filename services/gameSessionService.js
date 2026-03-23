const crypto = require('crypto');
const pool = require('./database');
const config = require('../config');

function makeSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function getExpiryTimestamp() {
    const minutes = config.launcherGameSessionMinutes || 5;
    const expires = new Date(Date.now() + (minutes * 60 * 1000));
    return Math.floor(expires.getTime() / 1000);
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
    const expires = getExpiryTimestamp();
    const safeIp = String(ipAddress || '').trim() || '0.0.0.0';

    await pool.execute(
        `REPLACE INTO sessions (account_id, session_id, ip, expires)
         VALUES (?, ?, ?, ?)`,
        [
            Number(account.account_id),
            sessionId,
            safeIp,
            expires
        ]
    );

    return {
        success: true,
        statusCode: 200,
        message: 'Game session created.',
        data: {
            username: String(account.username || ''),
            sessionId,
            expiresAtUtc: new Date(expires * 1000).toISOString()
        }
    };
}

module.exports = {
    createGameSessionForUser
};