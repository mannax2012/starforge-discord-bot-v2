const { SlashCommandBuilder } = require('discord.js');
const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const { getSwgChatState, enableSwgChatDebug } = require('../services/swgChatBridge');
const {
    getActor,
    getMember,
    isInteractionContext,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'debugchat',
    description: 'Enables verbose SWG chat relay logging for this process (Admin only).',
    slashData: new SlashCommandBuilder()
        .setName('debugchat')
        .setDescription('Enables verbose SWG chat relay logging for this process. Admin only.'),
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

        const state = getSwgChatState();
        if (!state.enabled) {
            return replyToContext(context, 'SWG chat bridge is disabled.', true);
        }

        enableSwgChatDebug();
        await replyToContext(context, 'SWG chat relay debug logging enabled for this process.', isSlash);
        await logToBotChannel(client, `${actor.tag} enabled SWG chat relay debug logging.`);
    }
};
