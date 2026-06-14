const { SlashCommandBuilder } = require('discord.js');
const registrationMap = require('../utils/registrationMap');
const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const { activateAccountByUsername } = require('../services/accountService');
const {
    getActor,
    getMember,
    isInteractionContext,
    replyToContext
} = require('../utils/commandContext');

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

module.exports = {
    name: 'activate',
    description: 'Activates a user account (Admin only).',
    slashData: new SlashCommandBuilder()
        .setName('activate')
        .setDescription('Activates a user account. Admin only.')
        .addStringOption((option) => (
            option
                .setName('username')
                .setDescription('The account username to activate')
                .setRequired(true)
        )),
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

        const username = isSlash
            ? String(context.options.getString('username', true) || '').trim()
            : String(args[0] || '').trim();

        if (!username) {
            return replyToContext(context, 'Usage: `/activate username:<accountname>`', true);
        }

        try {
            const result = await activateAccountByUsername(username, {
                activatedBy: actor.tag,
                activationSource: 'discord_command'
            });

            if (!result.success) {
                if (result.alreadyActive) {
                    await logToBotChannel(client, `${actor.tag} attempted to activate already-active account \`${username}\`.`);
                    return replyToContext(context, `Account **${username}** is already activated.`, isSlash);
                }

                if (result.statusCode === 404) {
                    await logToBotChannel(client, `${actor.tag} tried to activate missing account \`${username}\`.`);
                    return replyToContext(context, `Account **${username}** was not found.`, isSlash);
                }

                await logToBotChannel(client, `${actor.tag} failed to activate \`${username}\`: ${result.message}`);
                return replyToContext(context, result.message, isSlash);
            }

            const emailStatus = formatActivationEmailStatus(result.data);

            await logToBotChannel(
                client,
                `${actor.tag} activated account \`${username}\`. ` +
                `TC mirror: ${result.data && result.data.tcMirrorActivated ? 'success' : 'not confirmed'} ` +
                `(${result.data && result.data.tcMirrorMessage ? result.data.tcMirrorMessage : 'no message'}). ` +
                `${emailStatus}`
            );

            await replyToContext(
                context,
                `Account **${username}** has been activated.` +
                (result.data && result.data.tcMirrorMessage
                    ? `\nTC mirror: ${result.data.tcMirrorMessage}`
                    : '') +
                `\n${emailStatus}`,
                isSlash
            );

            const discordId = registrationMap.get(username);
            if (discordId) {
                try {
                    const user = await client.users.fetch(discordId);
                    await user.send(`Your **Starforge** account \`${username}\` has been activated. You can now log in and play.`);
                    registrationMap.delete(username);
                } catch (error) {
                    await logToBotChannel(client, `Activation DM failed for Discord user \`${discordId}\`: ${error.message}`);
                }
            }
        } catch (error) {
            console.error(`[Discord Activate] ${username} failed: ${error.message}`);
            await logToBotChannel(client, `${actor.tag} failed to activate \`${username}\`: ${error.message}`);
            await replyToContext(context, 'There was an error activating that account.', true);
        }
    }
};
