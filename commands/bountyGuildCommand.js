const { SlashCommandBuilder } = require('discord.js');
const { userHasPlayerRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');
const {
    getActor,
    getMember,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'bhguild',
    description: 'Assigns the Hunters Guild role to the member using the command.',
    slashData: new SlashCommandBuilder()
        .setName('bhguild')
        .setDescription('Assigns the Hunters Guild role to you.'),
    async execute(context, args, client) {
        const actor = getActor(context);
        const member = getMember(context);

        if (!context.guild || !member) {
            return replyToContext(context, '❌ This command can only be used in a server channel.', true);
        }

        if (!userHasPlayerRole(member)) {
            return replyToContext(context, '🚫 You must have the **Player** role to use this command.', true);
        }

        const role = context.guild.roles.cache.find((existingRole) => existingRole.name === 'Hunters Guild');
        if (!role) {
            await logToBotChannel(client, `❌ ${actor.tag} used /bhguild but the Hunters Guild role was not found.`);
            return replyToContext(context, '❌ The **Hunters Guild** role does not exist.', true);
        }

        if (member.roles.cache.has(role.id)) {
            return replyToContext(context, '🗡️ You already have the **Hunters Guild** role.', true);
        }

        try {
            await member.roles.add(role);
            await replyToContext(context, '✅ You have been given the **Hunters Guild** role.', true);
            await logToBotChannel(client, `✅ ${actor.tag} self-assigned Hunters Guild.`);
        } catch (error) {
            await logToBotChannel(client, `❌ Failed to assign Hunters Guild to ${actor.tag}: ${error.message}`);
            await replyToContext(context, '❌ I could not assign that role. Check my permissions and role hierarchy.', true);
        }
    }
};
