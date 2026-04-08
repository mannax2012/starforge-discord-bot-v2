const config = require('../config');

async function logToBotChannel(client, text) {
    if (!config.features.botLogEnabled) {
        return;
    }

    if (!client || !config.botLogChannelId) {
        return;
    }

    try {
        const channel = await client.channels.fetch(config.botLogChannelId);
        if (channel && channel.isTextBased()) {
            await channel.send(text);
        }
    } catch (error) {
        console.error('Failed to log to bot channel:', error.message);
    }
}

module.exports = {
    logToBotChannel
};