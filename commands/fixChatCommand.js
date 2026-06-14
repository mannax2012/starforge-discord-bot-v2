const { SlashCommandBuilder } = require('discord.js');
const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const { getSwgChatState, restartSwgChatBridge } = require('../services/swgChatBridge');
const {
    getActor,
    getMember,
    isInteractionContext,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'fixchat',
    description: 'Reconnects the SWG chat relay (Admin only).',
    slashData: new SlashCommandBuilder()
        .setName('fixchat')
        .setDescription('Reconnects the SWG chat relay. Admin only.'),
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

        const restarted = await restartSwgChatBridge();
        if (!restarted) {
            return replyToContext(context, 'SWG chat bridge is not running yet.', true);
        }

        await replyToContext(context, 'SWG chat relay reconnect requested.', isSlash);
        await logToBotChannel(client, `${actor.tag} requested an SWG chat relay reconnect.`);
    }
};
