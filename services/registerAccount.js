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

async function registerUser(username, password, email, client, message) {
    if (!config.dbSecret) {
        return { success: false, message: 'DB_SECRET is not configured.' };
    }

    const normalizedUsername = String(username || '').trim();
    const normalizedEmail = String(email || '').trim();

    if (!normalizedUsername || !password || !normalizedEmail) {
        return { success: false, message: 'Username, email, and password are required.' };
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [existingRows] = await connection.execute(
            'SELECT COUNT(*) AS count FROM accounts WHERE username = ? LIMIT 1',
            [normalizedUsername]
        );

        if (existingRows[0].count > 0) {
            await connection.rollback();
            return { success: false, message: 'Username already exists.' };
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
        await logToBotChannel(client, `✅ New account registered: \`${normalizedUsername}\`${message ? ` by ${message.author.tag}` : ''}`);
        return { success: true, username: normalizedUsername };
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
