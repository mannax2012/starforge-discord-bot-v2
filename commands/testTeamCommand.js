const { SlashCommandBuilder } = require('discord.js');
const { userHasPlayerRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const {
    getActor,
    getMember,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'test',
    description: 'Assigns the Test Team role to the member using the command.',
    slashData: new SlashCommandBuilder()
        .setName('test')
        .setDescription('Assigns the Test Team role to you.'),
    async execute(context, args, client) {
        const actor = getActor(context);
        const member = getMember(context);

        if (!context.guild || !member) {
            return replyToContext(context, '❌ This command can only be used in a server channel.', true);
        }

        if (!userHasPlayerRole(member)) {
            return replyToContext(context, '🚫 You must have the **Player** role to use this command.', true);
        }

        const role = context.guild.roles.cache.find((existingRole) => existingRole.name === 'Test Team');
        if (!role) {
            await logToBotChannel(client, `❌ ${actor.tag} used /test but the Test Team role was not found.`);
            return replyToContext(context, '❌ The **Test Team** role does not exist.', true);
        }

        if (member.roles.cache.has(role.id)) {
            return replyToContext(context, '🧪 You already have the **Test Team** role.', true);
        }

        try {
            await member.roles.add(role);
            await replyToContext(context, '✅ You have been given the **Test Team** role.', true);
            await logToBotChannel(client, `✅ ${actor.tag} self-assigned Test Team.`);
        } catch (error) {
            await logToBotChannel(client, `❌ Failed to assign Test Team to ${actor.tag}: ${error.message}`);
            await replyToContext(context, '❌ I could not assign that role. Check my permissions and role hierarchy.', true);
        }
    }
};
