async function dmUserPrompt(user, promptText, time = 60000) {
    try {
        const dmChannel = await user.createDM();
        await dmChannel.send(promptText);

        const collected = await dmChannel.awaitMessages({
            max: 1,
            time,
            errors: ['time'],
            filter: message => message.author.id === user.id
        });

        const reply = collected.first();
        return reply ? reply.content.trim() : null;
    } catch (error) {
        console.warn(`DM prompt failed or timed out: ${error.message}`);
        return null;
    }
}

module.exports = {
    dmUserPrompt
};
