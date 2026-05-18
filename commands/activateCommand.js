const registrationMap = require('../utils/registrationMap');
const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const { activateAccountByUsername } = require('../services/accountService');

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
    async execute(message, args, client) {
        if (!message.guild || !message.member) {
            return message.reply('This command can only be used in a server channel.');
        }

        if (!userHasAdminRole(message.member)) {
            return message.reply('You do not have permission to use this command.');
        }

        const username = String(args[0] || '').trim();
        if (!username) {
            return message.reply('Usage: `!activate <accountname>`');
        }

        try {
            const result = await activateAccountByUsername(username, {
                activatedBy: message.author.tag,
                activationSource: 'discord_command'
            });

            if (!result.success) {
                if (result.alreadyActive) {
                    await logToBotChannel(client, `${message.author.tag} attempted to activate already-active account \`${username}\`.`);
                    return message.reply(`Account **${username}** is already activated.`);
                }

                if (result.statusCode === 404) {
                    await logToBotChannel(client, `${message.author.tag} tried to activate missing account \`${username}\`.`);
                    return message.reply(`Account **${username}** was not found.`);
                }

                await logToBotChannel(client, `${message.author.tag} failed to activate \`${username}\`: ${result.message}`);
                return message.reply(result.message);
            }

            const emailStatus = formatActivationEmailStatus(result.data);

            await logToBotChannel(
                client,
                `${message.author.tag} activated account \`${username}\`. ` +
                `TC mirror: ${result.data && result.data.tcMirrorActivated ? 'success' : 'not confirmed'} ` +
                `(${result.data && result.data.tcMirrorMessage ? result.data.tcMirrorMessage : 'no message'}). ` +
                `${emailStatus}`
            );

            await message.reply(
                `Account **${username}** has been activated.` +
                (result.data && result.data.tcMirrorMessage
                    ? `\nTC mirror: ${result.data.tcMirrorMessage}`
                    : '') +
                `\n${emailStatus}`
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
            await logToBotChannel(client, `${message.author.tag} failed to activate \`${username}\`: ${error.message}`);
            await message.reply('There was an error activating that account.');
        }
    }
};
