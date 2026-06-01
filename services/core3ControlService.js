const { spawn } = require('child_process');
const config = require('../config');

const ALLOWED_ACTIONS = new Set(['run', 'stop', 'status', 'capture-crash']);
let core3RunInProgress = false;

function quoteForBash(value) {
    return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

function parseKeyValueLines(output) {
    const data = {};
    const lines = String(output || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();

        if (!key) {
            continue;
        }

        data[key] = value;
    }

    if (typeof data.core3_pids === 'string') {
        data.core3Pids = data.core3_pids
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
    } else {
        data.core3Pids = [];
    }

    return data;
}

function buildCommandArguments(action) {
    const shellCommand = `cd ${quoteForBash(config.core3Control.wslRepoPath)} && ${quoteForBash(config.core3Control.scriptPath)} ${action}`;

    if (process.platform === 'win32') {
        return {
            command: config.core3Control.wslCommand,
            args: ['-e', 'bash', '-lc', shellCommand]
        };
    }

    return {
        command: 'bash',
        args: ['-lc', shellCommand]
    };
}

function executeCore3Control(action) {
    return new Promise((resolve, reject) => {
        const { command, args } = buildCommandArguments(action);
        const child = spawn(command, args, {
            cwd: process.cwd(),
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            reject(error);
        });

        const timeoutMs = Number(config.core3Control.timeoutMs) || 120000;
        const timeoutId = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Core3 control action timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        child.on('close', (code) => {
            clearTimeout(timeoutId);

            const parsed = parseKeyValueLines(stdout);
            const rawStdout = String(stdout || '').trim();
            const rawStderr = String(stderr || '').trim();
            const success = code === 0;

            resolve({
                success,
                action,
                exitCode: code,
                message: success
                    ? `Core3 ${action} completed.`
                    : rawStderr || rawStdout || `Core3 ${action} failed.`,
                data: {
                    ...parsed,
                    rawStdout,
                    rawStderr
                }
            });
        });
    });
}

function isTruthyStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === 'running';
}

function isCore3Running(data) {
    if (!data || typeof data !== 'object') {
        return false;
    }

    if (Array.isArray(data.core3Pids) && data.core3Pids.length > 0) {
        return true;
    }

    if (isTruthyStatus(data.core3_running) || isTruthyStatus(data.running) || isTruthyStatus(data.is_running)) {
        return true;
    }

    const statusText = String(data.status || data.core3_status || '').trim().toLowerCase();
    return statusText === 'running' || statusText === 'started' || statusText === 'up';
}

async function runCore3Control(action) {
    if (!config.core3Control || !config.core3Control.enabled) {
        throw new Error('Core3 control integration is disabled.');
    }

    if (!ALLOWED_ACTIONS.has(action)) {
        throw new Error(`Unsupported Core3 action: ${action}`);
    }

    if (action === 'run') {
        if (core3RunInProgress) {
            return {
                success: false,
                action,
                exitCode: null,
                statusCode: 409,
                message: 'Core3 run is already in progress.',
                data: null
            };
        }

        core3RunInProgress = true;

        try {
            const statusResult = await executeCore3Control('status');

            if (!statusResult.success) {
                return {
                    success: false,
                    action,
                    exitCode: statusResult.exitCode,
                    statusCode: 500,
                    message: `Unable to verify Core3 status before run: ${statusResult.message}`,
                    data: statusResult.data || null
                };
            }

            if (isCore3Running(statusResult.data)) {
                return {
                    success: false,
                    action,
                    exitCode: 0,
                    statusCode: 409,
                    message: 'Core3 is already running.',
                    data: statusResult.data || null
                };
            }

            const runResult = await executeCore3Control('run');
            return {
                ...runResult,
                statusCode: runResult.success ? 200 : 500
            };
        } finally {
            core3RunInProgress = false;
        }
    }

    const result = await executeCore3Control(action);
    return {
        ...result,
        statusCode: result.success ? 200 : 500
    };
}

module.exports = {
    runCore3Control
};
