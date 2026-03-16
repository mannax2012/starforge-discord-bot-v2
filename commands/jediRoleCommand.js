const { userHasPlayerRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');

module.exports = {
    name: 'jedi',
    description: 'Assigns the Jedi role to the member using the command.',
    async execute(message, args, client) {
        if (!message.guild || !message.member) {
            return message.reply('❌ This command can only be used in a server channel.');
        }

        if (!userHasPlayerRole(message.member)) {
            return message.reply('🚫 You must have the **Player** role to use this command.');
        }

        const role = message.guild.roles.cache.find(existingRole => existingRole.name === 'Jedi');
        if (!role) {
            await logToBotChannel(client, `❌ ${message.author.tag} used !jedi but the Jedi role was not found.`);
            return message.reply('❌ The **Jedi** role does not exist.');
        }

        if (message.member.roles.cache.has(role.id)) {
            return message.reply('🗡️ You already have the **Jedi** role.');
        }

        try {
            await message.member.roles.add(role);
            await message.reply('✅ You have been given the **Jedi** role.');
            await logToBotChannel(client, `✅ ${message.author.tag} self-assigned Jedi.`);
        } catch (error) {
            await logToBotChannel(client, `❌ Failed to assign Jedi to ${message.author.tag}: ${error.message}`);
            await message.reply('❌ I could not assign that role. Check my permissions and role hierarchy.');
        }
    }
};
