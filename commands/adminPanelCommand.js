const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const {
    buildCore3AdminPanel,
    formatModeLabel,
    normalizePanelMode
} = require('../services/core3AdminPanelService');

module.exports = {
    name: 'adminpanel',
    description: 'Sends the Core3 admin control panel in DM (Admin only).',
    async execute(message, args, client) {
        if (!message.guild || !message.member) {
            return message.reply('This command can only be used in a server channel.');
        }

        if (!userHasAdminRole(message.member)) {
            return message.reply('You do not have permission to use this command.');
        }

        const requestedMode = normalizePanelMode(args && args[0] ? args[0] : null);
        if (!requestedMode) {
            return message.reply('Usage: `!adminpanel live` or `!adminpanel tc`.');
        }

        try {
            await message.author.send(
                buildCore3AdminPanel(message.author.id, message.author.tag, requestedMode, null)
            );

            await message.reply(`I sent the ${formatModeLabel(requestedMode)} Core3 admin panel to your DMs.`);
            await logToBotChannel(client, `${message.author.tag} opened the ${formatModeLabel(requestedMode)} Core3 admin panel.`);
        } catch (error) {
            console.error(`[Admin Panel] Failed to DM ${message.author.tag}: ${error.message}`);
            await message.reply('I could not send you the admin panel in DM. Please enable DMs from this server and try again.');
        }
    }
};
