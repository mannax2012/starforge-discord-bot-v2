const config = require('../config');
const { handleDiscordMessage } = require('../services/swgChatBridge');

module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        if (message.author.bot) {
            return;
        }

        if (config.isTcMode) {
            if (!message.content.startsWith(config.prefix)) {
                return;
            }

            const args = message.content.slice(config.prefix.length).trim().split(/\s+/);
            const commandName = (args.shift() || '').toLowerCase();

            if (commandName !== 'adminpanel' || String(args[0] || '').toLowerCase() !== 'tc') {
                return;
            }

            const command = client.commands.get(commandName);
            if (!command) {
                return;
            }

            try {
                await command.execute(message, args, client);
            } catch (error) {
                console.error(`[Command] ${commandName} failed: ${error.message}`);
                await message.reply('âŒ There was an error executing that command.');
            }
            return;
        }

        if (!message.content.startsWith(config.prefix)) {
            await handleDiscordMessage(message, client);
            return;
        }

        const args = message.content.slice(config.prefix.length).trim().split(/\s+/);
        const commandName = (args.shift() || '').toLowerCase();
        const command = client.commands.get(commandName);

        if (!command) {
            return;
        }

        try {
            await command.execute(message, args, client);
        } catch (error) {
            console.error(`[Command] ${commandName} failed: ${error.message}`);
            await message.reply('❌ There was an error executing that command.');
        }
    }
};
