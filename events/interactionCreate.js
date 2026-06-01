const { Events } = require('discord.js');
const { activateAccountByUsername } = require('../services/accountService');
const {
    buildCore3AdminPanel,
    executeCore3AdminPanelAction,
    getActionLabel,
    parseCore3AdminPanelCustomId
} = require('../services/core3AdminPanelService');
const { logToBotChannel } = require('../services/logging');
const { userHasAdminRole } = require('../utils/roleCheck');

function hasActivationPermission(member) {
    return userHasAdminRole(member);
}

function formatActivationEmailStatus(data) {
    if (!data) {
        return 'Email notification status was not returned.';
    }

    const emailText = data.activationEmailAddress
        ? ` \`${data.activationEmailAddress}\``
        : '';

    if (data.activationEmailSent) {
        return `Activation email sent to${emailText || ' the address on file'}.`;
    }

    if (data.activationEmailAttempted) {
        return `Activation email failed${emailText ? ` for${emailText}` : ''}: ${data.activationEmailMessage || 'Unknown email delivery error.'}`;
    }

    if (emailText) {
        return `${data.activationEmailMessage || 'Activation email was skipped.'} Email on file: ${emailText}.`;
    }

    return data.activationEmailMessage || 'Activation email was skipped.';
}

function formatPanelTimestamp() {
    return new Date().toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
    });
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (!interaction.isButton()) {
            return;
        }

        const core3PanelData = parseCore3AdminPanelCustomId(interaction.customId);
        if (core3PanelData) {
            const { ownerId, action } = core3PanelData;

            if (interaction.user.id !== ownerId) {
                await interaction.reply({
                    content: 'This admin panel belongs to a different user.',
                    ephemeral: true
                });
                return;
            }

            const actionLabel = getActionLabel(action);

            await interaction.deferUpdate();
            await interaction.message.edit(
                buildCore3AdminPanel(ownerId, interaction.user.tag, {
                    state: 'working',
                    label: actionLabel
                })
            );

            try {
                const result = await executeCore3AdminPanelAction(action);

                await interaction.message.edit(
                    buildCore3AdminPanel(ownerId, interaction.user.tag, {
                        state: 'done',
                        success: result.success,
                        message: result.message,
                        timestamp: formatPanelTimestamp()
                    })
                );

                await logToBotChannel(
                    client,
                    `${interaction.user.tag} used the Core3 admin panel: ${actionLabel}. ${result.message}`
                );
            } catch (error) {
                console.error(`[Core3 Admin Panel] ${actionLabel} failed: ${error.message}`);

                await interaction.message.edit(
                    buildCore3AdminPanel(ownerId, interaction.user.tag, {
                        state: 'done',
                        success: false,
                        message: `${actionLabel} failed: ${error.message}`,
                        timestamp: formatPanelTimestamp()
                    })
                );

                await logToBotChannel(
                    client,
                    `${interaction.user.tag} failed to use the Core3 admin panel for ${actionLabel}: ${error.message}`
                );
            }

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
            const result = await activateAccountByUsername(username, {
                activatedBy: interaction.user.tag,
                activationSource: 'discord_review_button'
            });

            if (!result.success) {
                await interaction.reply({
                    content: result.alreadyActive
                        ? `\`${username}\` is already active.`
                        : `Activation failed for \`${username}\`: ${result.message}`,
                    ephemeral: true
                });
                return;
            }

            const emailStatus = formatActivationEmailStatus(result.data);

            await interaction.update({
                content: `Account \`${username}\` activated by **${interaction.user.tag}**.\n${emailStatus}`,
                embeds: [],
                components: []
            });

            await logToBotChannel(
                client,
                `${interaction.user.tag} activated account \`${username}\` from a Discord review button. ${emailStatus}`
            );
        } catch (error) {
            console.error(`[Activation Button] ${username} failed: ${error.message}`);

            await interaction.reply({
                content: `Activation failed for \`${username}\`.`,
                ephemeral: true
            });

            await logToBotChannel(
                client,
                `Activation button failed for \`${username}\`: ${error.message}`
            );
        }
    }
};
