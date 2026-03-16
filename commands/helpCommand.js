const { logToBotChannel } = require('../services/logging');

module.exports = {
    name: 'help',
    description: 'Lists available commands and usage.',
    async execute(message, args, client) {
        const helpMessage = [
            '📜 **Starforge Bot Commands**',
            '',
            '> 🤖 `!info` — Show general Starforge information.',
            '> 📡 `!status` — Show current Starforge server status.',
            '> 🆔 `!register` — Start the account registration process in DM.',
            '> 💾 `!download` — Get the launcher installer link.',
            '> 🧪 `!test` — Assign yourself the **Test Team** role.',
            '> 💬 `!jedi` — Assign yourself the **Jedi** role.',
            '> 💬 `!bhguild` — Assign yourself the **Hunters Guild** role.',
            '',
            `May the Force be with you, ${message.author.username}! 🔥`
        ].join('\n');

        await message.reply(helpMessage);
        await logToBotChannel(client, `📥 ${message.author.tag} used !help in <#${message.channel.id}>.`);
    }
};
