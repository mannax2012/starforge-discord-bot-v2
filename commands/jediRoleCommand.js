const { SlashCommandBuilder } = require('discord.js');
const { userHasPlayerRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const {
    getActor,
    getMember,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'jedi',
    description: 'Assigns the Jedi role to the member using the command.',
    slashData: new SlashCommandBuilder()
        .setName('jedi')
        .setDescription('Assigns the Jedi role to you.'),
    async execute(context, args, client) {
        const actor = getActor(context);
        const member = getMember(context);

        if (!context.guild || !member) {
            return replyToContext(context, '❌ This command can only be used in a server channel.', true);
        }

        if (!userHasPlayerRole(member)) {
            return replyToContext(context, '🚫 You must have the **Player** role to use this command.', true);
        }

        const role = context.guild.roles.cache.find((existingRole) => existingRole.name === 'Jedi');
        if (!role) {
            await logToBotChannel(client, `❌ ${actor.tag} used /jedi but the Jedi role was not found.`);
            return replyToContext(context, '❌ The **Jedi** role does not exist.', true);
        }

        if (member.roles.cache.has(role.id)) {
            return replyToContext(context, '🗡️ You already have the **Jedi** role.', true);
        }

        try {
            await member.roles.add(role);
            await replyToContext(context, '✅ You have been given the **Jedi** role.', true);
            await logToBotChannel(client, `✅ ${actor.tag} self-assigned Jedi.`);
        } catch (error) {
            await logToBotChannel(client, `❌ Failed to assign Jedi to ${actor.tag}: ${error.message}`);
            await replyToContext(context, '❌ I could not assign that role. Check my permissions and role hierarchy.', true);
        }
    }
};
