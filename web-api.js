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
const { readCurrentStatus } = require('./services/statusMonitor');
const { logToBotChannel } = require('./services/logging');
const {
    issueSession,
    getSessionFromToken,
    revokeSession,
    parseBearerToken,
    cleanupExpiredSessions
} = require('./services/launcherSessionService');

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

function requireLauncherSession(req, res, next) {
    const token = parseBearerToken(req);
    const session = getSessionFromToken(token, true);

    if (!session) {
        return res.status(401).json({
            success: false,
            message: 'Launcher session is missing, invalid, or expired.',
            data: null
        });
    }

    req.launcherAccessToken = token;
    req.launcherSession = session;
    next();
}

function buildStatusFallback() {
    return {
        schemaVersion: 3,
        generatedAt: new Date().toISOString(),
        serverName: 'Starforge',
        status: 'down',
        statusLabel: 'OFFLINE',
        connectedUsers: 0,
        playerCap: 0,
        peakPlayers: 0,
        maxConnectedUsers: 0,
        serverStartTime: 0,
        uptimeSeconds: 0,
        lastChecked: 0,
        lastSuccessAt: 0,
        probeError: 'Unable to load current status from monitor.',
        transportWarning: '',
        consecutiveFailures: 0,
        users: {
            connected: 0,
            cap: 0,
            peak: 0,
            total: 0,
            deleted: 0,
            highWater: 0
        },
        summary: null,
        xml: null,
        rawXml: ''
    };
}

async function buildLauncherProfile(username) {
    const profileResult = await getAccountProfile(username);

    if (!profileResult.success || !profileResult.data) {
        return profileResult;
    }

    profileResult.data.accountStatus = Number(profileResult.data.active) === 1 ? 'active' : 'inactive';
    return profileResult;
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

    cleanupExpiredSessions();
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

    app.get('/api/status/current', requireSharedSecret, function (req, res) {
        try {
            const status = readCurrentStatus();
            return res.status(200).json(status);
        } catch (error) {
            console.error('API status current error:', error);
            return res.status(500).json(buildStatusFallback());
        }
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

    app.get('/api/launcher/status/current', function (req, res) {
        try {
            const status = readCurrentStatus();
            return res.status(200).json(status);
        } catch (error) {
            console.error('Launcher status current error:', error);
            return res.status(500).json(buildStatusFallback());
        }
    });

    app.post('/api/launcher/login', async function (req, res) {
        try {
            const username = req.body ? req.body.username : '';
            const password = req.body ? req.body.password : '';
            const rememberMe = Boolean(req.body && req.body.rememberMe);
            const clientName = req.body && req.body.clientName ? req.body.clientName : 'Starforge LaunchPad';

            const result = await verifyLogin(username, password);
            if (!result.success || !result.data) {
                return res.status(result.statusCode || 401).json({
                    success: false,
                    message: result.message,
                    data: null
                });
            }

            const session = issueSession({
                username: result.data.username,
                accountStatus: result.data.accountStatus,
                rememberMe,
                clientName
            });

            const profileResult = await buildLauncherProfile(result.data.username);
            const profile = profileResult.success ? profileResult.data : {
                username: result.data.username,
                active: result.data.active,
                station_id: '',
                admin_level: 0,
                email: '',
                accountStatus: result.data.accountStatus
            };

            return res.status(200).json({
                success: true,
                message: result.message,
                data: {
                    accessToken: session.accessToken,
                    expiresAtUtc: session.expiresAtUtc,
                    profile
                }
            });
        } catch (error) {
            console.error('Launcher login error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal launcher authentication error.',
                data: null
            });
        }
    });

    app.post('/api/launcher/logout', requireLauncherSession, async function (req, res) {
        revokeSession(req.launcherAccessToken);
        return res.status(200).json({
            success: true,
            message: 'Launcher session closed.',
            data: null
        });
    });

    app.get('/api/launcher/me', requireLauncherSession, async function (req, res) {
        try {
            const result = await buildLauncherProfile(req.launcherSession.username);
            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('Launcher me error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal launcher profile error.',
                data: null
            });
        }
    });

    app.post('/api/launcher/change-email', requireLauncherSession, async function (req, res) {
        try {
            const email = req.body ? req.body.email : '';
            const result = await changeEmail(req.launcherSession.username, email);

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('Launcher change-email error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal launcher email update error.',
                data: null
            });
        }
    });

    app.post('/api/launcher/change-password', requireLauncherSession, async function (req, res) {
        try {
            const currentPassword = req.body ? req.body.currentPassword : '';
            const newPassword = req.body ? req.body.newPassword : '';
            const result = await changePassword(req.launcherSession.username, currentPassword, newPassword);

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('Launcher change-password error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal launcher password update error.',
                data: null
            });
        }
    });

    app.post('/api/launcher/register', async function (req, res) {
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
                source: 'launcher_register',
                stationId: result.stationId || ''
            });

            if (!reviewResult.success) {
                return res.status(500).json({
                    success: false,
                    message: 'Account created, but launcher activation review posting failed.',
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
            console.error('Launcher register error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal launcher registration error.',
                data: null
            });
        }
    });

    app.post('/api/launcher/request-activation', requireLauncherSession, async function (req, res) {
        try {
            const profileResult = await buildLauncherProfile(req.launcherSession.username);
            if (!profileResult.success || !profileResult.data) {
                return res.status(profileResult.statusCode || 400).json({
                    success: false,
                    message: profileResult.message,
                    data: null
                });
            }

            if (Number(profileResult.data.active) === 1) {
                return res.status(409).json({
                    success: false,
                    message: 'This account is already active.',
                    data: {
                        username: profileResult.data.username,
                        accountStatus: 'active'
                    }
                });
            }

            const reviewResult = await postActivationReview(client, {
                username: profileResult.data.username,
                email: profileResult.data.email,
                requestedBy: profileResult.data.username,
                source: 'launcher_resend',
                stationId: profileResult.data.station_id || ''
            });

            if (!reviewResult.success) {
                return res.status(500).json({
                    success: false,
                    message: 'Activation review request could not be posted.',
                    data: null
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Activation request sent to staff review.',
                data: {
                    username: profileResult.data.username,
                    accountStatus: 'inactive'
                }
            });
        } catch (error) {
            console.error('Launcher activation request error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal launcher activation request error.',
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