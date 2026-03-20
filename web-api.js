const express = require('express');
const config = require('./config');
const { verifyLogin } = require('./services/accountAuth');
const { registerUser } = require('./services/registerAccount');
const { postActivationReview } = require('./services/activationReview');
const {
    getAccountProfile,
    changeEmail,
    changePassword,
    adminResetPassword,
    activateAccountByUsername
} = require('./services/accountService');
const { logToBotChannel } = require('./services/logging');

function requireSharedSecret(req, res, next) {
    const provided = String(req.get('X-Starforge-Key') || '').trim();
    const expected = String(config.webListener.sharedSecret || '').trim();

    if (!expected) {
        return res.status(500).json({
            success: false,
            message: 'Web API shared secret is not configured.'
        });
    }

    if (provided !== expected) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized.'
        });
    }

    next();
}
let apiStarted = false;

function startWebApi(client) {
    if (apiStarted) {
        console.log('Starforge Web API already started. Skipping duplicate start.');
        return;
    }

    if (!config.webListener || !config.webListener.enabled) {
        console.log('Starforge Web API is disabled.');
        return;
    }

    apiStarted = true;

    const app = express();

    app.disable('x-powered-by');
    app.use(express.json({ limit: '32kb' }));
    app.use(express.urlencoded({ extended: false }));

    app.get('/api/health', function (req, res) {
        res.json({
            success: true,
            message: 'Starforge API is online.'
        });
    });

    app.post('/api/auth/login', requireSharedSecret, async function (req, res) {
        try {
            const username = req.body ? req.body.username : '';
            const password = req.body ? req.body.password : '';

            const result = await verifyLogin(username, password);

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('API login error:', error);

            return res.status(500).json({
                success: false,
                message: 'Internal authentication error.'
            });
        }
    });

    app.post('/api/auth/register', requireSharedSecret, async function (req, res) {
        try {
            const username = req.body ? req.body.username : '';
            const password = req.body ? req.body.password : '';
            const email = req.body ? req.body.email : '';

            const result = await registerUser(username, password, email, client, null);

            if (!result.success) {
                return res.status(result.statusCode || 400).json({
                    success: false,
                    message: result.message,
                    data: null
                });
            }

            const reviewResult = await postActivationReview(client, {
                username: result.username,
                email: result.email,
                requestedBy: result.username,
                source: 'website_register',
                stationId: result.stationId || ''
            });

            if (!reviewResult.success) {
                console.error('API register review post failed:', reviewResult.message);

                await logToBotChannel(
                    client,
                    `⚠️ Account \`${result.username}\` was created through website API, but activation review posting failed.`
                );

                return res.status(500).json({
                    success: false,
                    message: 'Account created, but activation review posting failed.',
                    data: {
                        username: result.username,
                        accountStatus: 'inactive'
                    }
                });
            }

            return res.status(201).json({
                success: true,
                message: 'Account created and submitted for staff activation review.',
                data: {
                    username: result.username,
                    email: result.email,
                    stationId: result.stationId || null,
                    accountStatus: 'inactive'
                }
            });
        } catch (error) {
            console.error('API register error:', error);

            try {
                await logToBotChannel(client, `❌ API register error: ${error.message}`);
            } catch (logError) {
                console.error('Failed to log register API error to bot channel:', logError);
            }

            return res.status(500).json({
                success: false,
                message: 'Internal registration error.'
            });
        }
    });

    app.post('/api/account/profile', requireSharedSecret, async function (req, res) {
        try {
            const username = req.body ? req.body.username : '';
            const result = await getAccountProfile(username);

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('API account profile error:', error);

            return res.status(500).json({
                success: false,
                message: 'Internal account profile error.',
                data: null
            });
        }
    });

    app.post('/api/account/change-email', requireSharedSecret, async function (req, res) {
        try {
            const username = req.body ? req.body.username : '';
            const email = req.body ? req.body.email : '';

            const result = await changeEmail(username, email);

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('API change-email error:', error);

            return res.status(500).json({
                success: false,
                message: 'Internal email update error.',
                data: null
            });
        }
    });

    app.post('/api/account/change-password', requireSharedSecret, async function (req, res) {
        try {
            const username = req.body ? req.body.username : '';
            const currentPassword = req.body ? req.body.currentPassword : '';
            const newPassword = req.body ? req.body.newPassword : '';

            const result = await changePassword(username, currentPassword, newPassword);

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('API change-password error:', error);

            return res.status(500).json({
                success: false,
                message: 'Internal password update error.',
                data: null
            });
        }
    });

    app.post('/api/admin/reset-password', requireSharedSecret, async function (req, res) {
        try {
            const username = req.body ? req.body.username : '';
            const newPassword = req.body ? req.body.newPassword : '';

            const result = await adminResetPassword(username, newPassword);

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('API admin reset-password error:', error);

            return res.status(500).json({
                success: false,
                message: 'Internal admin password reset error.',
                data: null
            });
        }
    });

    app.post('/api/admin/activate-account', requireSharedSecret, async function (req, res) {
        try {
            const username = req.body ? req.body.username : '';

            const result = await activateAccountByUsername(username);

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('API admin activate-account error:', error);

            return res.status(500).json({
                success: false,
                message: 'Internal account activation error.',
                data: null
            });
        }
    });

    const host = '0.0.0.0';
    const port = config.webListener.port;

    app.listen(port, host, async function () {
        console.log(`Starforge Web API listening on http://${host}:${port}`);

        try {
            await logToBotChannel(client, `🌐 Starforge Web API listening on ${host}:${port}`);
        } catch (error) {
            console.error('Failed to log API startup to bot channel:', error);
        }
    });
}

module.exports = {
    startWebApi
};