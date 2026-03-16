const config = require('../config');
const { userHasPlayerRole } = require('../utils/roleCheck');
const { logToBotChannel } = require('../services/logging');

module.exports = {
    name: 'download',
    description: 'Provides the Starforge launcher download link.',
    async execute(message, args, client) {
        if (!message.guild || !message.member) {
            return message.reply('❌ This command can only be used in a server channel.');
        }

        if (!userHasPlayerRole(message.member)) {
            return message.reply('🚫 You must have the **Player** role to use this command.');
        }

        const downloadMessage = [
            '📜 **Starforge Launcher Download Link**',
            '',
            'Click the link below to get started:',
            `🔗 [Download SWG Starforge Installer](${config.downloadUrl})`,
            '',
            `May the Force be with you, **${message.author.username}**! ✨`
        ].join('\n');

        await message.reply(downloadMessage);
        await logToBotChannel(client, `📥 ${message.author.tag} used !download in <#${message.channel.id}>.`);
    }
};
