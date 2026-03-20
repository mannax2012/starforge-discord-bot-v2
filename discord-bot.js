const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config = require('./config');
const { startWebApi } = require('./web-api');

if (!config.token) {
    throw new Error('DISCORD_TOKEN is missing. Set it in your .env file.');
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    if (!command || !command.name || typeof command.execute !== 'function') {
        console.warn(`Skipping invalid command module: ${file}`);
        continue;
    }
    client.commands.set(command.name, command);
}

const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'))) {
    const event = require(path.join(eventsPath, file));
    if (!event || !event.name || typeof event.execute !== 'function') {
        console.warn(`Skipping invalid event module: ${file}`);
        continue;
    }

    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

startWebApi(client);
client.login(config.token);