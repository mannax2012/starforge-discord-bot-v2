const { SlashCommandBuilder } = require('discord.js');
const { registerUser } = require('../services/registerAccount');
const { postActivationReview } = require('../services/activationReview');
const { logToBotChannel } = require('../services/logging');
const { dmUserPrompt } = require('../utils/promptHelper');
const registrationMap = require('../utils/registrationMap');
const { userHasPlayerRole } = require('../utils/roleCheck');
const {
    getActor,
    getMember,
    isInteractionContext,
    replyToContext
} = require('../utils/commandContext');

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function safeSendDm(user, content) {
    try {
        await user.send(content);
    } catch (error) {
        console.warn(`[Discord Register] Failed to DM ${user && user.tag ? user.tag : 'unknown user'}: ${error.message}`);
    }
}

module.exports = {
    name: 'register',
    description: 'Registers a new Starforge account via DM.',
    slashData: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Starts the Starforge account registration process in DM.'),
    async execute(context, args, client) {
        const actor = getActor(context);
        const member = getMember(context);
        const commandLabel = isInteractionContext(context) ? '/register' : '!register';

        if (!context.guild || !member) {
            return replyToContext(
                context,
                `❌ Please run \`${commandLabel}\` from the Starforge server, not from DM.`,
                true
            );
        }

        if (!userHasPlayerRole(member)) {
            return replyToContext(context, '🚫 You must have the **Player** role to use this command.', true);
        }

        try {
            await replyToContext(
                context,
                '📩 I am sending you a DM now to finish registration.',
                isInteractionContext(context)
            );

            const username = await dmUserPrompt(actor, '📝 Please enter your desired **username**:');
            if (!username) {
                await safeSendDm(actor, '❌ Registration cancelled because no username was received in time.');
                return;
            }

            const email = await dmUserPrompt(actor, '📧 Please enter your **email**:');
            if (!email || !isValidEmail(email)) {
                await safeSendDm(actor, '❌ Registration cancelled because the email was missing or invalid.');
                return;
            }

            const password = await dmUserPrompt(actor, '🔒 Please enter your **password** (minimum 6 characters):');
            if (!password || password.length < 6) {
                await safeSendDm(actor, '❌ Password must be at least 6 characters. Registration cancelled.');
                return;
            }

            const confirmPassword = await dmUserPrompt(actor, '🔒 Please re-enter your password to confirm:');
            if (!confirmPassword || confirmPassword !== password) {
                await safeSendDm(actor, '❌ Password confirmation did not match. Registration cancelled.');
                return;
            }

            const result = await registerUser(username, password, email, client, context);
            if (!result.success) {
                await safeSendDm(actor, `❌ Registration failed: ${result.message || 'Please try again later.'}`);
                return;
            }

            const reviewResult = await postActivationReview(client, {
                username: result.username,
                email: result.email,
                stationId: result.stationId || '',
                discordUserId: actor.id,
                requestedBy: actor.tag,
                source: 'discord_register'
            });

            if (!reviewResult.success) {
                await logToBotChannel(
                    client,
                    `⚠️ Account \`${result.username}\` was registered through Discord, but the activation review post failed.`
                );
            }

            registrationMap.set(result.username, actor.id);

            await safeSendDm(
                actor,
                `✅ Your account **${result.username}** has been registered. An admin will review and activate it soon.`
            );
        } catch (error) {
            console.error(`[Discord Register] Flow failed for ${actor.tag}: ${error.message}`);
            await logToBotChannel(client, `❌ Registration flow failed for ${actor.tag}: ${error.message}`);
            await safeSendDm(actor, '❌ Registration failed or timed out. Please try again later.');
        }
    }
};
