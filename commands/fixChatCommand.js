const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const { getSwgChatState, restartSwgChatBridge } = require('../services/swgChatBridge');

module.exports = {
    name: 'fixchat',
    description: 'Reconnects the SWG chat relay (Admin only).',
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

        const restarted = restartSwgChatBridge();
        if (!restarted) {
            return message.reply('SWG chat bridge is not running yet.');
        }

        await message.reply('SWG chat relay reconnect requested.');
        await logToBotChannel(client, `${message.author.tag} requested an SWG chat relay reconnect.`);
    }
};
