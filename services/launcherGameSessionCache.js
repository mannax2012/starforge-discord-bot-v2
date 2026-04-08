const sessionsByAccessToken = new Map();

function getChannelKey(channel) {
    const raw = String(channel || 'Live').trim().toLowerCase();
    return raw === 'testcenter' ? 'TestCenter' : 'Live';
}

function parseExpires(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function getCachedGameSession(accessToken, channel) {
    const token = String(accessToken || '').trim();
    if (!token) {
        return null;
    }

    const entry = sessionsByAccessToken.get(token);
    if (!entry) {
        return null;
    }

    const key = getChannelKey(channel);
    const cached = entry[key];
    if (!cached || !cached.data) {
        return null;
    }

    const expiresAt = parseExpires(cached.data.expiresAtUtc);
    const now = Date.now();

    if (!expiresAt || expiresAt <= now + 30000) {
        entry[key] = null;
        sessionsByAccessToken.set(token, entry);
        return null;
    }

    return cached.data;
}

function setCachedGameSession(accessToken, channel, data) {
    const token = String(accessToken || '').trim();
    if (!token || !data) {
        return;
    }

    const key = getChannelKey(channel);
    const existing = sessionsByAccessToken.get(token) || {
        Live: null,
        TestCenter: null
    };

    existing[key] = {
        data
    };

    sessionsByAccessToken.set(token, existing);
}

function clearCachedGameSessions(accessToken) {
    const token = String(accessToken || '').trim();
    if (!token) {
        return;
    }

    sessionsByAccessToken.delete(token);
}

module.exports = {
    getCachedGameSession,
    setCachedGameSession,
    clearCachedGameSessions
};