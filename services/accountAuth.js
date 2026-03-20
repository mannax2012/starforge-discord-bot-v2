const crypto = require('crypto');
const pool = require('./database');
const config = require('../config');

function makePasswordHash(password, salt) {
    return crypto
        .createHash('sha256')
        .update(config.dbSecret + password + salt)
        .digest('hex');
}

function safeCompareHex(left, right) {
    if (
        typeof left !== 'string' ||
        typeof right !== 'string' ||
        left.length === 0 ||
        right.length === 0 ||
        left.length !== right.length
    ) {
        return false;
    }

    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function verifyLogin(username, password) {
    const normalizedUsername = String(username || '').trim();

    if (!config.dbSecret) {
        return {
            success: false,
            statusCode: 500,
            message: 'DB secret is not configured on the Starforge API host.'
        };
    }

    if (!normalizedUsername || !password) {
        return {
            success: false,
            statusCode: 400,
            message: 'Username and password are required.'
        };
    }

    const [rows] = await pool.execute(
        'SELECT username, password, salt, active FROM accounts WHERE username = ? LIMIT 1',
        [normalizedUsername]
    );

    if (!rows.length) {
        return {
            success: false,
            statusCode: 401,
            message: 'Invalid username or password.'
        };
    }

    const account = rows[0];
    const expectedHash = String(account.password || '');
    const salt = String(account.salt || '');
    const computedHash = makePasswordHash(password, salt);

    if (!safeCompareHex(expectedHash, computedHash)) {
        return {
            success: false,
            statusCode: 401,
            message: 'Invalid username or password.'
        };
    }

    const isActive = Number(account.active) === 1;

    return {
        success: true,
        statusCode: 200,
        message: isActive
            ? 'Login successful.'
            : 'Login successful. This account is not activated yet.',
        data: {
            username: account.username,
            active: isActive ? 1 : 0,
            accountStatus: isActive ? 'active' : 'inactive'
        }
    };
}

module.exports = {
    verifyLogin
};