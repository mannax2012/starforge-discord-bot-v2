const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const launcherApiConfig = config && config.launcherApi ? config.launcherApi : {};
const SESSION_FILE = launcherApiConfig.sessionFile
    ? path.resolve(String(launcherApiConfig.sessionFile))
    : path.join(__dirname, '..', 'data', 'launcher-sessions.json');
const DEFAULT_SESSION_TTL_HOURS = Number(launcherApiConfig.sessionTtlHours || 12);
const DEFAULT_REMEMBER_ME_DAYS = Number(launcherApiConfig.rememberMeDays || 30);

function ensureDirectoryForFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readStore() {
    try {
        if (!fs.existsSync(SESSION_FILE)) {
            return { sessions: {} };
        }

        const raw = fs.readFileSync(SESSION_FILE, 'utf8');
        const parsed = JSON.parse(raw);

        if (!parsed || typeof parsed !== 'object' || typeof parsed.sessions !== 'object') {
            return { sessions: {} };
        }

        return parsed;
    } catch (error) {
        return { sessions: {} };
    }
}

function writeStore(store) {
    ensureDirectoryForFile(SESSION_FILE);
    const tempPath = SESSION_FILE + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tempPath, SESSION_FILE);
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createRawToken() {
    return crypto.randomBytes(48).toString('base64url');
}

function toIsoDate(value) {
    return new Date(value).toISOString();
}

function getExpiryDate(rememberMe) {
    const now = Date.now();
    const ttlMs = rememberMe
        ? DEFAULT_REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000
        : DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000;

    return new Date(now + ttlMs);
}

function cleanupExpiredSessions() {
    const store = readStore();
    const now = Date.now();
    let changed = false;

    Object.keys(store.sessions).forEach(function (tokenHash) {
        const session = store.sessions[tokenHash];
        const expiresAt = Date.parse(session && session.expiresAtUtc ? session.expiresAtUtc : '');

        if (!Number.isFinite(expiresAt) || expiresAt <= now) {
            delete store.sessions[tokenHash];
            changed = true;
        }
    });

    if (changed) {
        writeStore(store);
    }
}

function issueSession(options) {
    const username = String(options && options.username ? options.username : '').trim();
    const accountStatus = String(options && options.accountStatus ? options.accountStatus : '').trim() || 'inactive';
    const rememberMe = Boolean(options && options.rememberMe);
    const clientName = String(options && options.clientName ? options.clientName : 'Starforge LaunchPad').trim();

    if (!username) {
        throw new Error('A username is required to issue a launcher session.');
    }

    cleanupExpiredSessions();

    const rawToken = createRawToken();
    const tokenHash = hashToken(rawToken);
    const nowIso = toIsoDate(Date.now());
    const expiresAt = getExpiryDate(rememberMe);

    const store = readStore();
    store.sessions[tokenHash] = {
        username,
        accountStatus,
        rememberMe,
        clientName,
        createdAtUtc: nowIso,
        lastSeenAtUtc: nowIso,
        expiresAtUtc: expiresAt.toISOString()
    };
    writeStore(store);

    return {
        accessToken: rawToken,
        username,
        accountStatus,
        expiresAtUtc: expiresAt.toISOString(),
        rememberMe
    };
}

function getSessionFromToken(token, touch) {
    const rawToken = String(token || '').trim();
    if (!rawToken) {
        return null;
    }

    cleanupExpiredSessions();

    const tokenHash = hashToken(rawToken);
    const store = readStore();
    const session = store.sessions[tokenHash];

    if (!session) {
        return null;
    }

    if (touch) {
        session.lastSeenAtUtc = toIsoDate(Date.now());
        store.sessions[tokenHash] = session;
        writeStore(store);
    }

    return {
        tokenHash,
        username: String(session.username || ''),
        accountStatus: String(session.accountStatus || ''),
        rememberMe: Boolean(session.rememberMe),
        clientName: String(session.clientName || ''),
        createdAtUtc: String(session.createdAtUtc || ''),
        lastSeenAtUtc: String(session.lastSeenAtUtc || ''),
        expiresAtUtc: String(session.expiresAtUtc || '')
    };
}

function revokeSession(token) {
    const rawToken = String(token || '').trim();
    if (!rawToken) {
        return false;
    }

    const tokenHash = hashToken(rawToken);
    const store = readStore();

    if (!store.sessions[tokenHash]) {
        return false;
    }

    delete store.sessions[tokenHash];
    writeStore(store);
    return true;
}

function parseBearerToken(req) {
    const authHeader = String(req && req.get ? req.get('Authorization') : '').trim();
    if (!authHeader) {
        return '';
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? String(match[1] || '').trim() : '';
}

module.exports = {
    issueSession,
    getSessionFromToken,
    revokeSession,
    parseBearerToken,
    cleanupExpiredSessions
};