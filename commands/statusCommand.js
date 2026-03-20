const { readCurrentStatus } = require('../services/statusMonitor');
const { logToBotChannel } = require('../services/logging');

function safeInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? (fallback || 0) : parsed;
}

function normalizeStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();

    if (normalized === 'online' || normalized === 'up') {
        return 'ONLINE';
    }

    if (normalized === 'offline' || normalized === 'down') {
        return 'OFFLINE';
    }

    return 'OFFLINE';
}

function formatUptimeSeconds(totalSeconds) {
    const elapsed = Math.max(0, safeInt(totalSeconds, 0));
    const days = Math.floor(elapsed / 86400);
    const hours = Math.floor((elapsed % 86400) / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;
    const parts = [];

    if (days > 0) {
        parts.push(`${days}d`);
    }

    if (days > 0 || hours > 0) {
        parts.push(`${hours}h`);
    }

    if (days > 0 || hours > 0 || minutes > 0) {
        parts.push(`${minutes}m`);
    }

    if (days === 0 && hours === 0) {
        parts.push(`${seconds}s`);
    }

    return parts.length ? parts.join(' ') : '0s';
}

function getServerName(status) {
    if (status && typeof status.serverName !== 'undefined' && status.serverName !== null && String(status.serverName).trim() !== '') {
        return String(status.serverName).trim();
    }

    if (
        status &&
        status.xml &&
        status.xml.zoneServer &&
        typeof status.xml.zoneServer.name !== 'undefined' &&
        status.xml.zoneServer.name !== null &&
        String(status.xml.zoneServer.name).trim() !== ''
    ) {
        return String(status.xml.zoneServer.name).trim();
    }

    return 'Starforge';
}

function getConnectedPlayers(status) {
    if (
        status &&
        status.xml &&
        status.xml.zoneServer &&
        status.xml.zoneServer.users &&
        typeof status.xml.zoneServer.users.connected !== 'undefined'
    ) {
        return safeInt(status.xml.zoneServer.users.connected, 0);
    }

    if (status && typeof status.connectedUsers !== 'undefined') {
        return safeInt(status.connectedUsers, 0);
    }

    return 0;
}

function getUptimeSeconds(status) {
    if (
        status &&
        status.xml &&
        status.xml.zoneServer &&
        typeof status.xml.zoneServer.uptime !== 'undefined'
    ) {
        return safeInt(status.xml.zoneServer.uptime, 0);
    }

    if (status && typeof status.uptimeSeconds !== 'undefined') {
        return safeInt(status.uptimeSeconds, 0);
    }

    return 0;
}

module.exports = {
    name: 'status',
    description: 'Shows the current Starforge server status.',
    async execute(message, args, client) {
        const status = readCurrentStatus();

        const serverName = getServerName(status);
        const serverStatus = normalizeStatus(status && status.status);
        const connectedPlayers = getConnectedPlayers(status);
        const uptime = serverStatus === 'ONLINE'
            ? formatUptimeSeconds(getUptimeSeconds(status))
            : '--';

        const reply = [
            '📡 **Starforge Server Status**',
            '',
            `**Server:** ${serverName}`,
            `**Status:** ${serverStatus}`,
            `**Players:** ${connectedPlayers}`,
            `**Uptime:** ${uptime}`
        ].join('\n');

        await message.reply(reply);
        await logToBotChannel(client, `📥 ${message.author.tag} used !status in <#${message.channel.id}>.`);
    }
};