const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const { logToBotChannel } = require('../services/logging');
const {
    getActor,
    getChannelId,
    isInteractionContext,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'info',
    description: 'Shows general Starforge information.',
    slashData: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Shows general Starforge information.'),
    async execute(context, args, client) {
        const actor = getActor(context);
        const isSlash = isInteractionContext(context);
        const commandLabel = isSlash ? '/info' : '!info';

        const infoMessage = [
            `📜 **Here is some basic Starforge information, <@${actor.id}>!**`,
            '',
            'To get started:',
            '🔗 Go to **https://swg-starforge.com** or use `/register` to create your account.',
            '🕒 Please allow up to **24 hours** for an admin to activate your account.',
            `💾 [Download SWG Starforge Installer](${config.downloadUrl})`,
            '',
            'Useful Commands:',
            '🤖 `/help` — Shows a list of commands.',
            '',
            '🔥 May the Force be with you!'
        ].join('\n');

        await replyToContext(context, infoMessage, isSlash);
        await logToBotChannel(
            client,
            `📥 ${actor.tag} used ${commandLabel}${getChannelId(context) ? ` in <#${getChannelId(context)}>` : ''}.`
        );
    }
};
