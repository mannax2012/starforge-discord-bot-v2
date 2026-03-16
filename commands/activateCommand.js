const pool = require('../services/database');
const registrationMap = require('../utils/registrationMap');
const { userHasAdminRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');

module.exports = {
    name: 'activate',
    description: 'Activates a user account (Admin only).',
    async execute(message, args, client) {
        if (!message.guild || !message.member) {
            return message.reply('❌ This command can only be used in a server channel.');
        }

        if (!userHasAdminRole(message.member)) {
            return message.reply('❌ You do not have permission to use this command.');
        }

        const username = String(args[0] || '').trim();
        if (!username) {
            return message.reply('❗ Usage: `!activate <accountname>`');
        }

        try {
            const [accountRows] = await pool.execute(
                'SELECT active FROM accounts WHERE username = ? LIMIT 1',
                [username]
            );

            if (!accountRows.length) {
                await logToBotChannel(client, `❌ ${message.author.tag} tried to activate missing account \`${username}\`.`);
                return message.reply(`❌ Account **${username}** was not found.`);
            }

            if (Number(accountRows[0].active) === 1) {
                await logToBotChannel(client, `ℹ️ ${message.author.tag} attempted to activate already-active account \`${username}\`.`);
                return message.reply(`⚠️ Account **${username}** is already activated.`);
            }

            await pool.execute(
                'UPDATE accounts SET active = 1 WHERE username = ?',
                [username]
            );

            await logToBotChannel(client, `✅ ${message.author.tag} activated account \`${username}\`.`);
            await message.reply(`✅ Account **${username}** has been activated.`);

            const discordId = registrationMap.get(username);
            if (discordId) {
                try {
                    const user = await client.users.fetch(discordId);
                    await user.send(`✅ Your **Starforge** account \`${username}\` has been activated. You can now log in and play.`);
                    registrationMap.delete(username);
                } catch (error) {
                    await logToBotChannel(client, `⚠️ Activation DM failed for Discord user \`${discordId}\`: ${error.message}`);
                }
            }
        } catch (error) {
            console.error('Activate command error:', error);
            await logToBotChannel(client, `❌ ${message.author.tag} failed to activate \`${username}\`: ${error.message}`);
            await message.reply('❌ There was an error activating that account.');
        }
    }
};
