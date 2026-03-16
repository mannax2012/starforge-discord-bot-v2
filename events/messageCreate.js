const config = require('../config');

module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        if (message.author.bot) {
            return;
        }

        if (!message.content.startsWith(config.prefix)) {
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
            console.error(`Command ${commandName} failed:`, error);
            await message.reply('❌ There was an error executing that command.');
        }
    }
};
