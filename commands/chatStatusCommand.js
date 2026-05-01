const { getSwgChatState } = require('../services/swgChatBridge');

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
            `Character: ${state.character || '--'}`,
            `Room: ${state.chatRoom || '--'}`,
            `Discord Channel: ${state.chatChannelName || state.chatChannelId || '--'}`
        ].join('\n');

        await message.reply(reply);
    }
};
