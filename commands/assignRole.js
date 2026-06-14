const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { logToBotChannel } = require('../services/logging');
const {
    getActor,
    getMember,
    isInteractionContext,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'assignrole',
    description: 'Assigns a role to a user.',
    slashData: new SlashCommandBuilder()
        .setName('assignrole')
        .setDescription('Assigns a role to a user.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addUserOption((option) => (
            option
                .setName('user')
                .setDescription('The user who should receive the role')
                .setRequired(true)
        ))
        .addRoleOption((option) => (
            option
                .setName('role')
                .setDescription('The role to assign')
                .setRequired(true)
        )),
    async execute(context, args, client) {
        const actor = getActor(context);
        const member = getMember(context);
        const isSlash = isInteractionContext(context);

        if (!context.guild || !member) {
            return replyToContext(context, 'This command can only be used in a server channel.', true);
        }

        if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return replyToContext(context, '🚫 You do not have permission to assign roles.', true);
        }

        let targetMember = null;
        let role = null;

        if (isSlash) {
            const targetUser = context.options.getUser('user', true);
            role = context.options.getRole('role', true);
            targetMember = await context.guild.members.fetch(targetUser.id).catch(() => null);
        } else {
            targetMember = context.mentions.members.first();
            const roleName = args.slice(1).join(' ').trim();
            role = roleName ? context.guild.roles.cache.find((existingRole) => existingRole.name === roleName) : null;
        }

        if (!targetMember || !role) {
            await logToBotChannel(client, `⚠️ ${actor.tag} failed an assignrole attempt (target or role missing).`);
            return replyToContext(context, '❌ Could not find the user or role.', true);
        }

        try {
            await targetMember.roles.add(role);
            await replyToContext(context, `✅ Assigned role **${role.name}** to ${targetMember.user.tag}.`, isSlash);
            await logToBotChannel(client, `✅ ${actor.tag} assigned \`${role.name}\` to \`${targetMember.user.tag}\`.`);
        } catch (error) {
            console.error(`[AssignRole] Failed for ${targetMember.user.tag}: ${error.message}`);
            await replyToContext(context, '❌ I could not assign that role. Check my permissions and role hierarchy.', true);
            await logToBotChannel(client, `❌ assignrole failed for ${actor.tag}: ${error.message}`);
        }
    }
};
