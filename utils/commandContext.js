function isInteractionContext(context) {
    return Boolean(context && context.user && typeof context.reply === 'function');
}

function getActor(context) {
    return context && (context.author || context.user) ? (context.author || context.user) : null;
}

function getMember(context) {
    return context && context.member ? context.member : null;
}

function getChannelId(context) {
    if (!context) {
        return '';
    }

    if (context.channelId) {
        return String(context.channelId);
    }

    if (context.channel && context.channel.id) {
        return String(context.channel.id);
    }

    return '';
}

async function replyToContext(context, payload, ephemeral = false) {
    if (isInteractionContext(context)) {
        const normalized = typeof payload === 'string'
            ? { content: payload }
            : { ...(payload || {}) };

        if (ephemeral) {
            normalized.ephemeral = true;
        }

        if (context.replied || context.deferred) {
            return context.followUp(normalized);
        }

        return context.reply(normalized);
    }

    if (typeof payload === 'string') {
        return context.reply(payload);
    }

    return context.reply(payload);
}

module.exports = {
    getActor,
    getChannelId,
    getMember,
    isInteractionContext,
    replyToContext
};
