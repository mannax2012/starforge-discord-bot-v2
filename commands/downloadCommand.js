const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const { userHasPlayerRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const {
    getActor,
    getChannelId,
    getMember,
    isInteractionContext,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'download',
    description: 'Provides the Starforge launcher download link.',
    slashData: new SlashCommandBuilder()
        .setName('download')
        .setDescription('Provides the Starforge launcher download link.'),
    async execute(context, args, client) {
        const actor = getActor(context);
        const member = getMember(context);
        const commandLabel = isInteractionContext(context) ? '/download' : '!download';

        if (!context.guild || !member) {
            return replyToContext(context, '❌ This command can only be used in a server channel.', true);
        }

        if (!userHasPlayerRole(member)) {
            return replyToContext(context, '🚫 You must have the **Player** role to use this command.', true);
        }

        const downloadMessage = [
            '📜 **Starforge Launcher Download Link**',
            '',
            'Click the link below to get started:',
            `🔗 [Download SWG Starforge Installer](${config.downloadUrl})`,
            '',
            `May the Force be with you, **${actor.username}**! ✨`
        ].join('\n');

        await replyToContext(context, downloadMessage, isInteractionContext(context));

        const channelId = getChannelId(context);
        await logToBotChannel(
            client,
            `📥 ${actor.tag} used ${commandLabel}${channelId ? ` in <#${channelId}>` : ''}.`
        );
    }
};
