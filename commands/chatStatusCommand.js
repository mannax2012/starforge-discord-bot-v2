const { getSwgChatState } = require('../services/swgChatBridge');

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours}h ${minutes}m ${seconds}s`;
}

module.exports = {
    name: 'chatstatus',
    description: 'Shows the current SWG chat relay state.',
    async execute(message) {
        const state = getSwgChatState();

        const reply = [
            '**SWG Chat Relay**',
            `Enabled: ${state.enabled ? 'yes' : 'no'}`,
            `Started: ${state.started ? 'yes' : 'no'}`,
            `Chat Bot: ${state.chatClientTag || '--'}`,
            `Separate Chat Bot: ${state.usingSeparateChatClient ? 'yes' : 'no'}`,
            `Server Status: ${state.serverStatus || '--'}`,
            `Connected: ${state.isConnected ? 'yes' : 'no'}`,
            `Paused: ${state.paused ? 'yes' : 'no'}`,
            `Uptime: ${formatDuration(state.uptimeMs)}`,
            `Character: ${state.character || '--'}`,
            `Room: ${state.chatRoom || '--'}`,
            `Room ID: ${state.roomId || '--'}`,
            `Room Path: ${state.chatRoomPath || '--'}`,
            `Discord Channel: ${state.chatChannelName || state.chatChannelId || '--'}`,
            `Reconnects: ${state.reconnectCount || 0} (active backoff attempt ${state.reconnectAttempt || 0})`,
            `Messages: in ${state.messagesReceived || 0} / out ${state.messagesSent || 0}`,
            `Failures: ${state.fails || 0} | Disconnects: ${state.disconnectCount || 0}`,
            `Last Room Health Response: ${state.lastRoomResponseAt ? formatDuration(state.roomHealthAgeMs) + ' ago' : '--'}`
        ].join('\n');

        await message.reply(reply);
    }
};
