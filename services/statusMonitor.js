const fs = require('fs');
const path = require('path');
const net = require('net');
const config = require('../config');

const FAILURE_THRESHOLD = 3;

function ensureDirectoryForFile(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
}

function loadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }

        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);

        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (error) {
        return fallback;
    }
}

function writeJsonAtomic(filePath, data) {
    ensureDirectoryForFile(filePath);

    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data));
    fs.renameSync(tempPath, filePath);
}

function normalizeStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();

    if (
        normalized === 'up' ||
        normalized === 'online' ||
        normalized === 'running' ||
        normalized === 'true' ||
        normalized === '1'
    ) {
        return 'up';
    }

    return 'down';
}

function extractTagValue(xml, tagName) {
    const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = xml.match(pattern);
    return match ? String(match[1]).trim() : '';
}

function parseStatusXml(rawXml) {
    const xml = String(rawXml || '');
    const firstTagIndex = xml.indexOf('<');

    if (firstTagIndex === -1) {
        return {
            status: 'down',
            connectedUsers: 0,
            probeError: 'No XML found in socket response'
        };
    }

    const cleanXml = xml.slice(firstTagIndex);
    const statusValue = extractTagValue(cleanXml, 'status');
    let connectedUsers = 0;

    const usersBlockMatch = cleanXml.match(/<users>([\s\S]*?)<\/users>/i);
    if (usersBlockMatch) {
        const connectedValue = extractTagValue(usersBlockMatch[1], 'connected');
        const parsed = Number.parseInt(connectedValue, 10);
        if (!Number.isNaN(parsed)) {
            connectedUsers = parsed;
        }
    } else {
        const connectedValue = extractTagValue(cleanXml, 'connected');
        const parsed = Number.parseInt(connectedValue, 10);
        if (!Number.isNaN(parsed)) {
            connectedUsers = parsed;
        }
    }

    return {
        status: normalizeStatus(statusValue),
        connectedUsers,
        probeError: ''
    };
}

function probeServerOnce() {
    return new Promise((resolve) => {
        const chunks = [];
        let finished = false;
        let connected = false;

        const socket = net.createConnection({
            host: config.serverStatus.host,
            port: config.serverStatus.port
        });

        function finish(result) {
            if (finished) {
                return;
            }

            finished = true;

            try {
                socket.destroy();
            } catch (error) {
                // ignore
            }

            resolve(result);
        }

        socket.setTimeout(config.serverStatus.timeoutMs);

        socket.on('connect', () => {
            connected = true;
        });

        socket.on('data', (chunk) => {
            chunks.push(chunk);
        });

        socket.on('timeout', () => {
            const raw = Buffer.concat(chunks).toString('utf8');

            if (raw.trim() !== '') {
                finish(parseStatusXml(raw));
                return;
            }

            finish({
                status: connected ? 'up' : 'down',
                connectedUsers: 0,
                probeError: connected
                    ? 'Connected, but socket timed out without readable XML'
                    : 'Socket read timed out'
            });
        });

        socket.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');

            if (raw.trim() !== '') {
                finish(parseStatusXml(raw));
                return;
            }

            finish({
                status: connected ? 'up' : 'down',
                connectedUsers: 0,
                probeError: connected
                    ? 'Connected, but server closed without readable XML'
                    : 'Empty socket response'
            });
        });

        socket.on('error', (error) => {
            finish({
                status: connected ? 'up' : 'down',
                connectedUsers: 0,
                probeError: connected
                    ? `Connected, then socket error occurred: ${error.message}`
                    : `Socket probe failed: ${error.message}`
            });
        });
    });
}

async function runStatusUpdate() {
    const statePath = path.resolve(config.serverStatus.statePath);
    const outputPath = path.resolve(config.serverStatus.outputPath);

    const state = loadJson(statePath, {
        previousStatus: 'down',
        serverStartTime: 0,
        maxConnectedUsers: 0,
        lastGoodConnectedUsers: 0,
        consecutiveFailures: 0
    });

    const probe = await probeServerOnce();
    const now = Math.floor(Date.now() / 1000);

    let previousStatus = String(state.previousStatus || 'down');
    let serverStartTime = Number.parseInt(state.serverStartTime, 10) || 0;
    let maxConnectedUsers = Number.parseInt(state.maxConnectedUsers, 10) || 0;
    let lastGoodConnectedUsers = Number.parseInt(state.lastGoodConnectedUsers, 10) || 0;
    let consecutiveFailures = Number.parseInt(state.consecutiveFailures, 10) || 0;

    let status = 'down';
    let connectedUsers = 0;
    let probeError = probe.probeError || '';

    if (probe.status === 'up') {
        status = 'up';
        connectedUsers = Number.parseInt(probe.connectedUsers, 10) || 0;
        consecutiveFailures = 0;
        lastGoodConnectedUsers = connectedUsers;

        if (previousStatus !== 'up' || serverStartTime <= 0) {
            serverStartTime = now;
        }

        if (connectedUsers > maxConnectedUsers) {
            maxConnectedUsers = connectedUsers;
        }
    } else {
        consecutiveFailures += 1;

        if (previousStatus === 'up' && consecutiveFailures < FAILURE_THRESHOLD) {
            status = 'up';
            connectedUsers = lastGoodConnectedUsers;
        } else {
            status = 'down';
            connectedUsers = 0;
            serverStartTime = 0;
        }
    }

    const output = {
        status,
        connectedUsers,
        maxConnectedUsers,
        serverStartTime,
        lastChecked: now,
        probeError,
        consecutiveFailures
    };

    writeJsonAtomic(outputPath, output);
    writeJsonAtomic(statePath, {
        previousStatus: status,
        serverStartTime,
        maxConnectedUsers,
        lastGoodConnectedUsers,
        consecutiveFailures
    });

    return {
        output,
        outputPath,
        statePath
    };
}

function startStatusMonitor() {
    if (!config.serverStatus.enabled) {
        console.log('Server status monitor disabled.');
        return;
    }

    const resolvedOutputPath = path.resolve(config.serverStatus.outputPath);
    const resolvedStatePath = path.resolve(config.serverStatus.statePath);

    console.log(`Status output path: ${resolvedOutputPath}`);
    console.log(`Status state path: ${resolvedStatePath}`);

    let running = false;

    async function tick() {
        if (running) {
            return;
        }

        running = true;

        try {
            const result = await runStatusUpdate();
            let line =
                `Status updated: ${result.output.status} | players=${result.output.connectedUsers} | max=${result.output.maxConnectedUsers}`;

            if (result.output.consecutiveFailures > 0) {
                line += ` | failures=${result.output.consecutiveFailures}`;
            }

            if (result.output.probeError) {
                line += ` | probeError=${result.output.probeError}`;
            }

            line += ` | file=${result.outputPath}`;

            console.log(line);
        } catch (error) {
            console.error('Status update failed:', error);
        } finally {
            running = false;
        }
    }

    tick();
    setInterval(tick, config.serverStatus.intervalMs);
}

function readCurrentStatus() {
    const outputPath = path.resolve(config.serverStatus.outputPath);

    return loadJson(outputPath, {
        status: 'down',
        connectedUsers: 0,
        maxConnectedUsers: 0,
        serverStartTime: 0,
        lastChecked: 0,
        probeError: 'Status file missing',
        consecutiveFailures: 0
    });
}

module.exports = {
    startStatusMonitor,
    readCurrentStatus
};