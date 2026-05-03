const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const pool = require('./services/database');
const { verifyLogin } = require('./services/accountAuth');
const { registerUser, generateUniqueStationId } = require('./services/registerAccount');
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
const { createGameSessionForUser } = require('./services/gameSessionService');
const {
    getCachedGameSession,
    setCachedGameSession,
    clearCachedGameSessions
} = require('./services/launcherGameSessionCache');

function requireSharedSecret(req, res, next) {
    const provided = String(req.get('X-Starforge-Key') || '').trim();
    const expected = String(config.webListener && config.webListener.sharedSecret || '').trim();

    //console.log('[AuthCheck] provided =', JSON.stringify(provided), 'len=', provided.length);
    //console.log('[AuthCheck] expected =', JSON.stringify(expected), 'len=', expected.length);

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
        serverName: config.isTcMode ? 'Starforge Test Center' : 'Starforge',
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

function normalizePatchLines(lines) {
    if (!Array.isArray(lines)) {
        return [];
    }

    const clean = [];
    const seen = new Set();

    for (const value of lines) {
        const line = String(value || '')
            .replace(/\r/g, '')
            .replace(/^\d+\.\s+/, '')
            .replace(/^[^A-Za-z0-9\[]+\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!line) {
            continue;
        }

        const key = line.toLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        clean.push(line);
    }

    return clean;
}

function buildPatchNotesAnnouncementContent(payload) {
    const version = String(payload.version || '').trim();
    const date = String(payload.date || '').trim();
    const titleOverride = String(payload.title || '').trim();
    const patchNotesUrl = String(payload.patchNotesUrl || '').trim();
    const postedBy = String(payload.postedBy || '').trim();
    const changes = normalizePatchLines(payload.changes);
    const displayHeadline = titleOverride || (version ? `Update ${version} now live!` : 'Update now live!');

    const headline = titleOverride || (version ? `✨ **Starforge Patch Notes — ${version}**` : '✨ **Starforge Patch Notes**');
    const footerBits = [];

    if (date) {
        footerBits.push(`Date: ${date}`);
    }

    if (postedBy) {
        footerBits.push(`Posted by: ${postedBy}`);
    }

    const lines = [];
    lines.push(displayHeadline);

    if (changes.length > 0) {
        lines.push('');
        lines.push('Changes');
    }

    const maxLength = 1900;
    let content = lines.join('\n');

    let remaining = changes.length;

    for (const change of changes) {
        const candidate = `• ${change}`;
        const prefix = content === '' ? '' : '\n';
        const possible = content + prefix + candidate;

        if (possible.length > maxLength) {
            break;
        }

        content = possible;
        remaining -= 1;
    }

    if (remaining > 0) {
        const overflowLine = `\n• ...and ${remaining} more change${remaining === 1 ? '' : 's'}.`;
        if ((content + overflowLine).length <= maxLength) {
            content += overflowLine;
        }
    }

    if (patchNotesUrl) {
        const urlLine = `\n\nRead full patch notes: ${patchNotesUrl}`;
        if ((content + urlLine).length <= maxLength) {
            content += urlLine;
        }
    }

    if (footerBits.length > 0) {
        const footerLine = `\n\n_${footerBits.join(' • ')}_`;
        if ((content + footerLine).length <= maxLength) {
            content += footerLine;
        }
    }

    return content;
}

async function postPatchNotesAnnouncement(client, payload) {
    if (!config.features || !config.features.reviewPostsEnabled) {
        return {
            success: true,
            skipped: true,
            statusCode: 200,
            message: 'Patch notes announcement disabled in this mode.',
            data: null
        };
    }

    const channelId = String(config.patchNotesChannelId || config.botLogChannelId || '').trim();

    if (!channelId) {
        return {
            success: false,
            statusCode: 500,
            message: 'Patch notes Discord channel is not configured.',
            data: null
        };
    }

    if (!client) {
        return {
            success: false,
            statusCode: 500,
            message: 'Discord client is not available in this mode.',
            data: null
        };
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
        return {
            success: false,
            statusCode: 500,
            message: 'Configured patch notes channel could not be used for text messages.',
            data: null
        };
    }

    const content = buildPatchNotesAnnouncementContent(payload);
    if (!content.trim()) {
        return {
            success: false,
            statusCode: 400,
            message: 'Patch notes announcement content was empty.',
            data: null
        };
    }

    const message = await channel.send({
        content,
        allowedMentions: { parse: [] }
    });

    return {
        success: true,
        statusCode: 200,
        message: 'Patch notes announcement posted successfully.',
        data: {
            channelId: channel.id,
            messageId: message.id
        }
    };
}

async function maybePostActivationReview(client, payload) {
    if (!config.features || !config.features.reviewPostsEnabled) {
        return {
            success: true,
            skipped: true,
            message: 'Activation review posting disabled in this mode.'
        };
    }

    return await postActivationReview(client, payload);
}

let apiStarted = false;

async function loadLocalAccountForSync(username) {
    const normalizedUsername = String(username || '').trim();

    const [accountRows] = await pool.execute(
        `SELECT username, password, salt, station_id, active, admin_level
         FROM accounts
         WHERE username = ?
         LIMIT 1`,
        [normalizedUsername]
    );

    if (!accountRows.length) {
        return null;
    }

    const account = accountRows[0];

    const [registerRows] = await pool.execute(
        `SELECT email, reghash
         FROM register
         WHERE username = ?
         LIMIT 1`,
        [normalizedUsername]
    );

    const registerRow = registerRows.length ? registerRows[0] : null;

    return {
        username: String(account.username || ''),
        passwordHash: String(account.password || ''),
        salt: String(account.salt || ''),
        stationId: account.station_id != null ? String(account.station_id) : '',
        active: Number(account.active || 0),
        adminLevel: Number(account.admin_level || 0),
        email: registerRow ? String(registerRow.email || '') : '',
        regHash: registerRow ? String(registerRow.reghash || '') : ''
    };
}

function buildModeAccountSummary(account) {
    if (!account) {
        return {
            exists: false,
            active: false,
            stationId: '',
            email: ''
        };
    }

    return {
        exists: true,
        active: Number(account.active || 0) === 1,
        stationId: account.stationId || '',
        email: account.email || ''
    };
}

async function importAccountIntoCurrentMode(payload) {
    if (!config.isTcMode) {
        return {
            success: false,
            statusCode: 403,
            message: 'Account import is only allowed in TC mode.',
            data: null
        };
    }

    const normalizedUsername = String(payload && payload.username || '').trim();
    const passwordHash = String(payload && payload.passwordHash || '').trim();
    const salt = String(payload && payload.salt || '').trim();
    const email = String(payload && payload.email || '').trim();
    const regHash = String(payload && payload.regHash || '').trim() || crypto.randomBytes(16).toString('hex');
    const liveStationId = String(payload && payload.stationId || '').trim();
    const active = Number(payload && payload.active || 0) === 1 ? 1 : 0;
    const adminLevel = Number.parseInt(payload && payload.adminLevel, 10);
    const normalizedAdminLevel = Number.isNaN(adminLevel) ? 0 : adminLevel;
    const overwriteTc = Boolean(payload && payload.overwriteTc);

    if (!normalizedUsername) {
        return {
            success: false,
            statusCode: 400,
            message: 'Username is required.',
            data: null
        };
    }

    if (!passwordHash || !salt) {
        return {
            success: false,
            statusCode: 400,
            message: 'Password hash and salt are required.',
            data: null
        };
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [existingAccountRows] = await connection.execute(
            `SELECT username, active, station_id
             FROM accounts
             WHERE username = ?
             LIMIT 1`,
            [normalizedUsername]
        );

        if (existingAccountRows.length) {
            const existingAccount = existingAccountRows[0];
            const [existingRegisterRows] = await connection.execute(
                `SELECT email
                 FROM register
                 WHERE username = ?
                 LIMIT 1`,
                [normalizedUsername]
            );

            if (!overwriteTc) {
                await connection.rollback();

                return {
                    success: true,
                    statusCode: 200,
                    message: 'TC account already exists. No import was needed.',
                    data: {
                        username: normalizedUsername,
                        created: false,
                        updated: false,
                        overwriteApplied: false,
                        alreadyExisted: true,
                        active: Number(existingAccount.active || 0) === 1,
                        stationId: existingAccount.station_id != null ? String(existingAccount.station_id) : '',
                        email: existingRegisterRows.length ? String(existingRegisterRows[0].email || '') : '',
                        liveStationId
                    }
                };
            }

            const existingStationId = existingAccount.station_id != null
                ? Number.parseInt(existingAccount.station_id, 10)
                : null;
            const tcStationId = Number.isInteger(existingStationId) && existingStationId > 0
                ? existingStationId
                : await generateUniqueStationId(connection);

            await connection.execute(
                `UPDATE accounts
                 SET password = ?, station_id = ?, salt = ?, active = ?, admin_level = ?
                 WHERE username = ?
                 LIMIT 1`,
                [passwordHash, tcStationId, salt, active, normalizedAdminLevel, normalizedUsername]
            );

            if (existingRegisterRows.length) {
                await connection.execute(
                    `UPDATE register
                     SET email = ?, reghash = ?
                     WHERE username = ?
                     LIMIT 1`,
                    [email, regHash, normalizedUsername]
                );
            } else {
                await connection.execute(
                    `INSERT INTO register (username, email, reghash)
                     VALUES (?, ?, ?)`,
                    [normalizedUsername, email, regHash]
                );
            }

            await connection.commit();

            return {
                success: true,
                statusCode: 200,
                message: 'TC account synced from Live successfully while preserving its TC station ID.',
                data: {
                    username: normalizedUsername,
                    created: false,
                    updated: true,
                    overwriteApplied: true,
                    alreadyExisted: true,
                    active: active === 1,
                    stationId: String(tcStationId),
                    email,
                    liveStationId
                }
            };
        }

        const tcStationId = await generateUniqueStationId(connection);

        await connection.execute(
            `INSERT INTO accounts (username, password, station_id, salt, active, admin_level)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [normalizedUsername, passwordHash, tcStationId, salt, active, normalizedAdminLevel]
        );

        await connection.execute(
            `INSERT INTO register (username, email, reghash)
             VALUES (?, ?, ?)`,
            [normalizedUsername, email, regHash]
        );

        await connection.commit();

        return {
            success: true,
            statusCode: 201,
            message: 'TC account synced successfully with a TC-generated station ID.',
            data: {
                username: normalizedUsername,
                created: true,
                updated: false,
                overwriteApplied: false,
                alreadyExisted: false,
                active: active === 1,
                stationId: String(tcStationId),
                email,
                liveStationId
            }
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function queryTcAccountStatus(username) {
    const endpoint = String((config.registrationMirror && config.registrationMirror.tcStatusUrl) || '').trim();
    const sharedSecret = String((config.registrationMirror && config.registrationMirror.tcSharedSecret) || '').trim();

    if (!endpoint) {
        return {
            success: false,
            message: 'TC status API URL is not configured.',
            data: null
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
        response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({ username: String(username || '').trim() })
        });
    } catch (error) {
        return {
            success: false,
            message: `Failed to reach TC status API: ${error.message}`,
            data: null
        };
    }

    try {
        json = await response.json();
    } catch (error) {
        return {
            success: false,
            message: 'TC status API returned unreadable JSON.',
            data: null
        };
    }

    return {
        success: !!json.success,
        message: json.message || '',
        data: json.data || null
    };
}

async function syncLiveAccountToTc(username, options) {
    const endpoint = String((config.registrationMirror && config.registrationMirror.tcImportUrl) || '').trim();
    const sharedSecret = String((config.registrationMirror && config.registrationMirror.tcSharedSecret) || '').trim();
    const opts = options || {};
    const overwriteTc = Boolean(opts.overwriteTc);

    if (!endpoint) {
        return {
            success: false,
            message: 'TC import API URL is not configured.'
        };
    }

    const liveAccount = await loadLocalAccountForSync(username);
    if (!liveAccount) {
        return {
            success: false,
            statusCode: 404,
            message: 'Live account not found.'
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
        response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                ...liveAccount,
                overwriteTc
            })
        });
    } catch (error) {
        return {
            success: false,
            statusCode: 502,
            message: `Failed to reach TC import API: ${error.message}`
        };
    }

    try {
        json = await response.json();
    } catch (error) {
        return {
            success: false,
            statusCode: 502,
            message: 'TC import API returned unreadable JSON.'
        };
    }

    return {
        success: !!json.success,
        statusCode: response.status || 500,
        message: json.message || 'TC import completed.',
        data: json.data || null
    };
}

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
    app.use(express.json({ limit: '64kb' }));
    app.use(express.urlencoded({ extended: false }));

    app.get('/api/health', function (req, res) {
        res.json({
            success: true,
            mode: config.mode || 'live',
            message: 'Starforge API is online.'
        });
    });

    app.post('/api/admin/account-sync-status', requireSharedSecret, async function (req, res) {
    try {
        if (config.isTcMode) {
            return res.status(403).json({
                success: false,
                message: 'Account sync status is only available from the Live API instance.',
                data: null
            });
        }

        const username = req.body ? req.body.username : '';
        const normalizedUsername = String(username || '').trim();

        if (!normalizedUsername) {
            return res.status(400).json({
                success: false,
                message: 'Username is required.',
                data: null
            });
        }

        const liveAccount = await loadLocalAccountForSync(normalizedUsername);
        const tcStatus = await queryTcAccountStatus(normalizedUsername);

        return res.status(200).json({
            success: true,
            message: 'Account sync status loaded.',
            data: {
                username: normalizedUsername,
                live: buildModeAccountSummary(liveAccount),
                tc: tcStatus.success && tcStatus.data ? {
                    exists: !!tcStatus.data.exists,
                    active: !!tcStatus.data.active,
                    stationId: tcStatus.data.stationId || '',
                    email: tcStatus.data.email || ''
                } : {
                    exists: false,
                    active: false,
                    stationId: '',
                    email: ''
                }
            }
        });
    } catch (error) {
        console.error('[API Admin Account Sync Status] ERROR', error);

        return res.status(500).json({
            success: false,
            message: 'Internal account sync status error.',
            data: null
        });
    }
});

app.post('/api/admin/sync-account-to-tc', requireSharedSecret, async function (req, res) {
    try {
        if (config.isTcMode) {
            return res.status(403).json({
                success: false,
                message: 'Account syncing to TC is only available from the Live API instance.',
                data: null
            });
        }

        const username = req.body ? req.body.username : '';
        const overwriteTc = Boolean(req.body && req.body.overwriteTc);

        console.log('[API Admin Sync Account To TC] Request received', {
            username,
            overwriteTc,
            mode: config.mode || 'live',
            isTcMode: config.isTcMode === true
        });

        const result = await syncLiveAccountToTc(username, {
            overwriteTc
        });

        console.log('[API Admin Sync Account To TC] Result', {
            username,
            success: result.success,
            statusCode: result.statusCode,
            message: result.message,
            data: result.data || null
        });

        return res.status(result.statusCode || (result.success ? 200 : 400)).json({
            success: result.success,
            message: result.message,
            data: result.data || null
        });
    } catch (error) {
        console.error('[API Admin Sync Account To TC] ERROR', error);

        return res.status(500).json({
            success: false,
            message: 'Internal account sync error.',
            data: null
        });
    }
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
            console.log('[API Register] Request received', {
                username,
                email,
                mode: config.mode || 'live',
                isTcMode: config.isTcMode === true
            });

            const result = await registerUser(username, password, email, client, null);

            console.log('[API Register] registerUser result', {
                success: result.success,
                statusCode: result.statusCode,
                username: result.username,
                stationId: result.stationId,
                tcMirrorCreated: result.tcMirrorCreated,
                tcMirrorMessage: result.tcMirrorMessage,
                message: result.message
            });

            if (!result.success) {
                return res.status(result.statusCode || 400).json({
                    success: false,
                    message: result.message,
                    data: null
                });
            }

            const reviewResult = await maybePostActivationReview(client, {
                username: result.username,
                email: result.email,
                requestedBy: result.username,
                source: 'website_register',
                stationId: result.stationId || ''
            });

            if (config.features && config.features.reviewPostsEnabled && !reviewResult.success) {
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
                message: config.features && config.features.reviewPostsEnabled
                    ? 'Account created and submitted for staff activation review.'
                    : 'Account created successfully.',
                data: {
                    username: result.username,
                    email: result.email,
                    stationId: result.stationId || null,
                    accountStatus: 'inactive',
                    tcMirrorCreated: !!result.tcMirrorCreated,
                    tcMirrorMessage: result.tcMirrorMessage || ''
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
    
    app.post('/api/internal/activate-mirror', requireSharedSecret, async function (req, res) {
        try {
            const username = req.body ? req.body.username : '';

            console.log('[API Internal Activate Mirror] Request received', {
                username,
                mode: config.mode || 'live',
                isTcMode: config.isTcMode === true
            });

            const result = await activateAccountByUsername(username, {
                skipTcMirror: true
            });

            console.log('[API Internal Activate Mirror] Result', {
                username,
                success: result.success,
                statusCode: result.statusCode,
                message: result.message,
                data: result.data || null
            });

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('[API Internal Activate Mirror] ERROR', error);

            return res.status(500).json({
                success: false,
                message: 'Internal mirror activation error.',
                data: null
            });
        }
    });
    
    app.post('/api/internal/register-mirror', requireSharedSecret, async function (req, res) {
        try {
            const username = req.body ? req.body.username : '';
            const password = req.body ? req.body.password : '';
            const email = req.body ? req.body.email : '';

            const result = await registerUser(username, password, email, null, null, {
                suppressBotLog: true,
                skipTcMirror: true
            });

            if (!result.success) {
                return res.status(result.statusCode || 400).json({
                    success: false,
                    message: result.message,
                    data: null
                });
            }

            return res.status(201).json({
                success: true,
                message: 'Mirror account created successfully.',
                data: {
                    username: result.username,
                    email: result.email,
                    stationId: result.stationId || null,
                    accountStatus: 'inactive'
                }
            });
        } catch (error) {
            console.error('Internal mirror register error:', error);

            return res.status(500).json({
                success: false,
                message: 'Internal mirror registration error.',
                data: null
            });
        }
    });

    app.post('/api/internal/account-status', requireSharedSecret, async function (req, res) {
        try {
            if (!config.isTcMode) {
                return res.status(403).json({
                    success: false,
                    message: 'Internal account status route is only available in TC mode.',
                    data: null
                });
            }

            const username = req.body ? req.body.username : '';
            const normalizedUsername = String(username || '').trim();

            if (!normalizedUsername) {
                return res.status(400).json({
                    success: false,
                    message: 'Username is required.',
                    data: null
                });
            }

            const account = await loadLocalAccountForSync(normalizedUsername);

            return res.status(200).json({
                success: true,
                message: account ? 'TC account status loaded.' : 'TC account was not found.',
                data: {
                    username: normalizedUsername,
                    ...buildModeAccountSummary(account)
                }
            });
        } catch (error) {
            console.error('[API Internal Account Status] ERROR', error);

            return res.status(500).json({
                success: false,
                message: 'Internal account status error.',
                data: null
            });
        }
    });

    app.post('/api/internal/import-account', requireSharedSecret, async function (req, res) {
        try {
            const result = await importAccountIntoCurrentMode(req.body || {});

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('[API Internal Import Account] ERROR', error);

            return res.status(500).json({
                success: false,
                message: 'Internal account import error.',
                data: null
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

        console.log('[API Activate] Request received', {
            username,
            mode: config.mode || 'live',
            isTcMode: config.isTcMode === true
        });

        const result = await activateAccountByUsername(username);

        console.log('[API Activate] Local activation result', {
            username,
            success: result.success,
            statusCode: result.statusCode,
            message: result.message,
            data: result.data || null
        });

        return res.status(result.statusCode || (result.success ? 200 : 400)).json({
            success: result.success,
            message: result.message,
            data: result.data || null
        });
    } catch (error) {
        console.error('[API Activate] ERROR', error);

        return res.status(500).json({
            success: false,
            message: 'Internal account activation error.',
            data: null
        });
    }
});

    app.post('/api/admin/post-patch-notes', requireSharedSecret, async function (req, res) {
        try {
            const payload = {
                version: req.body ? req.body.version : '',
                date: req.body ? req.body.date : '',
                changes: req.body ? req.body.changes : [],
                patchNotesUrl: req.body ? req.body.patchNotesUrl : '',
                postedBy: req.body ? req.body.postedBy : '',
                title: req.body ? req.body.title : '',
                intro: req.body ? req.body.intro : ''
            };

            const result = await postPatchNotesAnnouncement(client, payload);

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('API patch notes announcement error:', error);

            try {
                await logToBotChannel(client, `❌ Patch notes announcement API error: ${error.message}`);
            } catch (logError) {
                console.error('Failed to log patch notes API error to bot channel:', logError);
            }

            return res.status(500).json({
                success: false,
                message: 'Internal patch notes announcement error.',
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
        clearCachedGameSessions(req.launcherAccessToken);
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

            const reviewResult = await maybePostActivationReview(client, {
                username: result.username,
                email: result.email,
                requestedBy: result.username,
                source: 'launcher_register',
                stationId: result.stationId || ''
            });

            if (config.features && config.features.reviewPostsEnabled && !reviewResult.success) {
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
                message: config.features && config.features.reviewPostsEnabled
                    ? 'Account created and submitted for staff activation review.'
                    : 'Account created successfully.',
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

            const reviewResult = await maybePostActivationReview(client, {
                username: profileResult.data.username,
                email: profileResult.data.email,
                requestedBy: profileResult.data.username,
                source: 'launcher_resend',
                stationId: profileResult.data.station_id || ''
            });

            if (config.features && config.features.reviewPostsEnabled && !reviewResult.success) {
                return res.status(500).json({
                    success: false,
                    message: 'Activation review request could not be posted.',
                    data: null
                });
            }

            return res.status(200).json({
                success: true,
                message: config.features && config.features.reviewPostsEnabled
                    ? 'Activation request sent to staff review.'
                    : 'Activation request accepted.',
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

    app.post('/api/launcher/game-session', requireLauncherSession, async function (req, res) {
        try {
            const forwardedFor = String(req.headers['x-forwarded-for'] || '').trim();
            const requestIp =
                forwardedFor.split(',')[0].trim() ||
                req.socket.remoteAddress ||
                req.ip ||
                '';

            const channelRaw = String(req.body && req.body.channel ? req.body.channel : 'Live').trim();
            const channel =
                channelRaw.toLowerCase() === 'testcenter' ||
                channelRaw.toLowerCase() === 'test center' ||
                channelRaw.toLowerCase() === 'tc'
                    ? 'TestCenter'
                    : 'Live';

            console.log('[Launcher API] /api/launcher/game-session raw=%s normalized=%s user=%s',
                channelRaw,
                channel,
                req.launcherSession.username
            );
            const cached = getCachedGameSession(req.launcherAccessToken, channel);
            if (cached) {
                return res.status(200).json({
                    success: true,
                    message: 'Using cached game session.',
                    data: cached
                });
            }

            const result = await createGameSessionForUser(
                req.launcherSession.username,
                requestIp,
                {
                    channel: channel
                }
            );

            if (result.success && result.data) {
                setCachedGameSession(req.launcherAccessToken, channel, result.data);
            }

            return res.status(result.statusCode || (result.success ? 200 : 400)).json({
                success: result.success,
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            console.error('Launcher game-session error:', error);

            return res.status(500).json({
                success: false,
                message: 'Internal launcher game-session error.',
                data: null
            });
        }
    });

    const host = '0.0.0.0';
    const port = config.webListener.port;

    app.listen(port, host, async function () {
        console.log(`Starforge Web API listening on http://${host}:${port} [mode=${config.mode || 'live'}]`);

        try {
            await logToBotChannel(client, `🌐 Starforge Web API listening on ${host}:${port} [mode=${config.mode || 'live'}]`);
        } catch (error) {
            console.error('Failed to log API startup to bot channel:', error);
        }
    });
}

module.exports = {
    startWebApi
};
