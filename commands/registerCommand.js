const config = require('../config');
const { registerUser } = require('../services/registerAccount');
const { logToBotChannel } = require('../services/logging');
const { dmUserPrompt } = require('../utils/promptHelper');
const registrationMap = require('../utils/registrationMap');
const { userHasPlayerRole } = require('../utils/roleCheck');
const { postActivationReview } = require('../services/activationReview');

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = {
    name: 'register',
    description: 'Registers a new Starforge account via DM.',
    async execute(message, args, client) {
        if (!message.guild || !message.member) {
            return message.reply('❌ Please run `!register` from the Starforge server, not from DM.');
        }

        if (!userHasPlayerRole(message.member)) {
            return message.reply('🚫 You must have the **Player** role to use this command.');
        }

        try {
            await message.reply('📩 I am sending you a DM now to finish registration.');

            const username = await dmUserPrompt(message.author, '📝 Please enter your desired **username**:');
            if (!username) {
                return message.author.send('❌ Registration cancelled because no username was received in time.');
            }

            const email = await dmUserPrompt(message.author, '📧 Please enter your **email**:');
            if (!email || !isValidEmail(email)) {
                return message.author.send('❌ Registration cancelled because the email was missing or invalid.');
            }

            const password = await dmUserPrompt(message.author, '🔒 Please enter your **password** (minimum 6 characters):');
            if (!password || password.length < 6) {
                return message.author.send('❌ Password must be at least 6 characters. Registration cancelled.');
            }

            const confirmPassword = await dmUserPrompt(message.author, '🔒 Please re-enter your password to confirm:');
            if (!confirmPassword || confirmPassword !== password) {
                return message.author.send('❌ Password confirmation did not match. Registration cancelled.');
            }

            const result = await registerUser(username, password, email, client, message);
            if (!result.success) {
                return message.author.send(`❌ Registration failed: ${result.message || 'Please try again later.'}`);
            }

            registrationMap.set(result.username, message.author.id);
            await message.author.send(`✅ Your account **${result.username}** has been registered. An admin will review and activate it soon.`);

            await postActivationReview(client, {
                username: result.username,
                email: email,
                discordUserId: message.author.id,
                requestedBy: message.author.tag,
                source: 'discord_register'
            });
            
        } catch (error) {
            console.error('Register command failed:', error);
            await logToBotChannel(client, `❌ Registration flow failed for ${message.author.tag}: ${error.message}`);
            await message.author.send('❌ Registration failed or timed out. Please try again later.');
        }
    }
};
