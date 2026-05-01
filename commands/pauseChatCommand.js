const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const { getSwgChatState, toggleSwgChatPause } = require('../services/swgChatBridge');

module.exports = {
    name: 'pausechat',
    description: 'Pauses or unpauses the SWG chat relay (Admin only).',
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

        const paused = toggleSwgChatPause();
        await message.reply(paused ? 'SWG chat relay paused.' : 'SWG chat relay resumed.');
        await logToBotChannel(
            client,
            `${message.author.tag} ${paused ? 'paused' : 'resumed'} the SWG chat relay.`
        );
    }
};
