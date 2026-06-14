const { SlashCommandBuilder } = require('discord.js');
const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const { getEntBotServiceState, restartEntBotService } = require('../services/entBotService');
const {
    getActor,
    getMember,
    isInteractionContext,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'fixent',
    description: 'Reconnects the entertainer bot worker (Admin only).',
    slashData: new SlashCommandBuilder()
        .setName('fixent')
        .setDescription('Reconnects the entertainer bot worker. Admin only.'),
    async execute(context, args, client) {
        const actor = getActor(context);
        const member = getMember(context);
        const isSlash = isInteractionContext(context);

        if (!context.guild || !member) {
            return replyToContext(context, 'This command can only be used in a server channel.', true);
        }

        if (!userHasAdminRole(member)) {
            return replyToContext(context, 'You do not have permission to use this command.', true);
        }

        const state = getEntBotServiceState();
        if (!state.enabled) {
            return replyToContext(context, 'Ent Bot is disabled.', true);
        }

        const restarted = await restartEntBotService();
        if (!restarted) {
            return replyToContext(context, 'Ent Bot could not be restarted.', true);
        }

        await replyToContext(context, 'Ent Bot reconnect requested.', isSlash);
        await logToBotChannel(client, `${actor.tag} requested an Ent Bot reconnect.`);
    }
};
