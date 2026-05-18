const crypto = require('crypto');
const pool = require('./database');
const config = require('../config');
const { formatAttemptedEndpoints, postTcApiJson } = require('../utils/tcApiFetch');
const { sendActivationSuccessEmailNotification } = require('./activationEmailService');

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

    console.log(`[ActivateMirror] Starting [username=${username}] [enabled=${enabled}] [endpoint=${endpoint || 'missing'}]`);

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

    const requestResult = await postTcApiJson(
        endpoint,
        sharedSecret,
        {
            username: String(username || '').trim()
        },
        'ActivateMirror'
    );

    if (!requestResult.ok) {
        if (requestResult.errorType === 'network') {
            console.error(`[ActivateMirror] Request failed: ${requestResult.error.message}`);
        } else {
            console.error(`[ActivateMirror] JSON parse failed: ${requestResult.error.message}`);
        }

        return {
            attempted: true,
            success: false,
            message: requestResult.errorType === 'network'
                ? `Failed to reach TC activation mirror API: ${requestResult.error.message}${formatAttemptedEndpoints(requestResult.attemptedEndpoints)}`
                : 'TC activation mirror API returned unreadable JSON.'
        };
    }

    const response = requestResult.response;
    const json = requestResult.json;

    if (!response.ok || !json || !json.success) {
        console.warn(`[ActivateMirror] Failed [username=${username}] [status=${response.status || 0}] [message=${(json && json.message) || 'Unknown mirror error'}]`);
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

async function getAccountEmail(username) {
    const normalizedUsername = String(username || '').trim();

    if (!normalizedUsername) {
        return '';
    }

    const [registerRows] = await pool.execute(
        `SELECT email
         FROM register
         WHERE username = ?
         LIMIT 1`,
        [normalizedUsername]
    );

    return registerRows.length ? String(registerRows[0].email || '').trim() : '';
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
    const activatedBy = String(opts.activatedBy || '').trim();
    const activationSource = String(opts.activationSource || '').trim();

    console.log(`[Activate] Starting [username=${normalizedUsername}] [mode=${isTcMode() ? 'tc' : 'live'}] [skipTcMirror=${skipTcMirror}]`);

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
        console.warn(`[Activate] Account not found [username=${normalizedUsername}]`);
        return {
            success: false,
            statusCode: 404,
            message: 'Account not found.'
        };
    }

    const account = rows[0];

    if (Number(account.active) === 1) {
        console.log(`[Activate] Already active [username=${normalizedUsername}]`);
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

    console.log(`[Activate] Local activation complete [username=${normalizedUsername}]`);

    let tcMirrorActivated = false;
    let tcMirrorMessage = 'TC activation mirroring skipped.';
    let activationEmailAttempted = false;
    let activationEmailSent = false;
    let activationEmailMessage = 'Activation email notification skipped.';
    let activationEmailAddress = '';

    if (!isTcMode() && !skipTcMirror) {
        const mirrorResult = await mirrorActivationToTc(normalizedUsername);
        tcMirrorActivated = mirrorResult.success;
        tcMirrorMessage = mirrorResult.message;

        console.log(`[Activate] Mirror result [username=${normalizedUsername}] [success=${mirrorResult.success}] [attempted=${mirrorResult.attempted}] [message=${mirrorResult.message}]`);
    } else {
        console.log(`[Activate] Mirror skipped [username=${normalizedUsername}] [mode=${isTcMode() ? 'tc' : 'live'}] [skipTcMirror=${skipTcMirror}]`);
    }

    if (!isTcMode()) {
        const email = await getAccountEmail(normalizedUsername);
        activationEmailAddress = email;
        const emailResult = await sendActivationSuccessEmailNotification({
            username: normalizedUsername,
            email,
            activatedBy,
            source: activationSource
        });

        activationEmailAttempted = emailResult.attempted === true;
        activationEmailSent = emailResult.success === true;
        activationEmailMessage = emailResult.message || activationEmailMessage;

        console.log(`[Activate] Email result [username=${normalizedUsername}] [attempted=${activationEmailAttempted}] [success=${activationEmailSent}] [message=${activationEmailMessage}]`);
    } else {
        activationEmailMessage = 'Activation email notification is disabled in TC mode.';
    }

    return {
        success: true,
        statusCode: 200,
        message: 'Account activated successfully.',
        data: {
            username: normalizedUsername,
            active: 1,
            tcMirrorActivated,
            tcMirrorMessage,
            activationEmailAttempted,
            activationEmailSent,
            activationEmailMessage,
            activationEmailAddress
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
