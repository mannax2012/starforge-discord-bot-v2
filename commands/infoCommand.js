const config = require('../config');
const { logToBotChannel } = require('../services/logging');

module.exports = {
    name: 'info',
    description: 'Shows general Starforge information.',
    async execute(message, args, client) {
        const infoMessage = [
            `📜 **Here is some basic Starforge information, <@${message.author.id}>!**`,
            '',
            'To get started:',
            '🔗 Go to **https://swg-starforge.com** or use `!register` to create your account.',
            '🕒 Please allow up to **24 hours** for an admin to activate your account.',
            `💾 [Download SWG Starforge Installer](${config.downloadUrl})`,
            '',
            'Useful Commands:',
            '🤖 `!help` — Shows a list of commands.',
            '',
            '🔥 May the Force be with you!'
        ].join('\n');

        await message.reply(infoMessage);
        await logToBotChannel(client, `📥 ${message.author.tag} used !info in <#${message.channel.id}>.`);
    }
};
