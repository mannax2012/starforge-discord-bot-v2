const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const {
    buildCore3AdminPanel,
    formatModeLabel,
    normalizePanelMode
} = require('../services/core3AdminPanelService');
const {
    getActor,
    getMember,
    isInteractionContext,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'adminpanel',
    description: 'Sends the Core3 and Ent Bot admin control panel in DM (Admin only).',
    slashData: new SlashCommandBuilder()
        .setName('adminpanel')
        .setDescription('Sends the Core3 and Ent Bot admin control panel in DM. Admin only.')
        .addStringOption((option) => (
            option
                .setName('mode')
                .setDescription('Which Core3 environment to control')
                .setRequired(true)
                .addChoices(
                    { name: 'Live', value: 'live' },
                    { name: 'TC', value: 'tc' }
                )
        )),
    async execute(context, args, client) {
        const actor = getActor(context);
        const member = getMember(context);
        const isSlash = isInteractionContext(context);
        const currentBotMode = config && config.isTcMode ? 'tc' : 'live';
        const rawMode = isSlash ? context.options.getString('mode', true) : (args && args[0]);
        const requestedMode = normalizePanelMode(rawMode);

        if (!requestedMode) {
            return replyToContext(context, 'Usage: `/adminpanel mode:live` or `/adminpanel mode:tc`', true);
        }

        if (requestedMode !== currentBotMode) {
            return replyToContext(
                context,
                `This bot can only open the ${formatModeLabel(currentBotMode)} Core3 panel in its current environment.`,
                true
            );
        }

        if (!context.guild || !member) {
            return replyToContext(context, 'This command can only be used in a server channel.', true);
        }

        if (!userHasAdminRole(member)) {
            return replyToContext(context, 'You do not have permission to use this command.', true);
        }

        try {
            await actor.send(
                buildCore3AdminPanel(actor.id, actor.tag, requestedMode, null)
            );

            await replyToContext(
                context,
                `I sent the ${formatModeLabel(requestedMode)} Core3 admin panel to your DMs.`,
                isSlash
            );
            await logToBotChannel(client, `${actor.tag} opened the ${formatModeLabel(requestedMode)} Core3 admin panel.`);
        } catch (error) {
            console.error(`[Admin Panel] Failed to DM ${actor.tag}: ${error.message}`);
            await replyToContext(
                context,
                'I could not send you the admin panel in DM. Please enable DMs from this server and try again.',
                true
            );
        }
    }
};
