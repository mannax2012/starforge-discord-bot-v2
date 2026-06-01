const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { formatAttemptedEndpoints, postTcApiJson } = require('../utils/tcApiFetch');

const PANEL_PREFIX = 'core3_admin_panel';
const PANEL_ACTIONS = new Set(['run', 'stop', 'capture-crash']);

function buildCore3AdminEndpoint(pathname) {
    const port = Number(config.webListener && config.webListener.port) || 44557;
    return `http://127.0.0.1:${port}${pathname}`;
}

function buildButtonCustomId(ownerId, action) {
    return `${PANEL_PREFIX}:${ownerId}:${action}`;
}

function buildButtonRow(ownerId, disabled) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(buildButtonCustomId(ownerId, 'run'))
            .setLabel('Run Core3')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(buildButtonCustomId(ownerId, 'capture-crash'))
            .setLabel('Capture Crash')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(buildButtonCustomId(ownerId, 'stop'))
            .setLabel('Stop Core3')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled)
    );
}

function formatPanelStatus(status) {
    if (!status) {
        return 'Last action: none yet.';
    }

    if (status.state === 'working') {
        return `Working: ${status.label}...`;
    }

    const timestamp = status.timestamp
        ? ` at ${status.timestamp}`
        : '';

    return `${status.success ? 'Success' : 'Failed'}${timestamp}: ${status.message}`;
}

function buildCore3AdminPanel(ownerId, openedByTag, status) {
    const disabled = !!(status && status.state === 'working');

    return {
        content: [
            '**Core3 Admin Panel**',
            `Opened by: ${openedByTag}`,
            'Use the buttons below to control Core3.',
            'Stop always runs crash capture first, then sends the stop request.',
            '',
            formatPanelStatus(status)
        ].join('\n'),
        components: [buildButtonRow(ownerId, disabled)]
    };
}

function parseCore3AdminPanelCustomId(customId) {
    const parts = String(customId || '').split(':');

    if (parts.length !== 3 || parts[0] !== PANEL_PREFIX) {
        return null;
    }

    const ownerId = String(parts[1] || '').trim();
    const action = String(parts[2] || '').trim();

    if (!ownerId || !PANEL_ACTIONS.has(action)) {
        return null;
    }

    return {
        ownerId,
        action
    };
}

function buildActionPath(action) {
    switch (action) {
    case 'run':
        return '/api/admin/core3/run';
    case 'stop':
        return '/api/admin/core3/stop';
    case 'capture-crash':
        return '/api/admin/core3/capture-crash';
    default:
        throw new Error(`Unsupported Core3 admin action: ${action}`);
    }
}

function formatJsonMessage(json, fallback) {
    const message = json && typeof json.message === 'string'
        ? json.message.trim()
        : '';

    return message || fallback;
}

async function callCore3AdminEndpoint(action) {
    const endpoint = buildCore3AdminEndpoint(buildActionPath(action));
    const requestLabel = `Core3 ${action}`;
    const requestResult = await postTcApiJson(
        endpoint,
        config.webListener && config.webListener.sharedSecret,
        {},
        requestLabel
    );

    if (!requestResult.ok) {
        return {
            success: false,
            action,
            message: `${requestLabel} request failed.${formatAttemptedEndpoints(requestResult.attemptedEndpoints)}`.trim(),
            data: null
        };
    }

    const response = requestResult.response;
    const json = requestResult.json || {};
    const success = !!(response && response.ok && json.success);

    return {
        success,
        action,
        message: formatJsonMessage(json, success ? `${requestLabel} completed.` : `${requestLabel} failed.`),
        data: json.data || null
    };
}

async function executeCore3AdminPanelAction(action) {
    if (action === 'stop') {
        const captureCrashResult = await callCore3AdminEndpoint('capture-crash');

        if (!captureCrashResult.success) {
            return {
                success: false,
                action,
                message: `Crash capture failed before stop: ${captureCrashResult.message}`,
                details: {
                    captureCrashResult,
                    stopResult: null
                }
            };
        }

        const stopResult = await callCore3AdminEndpoint('stop');

        return {
            success: stopResult.success,
            action,
            message: stopResult.success
                ? 'Crash capture completed, then Core3 stop completed.'
                : `Crash capture completed, but Core3 stop failed: ${stopResult.message}`,
            details: {
                captureCrashResult,
                stopResult
            }
        };
    }

    const result = await callCore3AdminEndpoint(action);

    return {
        success: result.success,
        action,
        message: result.message,
        details: {
            directResult: result
        }
    };
}

function getActionLabel(action) {
    switch (action) {
    case 'run':
        return 'Run Core3';
    case 'stop':
        return 'Stop Core3';
    case 'capture-crash':
        return 'Capture Crash';
    default:
        return 'Core3 Action';
    }
}

module.exports = {
    buildCore3AdminPanel,
    executeCore3AdminPanelAction,
    getActionLabel,
    parseCore3AdminPanelCustomId
};
