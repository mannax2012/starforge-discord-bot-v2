const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');

function normalizeSource(source) {
    return String(source || '').trim().toLowerCase();
}

function getSourceLabel(source) {
    switch (normalizeSource(source)) {
        case 'website_register':
            return 'Website Registration';
        case 'discord_register':
            return 'Discord Registration';
        case 'website_resend':
            return 'Website Activation Request';
        case 'discord_resend':
            return 'Discord Activation Request';
        default:
            return 'Activation Review';
    }
}

function getTitle(source) {
    switch (normalizeSource(source)) {
        case 'website_register':
        case 'discord_register':
            return 'New Account Awaiting Activation';
        case 'website_resend':
        case 'discord_resend':
            return 'Activation Request Received';
        default:
            return 'Activation Approval Requested';
    }
}

function getDescription(source, username) {
    switch (normalizeSource(source)) {
        case 'website_register':
            return `Website registration for **${username}** is complete and waiting for staff activation.`;
        case 'discord_register':
            return `Discord registration for **${username}** is complete and waiting for staff activation.`;
        case 'website_resend':
            return `**${username}** requested another activation review from the website portal.`;
        case 'discord_resend':
            return `**${username}** requested another activation review from Discord.`;
        default:
            return `Account **${username}** requires staff activation.`;
    }
}

async function postActivationReview(client, options) {
    const username = String(options && options.username ? options.username : '').trim();
    const email = options && options.email ? String(options.email).trim() : '';
    const requestedBy = options && options.requestedBy ? String(options.requestedBy).trim() : username;
    const source = options && options.source ? String(options.source).trim() : 'unknown';
    const discordUserId = options && options.discordUserId ? String(options.discordUserId).trim() : '';
    const stationId = options && options.stationId !== undefined && options.stationId !== null
        ? String(options.stationId).trim()
        : '';

    if (!client || !config.accountReviewChannelId || !username) {
        return {
            success: false,
            message: 'Missing review channel or username.'
        };
    }

    const channel = await client.channels.fetch(config.accountReviewChannelId);
    if (!channel || !channel.isTextBased()) {
        return {
            success: false,
            message: 'Account review channel is unavailable.'
        };
    }

    const embed = new EmbedBuilder()
        .setTitle(getTitle(source))
        .setDescription(getDescription(source, username))
        .addFields(
            { name: 'Account', value: username, inline: true },
            { name: 'Requested By', value: requestedBy || username, inline: true },
            { name: 'Source', value: getSourceLabel(source), inline: true }
        );

    if (email) {
        embed.addFields({
            name: 'Email',
            value: email,
            inline: false
        });
    }

    if (stationId) {
        embed.addFields({
            name: 'Station ID',
            value: stationId,
            inline: true
        });
    }

    if (discordUserId) {
        embed.addFields({
            name: 'Discord User',
            value: `<@${discordUserId}>`,
            inline: false
        });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`activate_account:${username}`)
            .setLabel(`Activate ${username}`)
            .setStyle(ButtonStyle.Success)
    );

    const sent = await channel.send({
        embeds: [embed],
        components: [row]
    });

    return {
        success: true,
        messageId: sent.id,
        channelId: sent.channelId
    };
}

module.exports = {
    postActivationReview
};