const { Events } = require('discord.js');
const config = require('../config');
const { activateAccountByUsername } = require('../services/accountService');
const { logToBotChannel } = require('../services/logging');

function hasActivationPermission(member) {
    const adminRoleName = config.adminRoleName || 'Starforge Admin';

    if (!member || !member.roles || !member.roles.cache) {
        return false;
    }

    return member.roles.cache.some(role => role.name === adminRoleName);
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (!interaction.isButton()) {
            return;
        }

        if (!interaction.customId.startsWith('activate_account:')) {
            return;
        }

        const username = interaction.customId.substring('activate_account:'.length).trim();

        if (!hasActivationPermission(interaction.member)) {
            await interaction.reply({
                content: 'You do not have permission to activate accounts.',
                ephemeral: true
            });
            return;
        }

        try {
            const result = await activateAccountByUsername(username);

            if (!result.success) {
                await interaction.reply({
                    content: result.alreadyActive
                        ? `\`${username}\` is already active.`
                        : `Activation failed for \`${username}\`: ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            await interaction.update({
                content: `✅ Account \`${username}\` activated by **${interaction.user.tag}**`,
                embeds: [],
                components: []
            });

            await logToBotChannel(
                client,
                `✅ ${interaction.user.tag} activated account \`${username}\` from a Discord review button.`
            );
        } catch (error) {
            console.error('Activation button handler failed:', error);

            await interaction.reply({
                content: `Activation failed for \`${username}\`.`,
                ephemeral: true
            });

            await logToBotChannel(
                client,
                `❌ Activation button failed for \`${username}\`: ${error.message}`
            );
        }
    }
};