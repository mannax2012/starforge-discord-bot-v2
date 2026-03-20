const { startStatusMonitor } = require('../services/statusMonitor');
const { startWebApi } = require('../web-api');

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        console.log(`Logged in as ${client.user.tag}`);
        startStatusMonitor();
        startWebApi(client);
    }
};