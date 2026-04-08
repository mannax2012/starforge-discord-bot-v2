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

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isTcMode() {
    const mode = String(config.mode || '').trim().toLowerCase();
    return mode === 'tc' || mode === 'testcenter' || config.isTcMode === true;
}

async function mirrorActivationToTc(username) {
    const mirrorConfig = config.registrationMirror || {};
    const endpoint = String(mirrorConfig.tcActivateUrl || '').trim();
    const sharedSecret = String(mirrorConfig.tcSharedSecret || '').trim();
    const enabled = mirrorConfig.enabled !== false;

    console.log('[ActivateMirror] Starting TC activation mirror', {
        username,
        endpoint,
        enabled,
        hasSharedSecret: !!sharedSecret
    });

    if (!enabled) {
        return {
            attempted: false,
            success: false,
            message: 'TC activation mirroring disabled.'
        };
    }

    if (!endpoint) {
        return {
            attempted: true,
            success: false,
            message: 'TC activation mirror URL is not configured.'
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
        console.log('[ActivateMirror] POST', endpoint);

        response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                username: String(username || '').trim()
            })
        });

        console.log('[ActivateMirror] Response status:', response.status);
    } catch (error) {
        console.error('[ActivateMirror] FETCH FAILED', error);
        return {
            attempted: true,
            success: false,
            message: `Failed to reach TC activation mirror API: ${error.message}`
        };
    }

    try {
        json = await response.json();
        console.log('[ActivateMirror] Response JSON:', json);
    } catch (error) {
        console.error('[ActivateMirror] JSON parse failed', error);
        return {
            attempted: true,
            success: false,
            message: 'TC activation mirror API returned unreadable JSON.'
        };
    }

    if (!response.ok || !json || !json.success) {
        return {
            attempted: true,
            success: false,
            message: (json && json.message) || 'TC activation mirror API returned an error.'
        };
    }

    return {
        attempted: true,
        success: true,
        message: json.message || 'TC account activated successfully.'
    };
}

async function getAccountProfile(username) {
    const normalizedUsername = String(username || '').trim();

    if (!normalizedUsername) {
        return {
            success: false,
            statusCode: 400,
            message: 'Username is required.'
        };
    }

    const [accountRows] = await pool.execute(
        `SELECT username, active, station_id, admin_level
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

    const [registerRows] = await pool.execute(
        `SELECT email
         FROM register
         WHERE username = ?
         LIMIT 1`,
        [normalizedUsername]
    );

    const email = registerRows.length ? String(registerRows[0].email || '') : '';

    return {
        success: true,
        statusCode: 200,
        message: 'Account profile loaded.',
        data: {
            username: String(account.username || ''),
            active: Number(account.active || 0),
            station_id: account.station_id != null ? String(account.station_id) : '',
            admin_level: Number(account.admin_level || 0),
            email
        }
    };
}

async function changeEmail(username, email) {
    const normalizedUsername = String(username || '').trim();
    const normalizedEmail = String(email || '').trim();

    if (!normalizedUsername || !normalizedEmail) {
        return {
            success: false,
            statusCode: 400,
            message: 'Username and email are required.'
        };
    }

    if (!isValidEmail(normalizedEmail) || normalizedEmail.length > 100) {
        return {
            success: false,
            statusCode: 400,
            message: 'A valid email address is required.'
        };
    }

    const [accountRows] = await pool.execute(
        'SELECT username FROM accounts WHERE username = ? LIMIT 1',
        [normalizedUsername]
    );

    if (!accountRows.length) {
        return {
            success: false,
            statusCode: 404,
            message: 'Account not found.'
        };
    }

    const [existingEmailRows] = await pool.execute(
        'SELECT username FROM register WHERE email = ? AND username <> ? LIMIT 1',
        [normalizedEmail, normalizedUsername]
    );

    if (existingEmailRows.length) {
        return {
            success: false,
            statusCode: 409,
            message: 'That email address is already in use.'
        };
    }

    const [registerRows] = await pool.execute(
        'SELECT username FROM register WHERE username = ? LIMIT 1',
        [normalizedUsername]
    );

    if (registerRows.length) {
        await pool.execute(
            'UPDATE register SET email = ? WHERE username = ? LIMIT 1',
            [normalizedEmail, normalizedUsername]
        );
    } else {
        const regHash = crypto.randomBytes(16).toString('hex');

        await pool.execute(
            'INSERT INTO register (username, email, reghash) VALUES (?, ?, ?)',
            [normalizedUsername, normalizedEmail, regHash]
        );
    }

    return {
        success: true,
        statusCode: 200,
        message: 'Email updated successfully.',
        data: {
            username: normalizedUsername,
            email: normalizedEmail
        }
    };
}

async function changePassword(username, currentPassword, newPassword) {
    const normalizedUsername = String(username || '').trim();

    if (!normalizedUsername || !currentPassword || !newPassword) {
        return {
            success: false,
            statusCode: 400,
            message: 'Username, current password, and new password are required.'
        };
    }

    if (String(newPassword).length < 6 || String(newPassword).length > 30) {
        return {
            success: false,
            statusCode: 400,
            message: 'The new password must be between 6 and 30 characters.'
        };
    }

    if (!config.dbSecret) {
        return {
            success: false,
            statusCode: 500,
            message: 'DB secret is not configured on the Starforge API host.'
        };
    }

    const [rows] = await pool.execute(
        'SELECT username, password, salt FROM accounts WHERE username = ? LIMIT 1',
        [normalizedUsername]
    );

    if (!rows.length) {
        return {
            success: false,
            statusCode: 404,
            message: 'Account not found.'
        };
    }

    const account = rows[0];
    const expectedHash = String(account.password || '');
    const salt = String(account.salt || '');
    const currentHash = makePasswordHash(currentPassword, salt);

    if (!safeCompareHex(expectedHash, currentHash)) {
        return {
            success: false,
            statusCode: 401,
            message: 'Current password is incorrect.'
        };
    }

    const newHash = makePasswordHash(newPassword, salt);

    await pool.execute(
        'UPDATE accounts SET password = ? WHERE username = ? LIMIT 1',
        [newHash, normalizedUsername]
    );

    return {
        success: true,
        statusCode: 200,
        message: 'Password updated successfully.'
    };
}

async function adminResetPassword(username, newPassword) {
    const normalizedUsername = String(username || '').trim();

    if (!normalizedUsername || !newPassword) {
        return {
            success: false,
            statusCode: 400,
            message: 'Username and new password are required.'
        };
    }

    if (String(newPassword).length < 6 || String(newPassword).length > 30) {
        return {
            success: false,
            statusCode: 400,
            message: 'The new password must be between 6 and 30 characters.'
        };
    }

    if (!config.dbSecret) {
        return {
            success: false,
            statusCode: 500,
            message: 'DB secret is not configured on the Starforge API host.'
        };
    }

    const [rows] = await pool.execute(
        'SELECT username, salt FROM accounts WHERE username = ? LIMIT 1',
        [normalizedUsername]
    );

    if (!rows.length) {
        return {
            success: false,
            statusCode: 404,
            message: 'Account not found.'
        };
    }

    const salt = String(rows[0].salt || '');
    const newHash = makePasswordHash(newPassword, salt);

    await pool.execute(
        'UPDATE accounts SET password = ? WHERE username = ? LIMIT 1',
        [newHash, normalizedUsername]
    );

    return {
        success: true,
        statusCode: 200,
        message: 'Admin password reset completed.'
    };
}

async function activateAccountByUsername(username, options) {
    const opts = options || {};
    const normalizedUsername = String(username || '').trim();
    const skipTcMirror = Boolean(opts.skipTcMirror);

    console.log('[Activate] Starting activation', {
        username: normalizedUsername,
        isTcMode: isTcMode(),
        skipTcMirror
    });

    if (!normalizedUsername) {
        return {
            success: false,
            statusCode: 400,
            message: 'Username is required.'
        };
    }

    const [rows] = await pool.execute(
        'SELECT username, active FROM accounts WHERE username = ? LIMIT 1',
        [normalizedUsername]
    );

    if (!rows.length) {
        console.log('[Activate] FAILED: account not found');
        return {
            success: false,
            statusCode: 404,
            message: 'Account not found.'
        };
    }

    const account = rows[0];

    if (Number(account.active) === 1) {
        console.log('[Activate] Account already active locally');
        return {
            success: false,
            alreadyActive: true,
            statusCode: 409,
            message: 'Account is already active.'
        };
    }

    await pool.execute(
        'UPDATE accounts SET active = 1 WHERE username = ? LIMIT 1',
        [normalizedUsername]
    );

    console.log('[Activate] Local activation complete for', normalizedUsername);

    let tcMirrorActivated = false;
    let tcMirrorMessage = 'TC activation mirroring skipped.';

    if (!isTcMode() && !skipTcMirror) {
        const mirrorResult = await mirrorActivationToTc(normalizedUsername);
        tcMirrorActivated = mirrorResult.success;
        tcMirrorMessage = mirrorResult.message;

        console.log('[Activate] TC activation mirror result', {
            username: normalizedUsername,
            attempted: mirrorResult.attempted,
            success: mirrorResult.success,
            message: mirrorResult.message
        });
    } else {
        console.log('[Activate] TC activation mirror skipped', {
            username: normalizedUsername,
            isTcMode: isTcMode(),
            skipTcMirror
        });
    }

    return {
        success: true,
        statusCode: 200,
        message: 'Account activated successfully.',
        data: {
            username: normalizedUsername,
            active: 1,
            tcMirrorActivated,
            tcMirrorMessage
        }
    };
}

module.exports = {
    getAccountProfile,
    changeEmail,
    changePassword,
    adminResetPassword,
    activateAccountByUsername
};