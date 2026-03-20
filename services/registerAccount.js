const crypto = require('crypto');
const pool = require('./database');
const config = require('../config');
const { logToBotChannel } = require('./logging');

function makeSalt(stationId) {
    const saltFull = crypto.createHash('sha256').update(String(stationId)).digest('hex');
    return saltFull.substring(0, 32);
}

function makePasswordHash(password, salt) {
    return crypto.createHash('sha256').update(config.dbSecret + password + salt).digest('hex');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function registerUser(username, password, email, client, message) {
    if (!config.dbSecret) {
        return { success: false, message: 'DB_SECRET is not configured.' };
    }

    const normalizedUsername = String(username || '').trim();
    const normalizedEmail = String(email || '').trim();

    if (!normalizedUsername || !password || !normalizedEmail) {
        return { success: false, message: 'Username, email, and password are required.' };
    }

    if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
        return { success: false, message: 'Username must be between 3 and 30 characters.' };
    }

    if (!isValidEmail(normalizedEmail) || normalizedEmail.length > 100) {
        return { success: false, message: 'A valid email address is required.' };
    }

    if (String(password).length < 6 || String(password).length > 30) {
        return { success: false, message: 'Password must be between 6 and 30 characters.' };
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [existingUserRows] = await connection.execute(
            'SELECT COUNT(*) AS count FROM accounts WHERE username = ? LIMIT 1',
            [normalizedUsername]
        );

        if (existingUserRows[0].count > 0) {
            await connection.rollback();
            return { success: false, message: 'Username already exists.' };
        }

        const [existingEmailRows] = await connection.execute(
            'SELECT COUNT(*) AS count FROM register WHERE email = ? LIMIT 1',
            [normalizedEmail]
        );

        if (existingEmailRows[0].count > 0) {
            await connection.rollback();
            return { success: false, message: 'Email already exists.' };
        }

        const stationId = crypto.randomInt(100000, 999999999);
        const salt = makeSalt(stationId);
        const passwordHash = makePasswordHash(password, salt);
        const regHash = crypto.randomBytes(16).toString('hex');

        await connection.execute(
            'INSERT INTO accounts (username, password, station_id, salt, active) VALUES (?, ?, ?, ?, ?)',
            [normalizedUsername, passwordHash, stationId, salt, 0]
        );

        await connection.execute(
            'INSERT INTO register (username, email, reghash) VALUES (?, ?, ?)',
            [normalizedUsername, normalizedEmail, regHash]
        );

        await connection.commit();

        await logToBotChannel(
            client,
            `✅ New account registered: \`${normalizedUsername}\`${message ? ` by ${message.author.tag}` : ''}`
        );

        return {
            success: true,
            username: normalizedUsername,
            email: normalizedEmail,
            stationId
        };
    } catch (error) {
        await connection.rollback();
        console.error('Registration error:', error);
        await logToBotChannel(client, `❌ Registration failed for \`${normalizedUsername}\`: ${error.message}`);

        return { success: false, message: 'Internal error during registration.' };
    } finally {
        connection.release();
    }
}

module.exports = {
    registerUser
};