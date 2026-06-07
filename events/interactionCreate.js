const {
    ActionRowBuilder,
    Events,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { activateAccountByUsername } = require('../services/accountService');
const {
    buildButtonCustomId,
    buildCore3AdminPanel,
    buildCore3StopConfirmPanel,
    executeCore3AdminPanelAction,
    formatModeLabel,
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

function normalizeShutdownMinutesInput(value) {
    const raw = String(value == null ? '' : value).trim();

    if (!/^\d+$/.test(raw)) {
        return {
            minutes: 15,
            defaulted: true
        };
    }

    const parsed = Number.parseInt(raw, 10);

    if (!Number.isInteger(parsed) || parsed > 60) {
        return {
            minutes: 15,
            defaulted: true
        };
    }

    return {
        minutes: parsed,
        defaulted: false
    };
}

async function executeCore3PanelAction(panelMessage, actorTag, ownerId, mode, action, client, options) {
    const actionOptions = options || {};
    const actionLabel = actionOptions.actionLabel || getActionLabel(action, mode);

    await panelMessage.edit(
        buildCore3AdminPanel(ownerId, actorTag, mode, {
            state: 'working',
            label: actionLabel
        })
    );

    try {
        const result = await executeCore3AdminPanelAction(action, mode, actionOptions.executeOptions || {});

        await panelMessage.edit(
            buildCore3AdminPanel(ownerId, actorTag, mode, {
                state: 'done',
                success: result.success,
                message: result.message,
                timestamp: formatPanelTimestamp()
            })
        );

        await logToBotChannel(
            client,
            `${actorTag} used the ${formatModeLabel(mode)} Core3 admin panel: ${actionLabel}. ${result.message}`
        );

        return result;
    } catch (error) {
        console.error(`[Core3 Admin Panel] ${actionLabel} failed: ${error.message}`);

        await panelMessage.edit(
            buildCore3AdminPanel(ownerId, actorTag, mode, {
                state: 'done',
                success: false,
                message: `${actionLabel} failed: ${error.message}`,
                timestamp: formatPanelTimestamp()
            })
        );

        await logToBotChannel(
            client,
            `${actorTag} failed to use the ${formatModeLabel(mode)} Core3 admin panel for ${actionLabel}: ${error.message}`
        );

        throw error;
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (interaction.isButton()) {
            const core3PanelData = parseCore3AdminPanelCustomId(interaction.customId);
            if (core3PanelData) {
                const { ownerId, mode, action } = core3PanelData;

                if (interaction.user.id !== ownerId) {
                    await interaction.reply({
                        content: 'This admin panel belongs to a different user.',
                        ephemeral: true
                    });
                    return;
                }

                if (action === 'stop') {
                    await interaction.update(
                        buildCore3StopConfirmPanel(ownerId, interaction.user.tag, mode)
                    );
                    return;
                }

                if (action === 'stop-cancel') {
                    await interaction.update(
                        buildCore3AdminPanel(ownerId, interaction.user.tag, mode, {
                            state: 'done',
                            success: false,
                            message: 'Forced stop canceled.',
                            timestamp: formatPanelTimestamp()
                        })
                    );
                    return;
                }

                if (action === 'shutdown') {
                    const modal = new ModalBuilder()
                        .setCustomId(buildButtonCustomId(ownerId, mode, 'shutdown-submit', interaction.message.id))
                        .setTitle(`Shutdown ${formatModeLabel(mode)} Core3`);
                    const minutesInput = new TextInputBuilder()
                        .setCustomId('shutdown_minutes')
                        .setLabel('Minutes until shutdown')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('0-60, defaults to 15 if invalid or > 60')
                        .setRequired(false)
                        .setMaxLength(3);
                    const row = new ActionRowBuilder().addComponents(minutesInput);
                    modal.addComponents(row);
                    await interaction.showModal(modal);
                    return;
                }

                const executeAction = action === 'stop-confirm' ? 'stop' : action;
                const actionLabel = action === 'stop-confirm'
                    ? `Force Stop ${formatModeLabel(mode)} Core3`
                    : getActionLabel(executeAction, mode);

                await interaction.deferUpdate();
                await executeCore3PanelAction(
                    interaction.message,
                    interaction.user.tag,
                    ownerId,
                    mode,
                    executeAction,
                    client,
                    {
                        actionLabel
                    }
                );
                return;
            }
        }

        if (interaction.isModalSubmit()) {
            const core3PanelData = parseCore3AdminPanelCustomId(interaction.customId);
            if (core3PanelData && core3PanelData.action === 'shutdown-submit') {
                const { ownerId, mode, messageId } = core3PanelData;

                if (interaction.user.id !== ownerId) {
                    await interaction.reply({
                        content: 'This admin panel belongs to a different user.',
                        ephemeral: true
                    });
                    return;
                }

                const normalized = normalizeShutdownMinutesInput(
                    interaction.fields.getTextInputValue('shutdown_minutes')
                );
                const minutesNote = normalized.defaulted
                    ? `Invalid or too-large input detected, so shutdown will use the default of ${normalized.minutes} minute(s).`
                    : `Shutdown will use ${normalized.minutes} minute(s).`;

                await interaction.reply({
                    content: `${formatModeLabel(mode)} Core3 shutdown requested. ${minutesNote}`,
                    ephemeral: true
                });

                const panelMessage = await interaction.channel.messages.fetch(messageId);

                void executeCore3PanelAction(
                    panelMessage,
                    interaction.user.tag,
                    ownerId,
                    mode,
                    'shutdown',
                    client,
                    {
                        actionLabel: `Shutdown ${formatModeLabel(mode)} Core3 (${normalized.minutes} minute(s))`,
                        executeOptions: {
                            minutes: normalized.minutes
                        }
                    }
                );
                return;
            }
        }

        if (!interaction.isButton()) {
            return;
        }

        if (config.isTcMode) {
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
