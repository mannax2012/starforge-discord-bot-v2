const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { formatAttemptedEndpoints, postTcApiJson } = require('../utils/tcApiFetch');

const PANEL_PREFIX = 'core3_admin_panel';
const PANEL_ACTIONS = new Set(['run', 'stop', 'stop-confirm', 'stop-cancel', 'capture-crash', 'shutdown', 'shutdown-submit']);
const PANEL_MODES = new Set(['live', 'tc']);

function normalizePanelMode(mode) {
    const normalized = String(mode || config.core3AdminApi && config.core3AdminApi.defaultMode || 'live').trim().toLowerCase();
    return PANEL_MODES.has(normalized) ? normalized : null;
}

function formatModeLabel(mode) {
    return normalizePanelMode(mode) === 'tc' ? 'TC' : 'Live';
}

function getModeApiConfig(mode) {
    const normalizedMode = normalizePanelMode(mode);

    if (!normalizedMode) {
        throw new Error(`Unsupported Core3 panel mode: ${mode}`);
    }

    const modeConfig = config.core3AdminApi && config.core3AdminApi[normalizedMode]
        ? config.core3AdminApi[normalizedMode]
        : null;

    if (!modeConfig || !String(modeConfig.baseUrl || '').trim()) {
        throw new Error(`Core3 admin API base URL is not configured for ${normalizedMode}.`);
    }

    return {
        mode: normalizedMode,
        baseUrl: String(modeConfig.baseUrl || '').trim().replace(/\/+$/, ''),
        sharedSecret: String(modeConfig.sharedSecret || '').trim()
    };
}

function buildCore3AdminEndpoint(mode, pathname) {
    const modeConfig = getModeApiConfig(mode);
    return `${modeConfig.baseUrl}${pathname}`;
}

function buildButtonCustomId(ownerId, mode, action, messageId) {
    const parts = [PANEL_PREFIX, ownerId, normalizePanelMode(mode), action];

    if (messageId) {
        parts.push(String(messageId).trim());
    }

    return parts.join(':');
}

function buildButtonRow(ownerId, mode, disabled) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(buildButtonCustomId(ownerId, mode, 'run'))
            .setLabel('Run Core3')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(buildButtonCustomId(ownerId, mode, 'capture-crash'))
            .setLabel('Capture Crash')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(buildButtonCustomId(ownerId, mode, 'shutdown'))
            .setLabel('Shutdown Core3')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(buildButtonCustomId(ownerId, mode, 'stop'))
            .setLabel('Stop Core3')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled)
    );
}

function buildStopConfirmRow(ownerId, mode) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(buildButtonCustomId(ownerId, mode, 'stop-confirm'))
            .setLabel('Yes, Force Stop')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(buildButtonCustomId(ownerId, mode, 'stop-cancel'))
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
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

function buildCore3AdminPanel(ownerId, openedByTag, mode, status) {
    const disabled = !!(status && status.state === 'working');
    const normalizedMode = normalizePanelMode(mode);

    return {
        content: [
            `**Core3 Admin Panel (${formatModeLabel(normalizedMode)})**`,
            `Opened by: ${openedByTag}`,
            'Use the buttons below to control Core3.',
            'Shutdown is the clean save path and will ask for minutes.',
            'Stop is a forced non-clean stop. It captures crash artifacts first, then sends the stop request.',
            '',
            formatPanelStatus(status)
        ].join('\n'),
        components: [buildButtonRow(ownerId, normalizedMode, disabled)]
    };
}

function buildCore3StopConfirmPanel(ownerId, openedByTag, mode) {
    const normalizedMode = normalizePanelMode(mode);

    return {
        content: [
            `**Confirm Forced Stop (${formatModeLabel(normalizedMode)})**`,
            `Opened by: ${openedByTag}`,
            'This is not a clean shutdown.',
            'Use `Shutdown Core3` if you want the server to disconnect players and save state cleanly.',
            'Forced stop will capture crash artifacts first, then terminate Core3.',
            '',
            'Are you sure you want to continue?'
        ].join('\n'),
        components: [buildStopConfirmRow(ownerId, normalizedMode)]
    };
}

function parseCore3AdminPanelCustomId(customId) {
    const parts = String(customId || '').split(':');

    if (parts[0] !== PANEL_PREFIX) {
        return null;
    }

    if (parts.length === 4 || parts.length === 5) {
        const ownerId = String(parts[1] || '').trim();
        const mode = normalizePanelMode(parts[2]);
        const action = String(parts[3] || '').trim();
        const messageId = parts.length === 5
            ? String(parts[4] || '').trim()
            : '';

        if (!ownerId || !mode || !PANEL_ACTIONS.has(action)) {
            return null;
        }

        return {
            ownerId,
            mode,
            action,
            messageId
        };
    }

    if (parts.length !== 3) {
        return null;
    }

    const ownerId = String(parts[1] || '').trim();
    const action = String(parts[2] || '').trim();

    if (!ownerId || !PANEL_ACTIONS.has(action)) {
        return null;
    }

        return {
            ownerId,
            mode: normalizePanelMode(config.core3AdminApi && config.core3AdminApi.defaultMode || 'live'),
            action,
            messageId: ''
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
    case 'shutdown':
        return '/api/admin/core3/shutdown';
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

async function callCore3AdminEndpoint(action, mode, payload) {
    const normalizedMode = normalizePanelMode(mode);
    const modeConfig = getModeApiConfig(normalizedMode);
    const endpoint = buildCore3AdminEndpoint(normalizedMode, buildActionPath(action));
    const requestLabel = `${formatModeLabel(normalizedMode)} Core3 ${action}`;
    const requestResult = await postTcApiJson(
        endpoint,
        modeConfig.sharedSecret,
        payload || {},
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
        mode: normalizedMode,
        message: formatJsonMessage(json, success ? `${requestLabel} completed.` : `${requestLabel} failed.`),
        data: json.data || null
    };
}

async function executeCore3AdminPanelAction(action, mode, options) {
    const normalizedMode = normalizePanelMode(mode);
    const actionOptions = options || {};

    if (action === 'stop') {
        const captureCrashResult = await callCore3AdminEndpoint('capture-crash', normalizedMode);

        if (!captureCrashResult.success) {
            return {
                success: false,
                action,
                mode: normalizedMode,
                message: `Crash capture failed before ${formatModeLabel(normalizedMode)} stop: ${captureCrashResult.message}`,
                details: {
                    captureCrashResult,
                    stopResult: null
                }
            };
        }

        const stopResult = await callCore3AdminEndpoint('stop', normalizedMode);

        return {
            success: stopResult.success,
            action,
            mode: normalizedMode,
            message: stopResult.success
                ? `Crash capture completed, then ${formatModeLabel(normalizedMode)} Core3 stop completed.`
                : `Crash capture completed, but ${formatModeLabel(normalizedMode)} Core3 stop failed: ${stopResult.message}`,
            details: {
                captureCrashResult,
                stopResult
            }
        };
    }

    const payload = action === 'shutdown'
        ? { minutes: actionOptions.minutes }
        : {};

    const result = await callCore3AdminEndpoint(action, normalizedMode, payload);

    return {
        success: result.success,
        action,
        mode: normalizedMode,
        message: result.message,
        details: {
            directResult: result
        }
    };
}

function getActionLabel(action, mode) {
    const prefix = `${formatModeLabel(mode)} Core3`;

    switch (action) {
    case 'run':
        return `Run ${prefix}`;
    case 'stop':
        return `Stop ${prefix}`;
    case 'capture-crash':
        return `Capture Crash (${prefix})`;
    case 'shutdown':
        return `Shutdown ${prefix}`;
    default:
        return `${prefix} Action`;
    }
}

module.exports = {
    buildCore3AdminPanel,
    buildButtonCustomId,
    buildCore3StopConfirmPanel,
    executeCore3AdminPanelAction,
    formatModeLabel,
    getActionLabel,
    normalizePanelMode,
    parseCore3AdminPanelCustomId
};
