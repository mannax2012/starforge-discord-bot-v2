const { readCurrentStatus } = require('../services/statusMonitor');
const { logToBotChannel } = require('../services/logging');

function formatAge(lastChecked) {
    if (!lastChecked) {
        return 'unknown';
    }

    const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(lastChecked));

    if (ageSeconds < 60) {
        return `${ageSeconds}s ago`;
    }

    const minutes = Math.floor(ageSeconds / 60);
    if (minutes < 60) {
        return `${minutes}m ago`;
    }

    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

module.exports = {
    name: 'status',
    description: 'Shows the current Starforge server status.',
    async execute(message, args, client) {
        const status = readCurrentStatus();

        const reply = [
            '📡 **Starforge Server Status**',
            '',
            `**Status:** ${String(status.status || 'down').toUpperCase()}`,
            `**Players Online:** ${Number(status.connectedUsers || 0)}`,
            `**Peak Players:** ${Number(status.maxConnectedUsers || 0)}`,
            `**Last Checked:** ${formatAge(status.lastChecked)}`,
            `**Probe Error:** ${status.probeError ? status.probeError : 'None'}`
        ].join('\n');

        await message.reply(reply);
        await logToBotChannel(client, `📥 ${message.author.tag} used !status in <#${message.channel.id}>.`);
    }
};