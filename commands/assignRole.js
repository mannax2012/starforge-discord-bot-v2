const { PermissionFlagsBits } = require('discord.js');
const { logToBotChannel } = require('../services/logging');

module.exports = {
    name: 'assignrole',
    description: 'Assigns a role to a mentioned user.',
    async execute(message, args, client) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply('🚫 You do not have permission to assign roles.');
        }

        const targetMember = message.mentions.members.first();
        const roleName = args.slice(1).join(' ').trim();
        const role = roleName ? message.guild.roles.cache.find(existingRole => existingRole.name === roleName) : null;

        if (!targetMember || !role) {
            await logToBotChannel(client, `⚠️ ${message.author.tag} failed an assignrole attempt (target or role missing).`);
            return message.reply('❌ Could not find the user or role.');
        }

        try {
            await targetMember.roles.add(role);
            await message.reply(`✅ Assigned role **${role.name}** to ${targetMember.user.tag}.`);
            await logToBotChannel(client, `✅ ${message.author.tag} assigned \`${role.name}\` to \`${targetMember.user.tag}\`.`);
        } catch (error) {
            console.error('assignrole failed:', error);
            await message.reply('❌ I could not assign that role. Check my permissions and role hierarchy.');
            await logToBotChannel(client, `❌ assignrole failed for ${message.author.tag}: ${error.message}`);
        }
    }
};
