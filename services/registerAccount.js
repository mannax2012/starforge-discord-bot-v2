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

function isTcMode() {
    const mode = String(config.mode || '').trim().toLowerCase();
    return mode === 'tc' || mode === 'testcenter' || config.isTcMode === true;
}

async function generateUniqueStationId(connection, maxAttempts = 25) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const stationId = crypto.randomInt(100000, 999999999);
        const [rows] = await connection.execute(
            'SELECT COUNT(*) AS count FROM accounts WHERE station_id = ? LIMIT 1',
            [stationId]
        );

        if (Number(rows[0] && rows[0].count || 0) === 0) {
            return stationId;
        }
    }

    throw new Error('Unable to allocate a unique station ID.');
}

async function mirrorAccountToTc(username, password, email) {
    const mirrorConfig = config.registrationMirror || {};
    const endpoint = String(mirrorConfig.tcRegisterUrl || '').trim();
    const sharedSecret = String(mirrorConfig.tcSharedSecret || '').trim();
    const enabled = mirrorConfig.enabled !== false;

    console.log('[RegisterMirror] Starting TC mirror', {
        username,
        endpoint,
        enabled,
        hasSharedSecret: !!sharedSecret
    });

    if (!enabled) {
        console.log('[RegisterMirror] Skipped: mirroring disabled');
        return {
            attempted: false,
            success: false,
            message: 'TC mirroring disabled.'
        };
    }

    if (!endpoint) {
        console.log('[RegisterMirror] FAILED: tcRegisterUrl missing');
        return {
            attempted: true,
            success: false,
            message: 'TC mirror URL is not configured.'
        };
    }

    const headers = {
        'Content-Type': 'application/json'
    };

    if (sharedSecret) {
        headers['X-Starforge-Key'] = sharedSecret;
    }

    let response;
    let json;

    try {
        console.log('[RegisterMirror] POST', endpoint);

        response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                username: String(username || '').trim(),
                password: String(password || ''),
                email: String(email || '').trim()
            })
        });

        console.log('[RegisterMirror] Response status:', response.status);
    } catch (error) {
        console.error('[RegisterMirror] FETCH FAILED', error);
        return {
            attempted: true,
            success: false,
            message: `Failed to reach TC mirror registration API: ${error.message}`
        };
    }

    try {
        json = await response.json();
        console.log('[RegisterMirror] Response JSON:', json);
    } catch (error) {
        console.error('[RegisterMirror] JSON parse failed', error);
        return {
            attempted: true,
            success: false,
            message: 'TC mirror registration API returned unreadable JSON.'
        };
    }

    if (!response.ok || !json || !json.success) {
        console.log('[RegisterMirror] FAILED', {
            ok: response.ok,
            message: (json && json.message) || 'Unknown mirror error'
        });

        return {
            attempted: true,
            success: false,
            message: (json && json.message) || 'TC mirror registration API returned an error.'
        };
    }

    console.log('[RegisterMirror] SUCCESS for', username);

    return {
        attempted: true,
        success: true,
        message: json.message || 'TC account created successfully.'
    };
}

async function registerUser(username, password, email, client, message, options) {
    const opts = options || {};
    const normalizedUsername = String(username || '').trim();
    const normalizedEmail = String(email || '').trim();
    const suppressBotLog = Boolean(opts.suppressBotLog);
    const skipTcMirror = Boolean(opts.skipTcMirror);

    console.log('[Register] Starting registration', {
        username: normalizedUsername,
        email: normalizedEmail,
        isTcMode: isTcMode(),
        suppressBotLog,
        skipTcMirror
    });

    if (!config.dbSecret) {
        console.log('[Register] FAILED: DB_SECRET is missing');
        return { success: false, statusCode: 500, message: 'DB_SECRET is not configured.' };
    }

    if (!normalizedUsername || !password || !normalizedEmail) {
        console.log('[Register] FAILED: missing username/email/password');
        return { success: false, statusCode: 400, message: 'Username, email, and password are required.' };
    }

    if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
        console.log('[Register] FAILED: username length invalid');
        return { success: false, statusCode: 400, message: 'Username must be between 3 and 30 characters.' };
    }

    if (!isValidEmail(normalizedEmail) || normalizedEmail.length > 100) {
        console.log('[Register] FAILED: invalid email');
        return { success: false, statusCode: 400, message: 'A valid email address is required.' };
    }

    if (String(password).length < 6 || String(password).length > 30) {
        console.log('[Register] FAILED: password length invalid');
        return { success: false, statusCode: 400, message: 'Password must be between 6 and 30 characters.' };
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();
        console.log('[Register] DB transaction started for', normalizedUsername);

        const [existingUserRows] = await connection.execute(
            'SELECT COUNT(*) AS count FROM accounts WHERE username = ? LIMIT 1',
            [normalizedUsername]
        );

        console.log('[Register] Existing username count:', existingUserRows[0].count);

        if (existingUserRows[0].count > 0) {
            await connection.rollback();
            console.log('[Register] FAILED: username already exists');
            return { success: false, statusCode: 409, message: 'Username already exists.' };
        }

        const [existingEmailRows] = await connection.execute(
            'SELECT COUNT(*) AS count FROM register WHERE email = ? LIMIT 1',
            [normalizedEmail]
        );

        console.log('[Register] Existing email count:', existingEmailRows[0].count);

        if (existingEmailRows[0].count > 0) {
            await connection.rollback();
            console.log('[Register] FAILED: email already exists');
            return { success: false, statusCode: 409, message: 'Email already exists.' };
        }

        const stationId = await generateUniqueStationId(connection);
        const salt = makeSalt(stationId);
        const passwordHash = makePasswordHash(password, salt);
        const regHash = crypto.randomBytes(16).toString('hex');

        console.log('[Register] Creating local account row', {
            username: normalizedUsername,
            stationId
        });

        await connection.execute(
            'INSERT INTO accounts (username, password, station_id, salt, active) VALUES (?, ?, ?, ?, ?)',
            [normalizedUsername, passwordHash, stationId, salt, 0]
        );

        await connection.execute(
            'INSERT INTO register (username, email, reghash) VALUES (?, ?, ?)',
            [normalizedUsername, normalizedEmail, regHash]
        );

        await connection.commit();
        console.log('[Register] Local registration committed successfully for', normalizedUsername);

        if (!suppressBotLog) {
            await logToBotChannel(
                client,
                `✅ New account registered: \`${normalizedUsername}\`${message ? ` by ${message.author.tag}` : ''}`
            );
        }

        let tcMirrorCreated = false;
        let tcMirrorMessage = 'TC mirroring skipped.';

        if (!isTcMode() && !skipTcMirror) {
            console.log('[Register] Attempting TC mirror for', normalizedUsername);

            const mirrorResult = await mirrorAccountToTc(normalizedUsername, password, normalizedEmail);

            tcMirrorCreated = mirrorResult.success;
            tcMirrorMessage = mirrorResult.message;

            console.log('[Register] TC mirror result', {
                username: normalizedUsername,
                attempted: mirrorResult.attempted,
                success: mirrorResult.success,
                message: mirrorResult.message
            });

            if (!mirrorResult.success && mirrorResult.attempted) {
                await logToBotChannel(
                    client,
                    `⚠️ Live account \`${normalizedUsername}\` was created, but TC mirror creation failed: ${mirrorResult.message}`
                );
            }
        } else {
            console.log('[Register] TC mirror skipped', {
                username: normalizedUsername,
                isTcMode: isTcMode(),
                skipTcMirror
            });
        }

        return {
            success: true,
            statusCode: 201,
            username: normalizedUsername,
            email: normalizedEmail,
            stationId,
            tcMirrorCreated,
            tcMirrorMessage
        };
    } catch (error) {
        await connection.rollback();
        console.error('[Register] ERROR during registration for', normalizedUsername, error);

        if (!suppressBotLog) {
            await logToBotChannel(
                client,
                `❌ Registration failed for \`${normalizedUsername}\`: ${error.message}`
            );
        }

        return {
            success: false,
            statusCode: 500,
            message: 'Internal error during registration.'
        };
    } finally {
        connection.release();
        console.log('[Register] Connection released for', normalizedUsername);
    }
}

module.exports = {
    registerUser,
    generateUniqueStationId
};
