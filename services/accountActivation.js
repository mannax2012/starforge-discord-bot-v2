const pool = require('./database');

async function activateAccountByUsername(username) {
    const normalizedUsername = String(username || '').trim();

    if (!normalizedUsername) {
        return { success: false, message: 'Username is required.' };
    }

    const connection = await pool.getConnection();

    try {
        const [rows] = await connection.execute(
            'SELECT username, active FROM accounts WHERE username = ? LIMIT 1',
            [normalizedUsername]
        );

        if (!rows.length) {
            return { success: false, message: 'Account not found.' };
        }

        const account = rows[0];

        if (Number(account.active) === 1) {
            return { success: false, alreadyActive: true, message: 'Account is already active.' };
        }

        await connection.execute(
            'UPDATE accounts SET active = 1 WHERE username = ? LIMIT 1',
            [normalizedUsername]
        );

        return {
            success: true,
            username: normalizedUsername
        };
    } finally {
        connection.release();
    }
}

module.exports = {
    activateAccountByUsername
};