const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const { getEntBotServiceState, restartEntBotService } = require('../services/entBotService');

module.exports = {
    name: 'fixent',
    description: 'Reconnects the entertainer bot worker (Admin only).',
    async execute(message, args, client) {
        if (!message.guild || !message.member) {
            return message.reply('This command can only be used in a server channel.');
        }

        if (!userHasAdminRole(message.member)) {
            return message.reply('You do not have permission to use this command.');
        }

        const state = getEntBotServiceState();
        if (!state.enabled) {
            return message.reply('Ent Bot is disabled.');
        }

        const restarted = await restartEntBotService();
        if (!restarted) {
            return message.reply('Ent Bot could not be restarted.');
        }

        await message.reply('Ent Bot reconnect requested.');
        await logToBotChannel(client, `${message.author.tag} requested an Ent Bot reconnect.`);
    }
};
