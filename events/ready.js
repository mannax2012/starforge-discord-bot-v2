const config = require('../config');
const { startStatusMonitor } = require('../services/statusMonitor');
const { startSwgChatBridge } = require('../services/swgChatBridge');
const { startEntBotService } = require('../services/entBotService');
const { startWebApi } = require('../web-api');

async function syncSlashCommands(client) {
    if (!config.features.commandsEnabled || !client.application || !client.commands) {
        return;
    }

    const slashCommands = client.commands
        .filter((command) => command.slashData)
        .map((command) => (
            typeof command.slashData.toJSON === 'function'
                ? command.slashData.toJSON()
                : command.slashData
        ));

    if (slashCommands.length === 0) {
        return;
    }

    await client.application.commands.set(slashCommands);
    console.log(`[Startup] Registered ${slashCommands.length} global slash command(s).`);
}

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        console.log(`[Startup] Discord client ready [user=${client.user.tag}] [mode=${config.mode}]`);

        await syncSlashCommands(client);

        if (config.features.statusEnabled) {
            startStatusMonitor();
        }

        if (config.features.webApiEnabled) {
            startWebApi(client);
        }

        if (config.features.swgChatEnabled) {
            await startSwgChatBridge(client);
        }

        if (config.features.entBotEnabled) {
            startEntBotService();
        }
    }
};
