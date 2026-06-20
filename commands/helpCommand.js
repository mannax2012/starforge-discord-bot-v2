const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const { logToBotChannel } = require('../services/logging');
const { userHasAdminRole } = require('../utils/roleCheck');
const {
    getActor,
    getChannelId,
    getMember,
    isInteractionContext,
    replyToContext
} = require('../utils/commandContext');

module.exports = {
    name: 'help',
    description: 'Lists available commands and usage.',
    slashData: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Lists available commands and usage.'),
    async execute(context, args, client) {
        const actor = getActor(context);
        const member = getMember(context);
        const isSlash = isInteractionContext(context);
        const commandLabel = isSlash ? '/help' : '!help';
        const adminPanelExample = config.isTcMode
            ? '/adminpanel mode:tc'
            : '/adminpanel mode:live';
        const isAdmin = Boolean(member) && userHasAdminRole(member);
        const canManageRoles = Boolean(member && member.permissions && member.permissions.has(PermissionFlagsBits.ManageRoles));

        const helpLines = [
            '**Starforge Bot Commands**',
            '',
            '**Player Commands**',
            '> `/help` - Show this command list.',
            '> `/info` - Show general Starforge information.',
            '> `/status` - Show current Starforge server status.',
            '> `/register` - Start the account registration process in DM.',
            '> `/download` - Get the launcher installer link.',
            '> `/test` - Assign yourself the **Test Team** role.',
            '> `/jedi` - Assign yourself the **Jedi** role.',
            '> `/bhguild` - Assign yourself the **Hunters Guild** role.',
            '> `/chatstatus` - Show the current SWG chat relay state.'
        ];

        if (isAdmin || canManageRoles) {
            helpLines.push('', '**Admin Commands**');
        }

        if (isAdmin) {
            helpLines.push(
                '> `/pausechat` - Pause or resume the SWG chat relay.',
                '> `/fixchat` - Reconnect the SWG chat relay.',
                '> `/fixent` - Reconnect the entertainer bot worker.',
                '> `/debugchat` - Enable verbose SWG chat logging.',
                `> \`${adminPanelExample}\` - Open the current Core3 and Ent Bot admin control panel in DM.`,
                '> `/activate username:<accountname>` - Activate an account.'
            );
        }

        if (canManageRoles) {
            helpLines.push('> `/assignrole user:<member> role:<role>` - Assign a role.');
        }

        helpLines.push(
            '',
            'Legacy `!command` aliases still work for now.',
            '',
            `May the Force be with you, ${actor.username}!`
        );

        const helpMessage = helpLines.join('\n');

        await replyToContext(context, helpMessage, isSlash);
        await logToBotChannel(
            client,
            `${actor.tag} used ${commandLabel}${getChannelId(context) ? ` in <#${getChannelId(context)}>` : ''}.`
        );
    }
};
