const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const { getSwgChatState, enableSwgChatDebug } = require('../services/swgChatBridge');

module.exports = {
    name: 'debugchat',
    description: 'Enables verbose SWG chat relay logging for this process (Admin only).',
    async execute(message, args, client) {
        if (!message.guild || !message.member) {
            return message.reply('This command can only be used in a server channel.');
        }

        if (!userHasAdminRole(message.member)) {
            return message.reply('You do not have permission to use this command.');
        }

        const state = getSwgChatState();
        if (!state.enabled) {
            return message.reply('SWG chat bridge is disabled.');
        }

        enableSwgChatDebug();
        await message.reply('SWG chat relay debug logging enabled for this process.');
        await logToBotChannel(client, `${message.author.tag} enabled SWG chat relay debug logging.`);
    }
};
