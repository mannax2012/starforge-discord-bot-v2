const config = require('../config');
const { logToBotChannel } = require('../services/logging');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member, client) {
        await member.guild.roles.fetch();

        const role = member.guild.roles.cache.find(existingRole => existingRole.name === config.autoRoleName);
        if (!role) {
            await logToBotChannel(client, `⚠️ Role "${config.autoRoleName}" was not found in guild "${member.guild.name}".`);
            return;
        }

        try {
            await member.roles.add(role);
            await logToBotChannel(client, `✅ Assigned role "${role.name}" to ${member.user.tag} (<@${member.id}>).`);
        } catch (error) {
            await logToBotChannel(client, `❌ Failed to assign "${role.name}" to ${member.user.tag}: ${error.message}`);
            return;
        }

        const welcomeChannel = member.guild.channels.cache.find(channel => channel.name === config.welcomeChannelName && channel.isTextBased());
        if (!welcomeChannel) {
            await logToBotChannel(client, `⚠️ Welcome channel "${config.welcomeChannelName}" was not found.`);
            return;
        }

        const welcomeMessage = [
            `📜 **Welcome to Starforge, <@${member.id}>!**`,
            '',
            'To get started:',
            '🔗 Go to **https://swg-starforge.com** or use `!register` to create your account.',
            '🕒 Please allow up to **24 hours** for an admin to activate your account.',
            `💾 [Download SWG Starforge Installer](${config.downloadUrl})`,
            '',
            'Useful Commands:',
            '🤖 `!help` — Shows a list of things I can do for you!',
            '',
            '🔥 May the Force be with you!'
        ].join('\n');

        await welcomeChannel.send({ content: welcomeMessage });
    }
};
