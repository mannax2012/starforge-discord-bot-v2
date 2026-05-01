const config = require('../config');
const { startStatusMonitor } = require('../services/statusMonitor');
const { startSwgChatBridge } = require('../services/swgChatBridge');
const { startWebApi } = require('../web-api');

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        console.log(`Logged in as ${client.user.tag} [mode=${config.mode}]`);

        if (config.features.statusEnabled) {
            startStatusMonitor();
        }

        if (config.features.webApiEnabled) {
            startWebApi(client);
        }

        if (config.features.swgChatEnabled) {
            await startSwgChatBridge(client);
        }
    }
};
