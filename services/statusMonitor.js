const fs = require('fs');
const path = require('path');
const net = require('net');
const config = require('../config');

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
            socket.write('\n');
        });

        socket.on('data', (chunk) => {
            chunks.push(chunk);
        });

        socket.on('timeout', () => {
            const raw = Buffer.concat(chunks).toString('utf8');

            if (raw.trim() !== '') {
                const parsed = parseStatusXml(raw);
                finish(parsed);
                return;
            }

            finish({
                status: 'down',
                connectedUsers: 0,
                probeError: 'Socket read timed out'
            });
        });

        socket.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');

            if (raw.trim() === '') {
                finish({
                    status: 'down',
                    connectedUsers: 0,
                    probeError: 'Empty socket response'
                });
                return;
            }

            finish(parseStatusXml(raw));
        });

        socket.on('error', (error) => {
            finish({
                status: 'down',
                connectedUsers: 0,
                probeError: `Socket probe failed: ${error.message}`
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
        maxConnectedUsers: 0
    });

    const probe = await probeServerOnce();
    const now = Math.floor(Date.now() / 1000);

    let serverStartTime = Number.parseInt(state.serverStartTime, 10) || 0;
    let maxConnectedUsers = Number.parseInt(state.maxConnectedUsers, 10) || 0;
    const previousStatus = String(state.previousStatus || 'down');

    let connectedUsers = Number.parseInt(probe.connectedUsers, 10) || 0;
    const status = probe.status === 'up' ? 'up' : 'down';

    if (status === 'up') {
        if (previousStatus !== 'up' || serverStartTime <= 0) {
            serverStartTime = now;
        }

        if (connectedUsers > maxConnectedUsers) {
            maxConnectedUsers = connectedUsers;
        }
    } else {
        connectedUsers = 0;
        serverStartTime = 0;
    }

    const output = {
        status,
        connectedUsers,
        maxConnectedUsers,
        serverStartTime,
        lastChecked: now,
        probeError: probe.probeError || ''
    };

    writeJsonAtomic(outputPath, output);
    writeJsonAtomic(statePath, {
        previousStatus: status,
        serverStartTime,
        maxConnectedUsers
    });

    return output;
}

function startStatusMonitor() {
    if (!config.serverStatus.enabled) {
        console.log('Server status monitor disabled.');
        return;
    }

    let running = false;

    async function tick() {
        if (running) {
            return;
        }

        running = true;

        try {
            const result = await runStatusUpdate();
            console.log(
                `Status updated: ${result.status} | players=${result.connectedUsers} | max=${result.maxConnectedUsers}`
            );
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
        probeError: 'Status file missing'
    });
}

module.exports = {
    startStatusMonitor,
    readCurrentStatus
};