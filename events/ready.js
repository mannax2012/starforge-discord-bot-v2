const { startStatusMonitor } = require('../services/statusMonitor');

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        console.log(`Logged in as ${client.user.tag}`);
        startStatusMonitor();
    }
};