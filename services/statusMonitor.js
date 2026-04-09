const fs = require('fs');
const path = require('path');
const net = require('net');
const config = require('../config');

const DEFAULT_SERVER_NAME =
    String(config.mode || '').trim().toLowerCase() === 'tc' || config.isTcMode === true
        ? 'Starforge Test Center'
        : 'Starforge';
const FAILURE_THRESHOLD = Math.max(1, Number(config.serverStatus && config.serverStatus.failureThreshold || 5));
const KEEP_ALIVE_GRACE_MS = Math.max(0, Number(config.serverStatus && config.serverStatus.keepAliveGraceMs || 180000));
const PROCESS_STARTED_AT_SECONDS = Math.floor(Date.now() / 1000);

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
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

function normalizeStatus(value, fallback) {
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

    if (
        normalized === 'down' ||
        normalized === 'offline' ||
        normalized === 'stopped' ||
        normalized === 'false' ||
        normalized === '0'
    ) {
        return 'down';
    }

    return fallback || 'down';
}

function decodeXmlEntities(value) {
    return String(value || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function parseTagDefinition(tagContent) {
    const selfClosing = /\/\s*$/.test(tagContent);
    const inner = tagContent.replace(/\/\s*$/, '').trim();
    const spaceIndex = inner.search(/\s/);
    const name = (spaceIndex === -1 ? inner : inner.slice(0, spaceIndex)).trim();
    const attrSource = spaceIndex === -1 ? '' : inner.slice(spaceIndex + 1);
    const attributes = {};

    attrSource.replace(
        /([:@A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"|([:@A-Za-z_][\w:.-]*)\s*=\s*'([^']*)'/g,
        function (_, key1, value1, key2, value2) {
            const key = key1 || key2;
            const value = value1 != null ? value1 : value2;
            attributes[key] = decodeXmlEntities(value);
            return '';
        }
    );

    return {
        name,
        attributes,
        selfClosing
    };
}

function appendText(node, text) {
    const value = decodeXmlEntities(text);
    node.text = (node.text || '') + value;
}

function addChildNode(parent, child) {
    if (!parent.children[child.name]) {
        parent.children[child.name] = [];
    }

    parent.children[child.name].push(child);
}

function nodeToValue(node) {
    const childKeys = Object.keys(node.children || {});
    const hasChildren = childKeys.length > 0;
    const hasAttributes = Object.keys(node.attributes || {}).length > 0;
    const text = String(node.text || '').trim();

    if (!hasChildren && !hasAttributes) {
        return text;
    }

    const result = {};

    if (hasAttributes) {
        result['@attributes'] = node.attributes;
    }

    childKeys.forEach((childName) => {
        const children = node.children[childName] || [];
        result[childName] = children.length === 1
            ? nodeToValue(children[0])
            : children.map(nodeToValue);
    });

    if (text !== '') {
        result['#text'] = text;
    }

    return result;
}

function parseXmlToObject(xml) {
    const source = String(xml || '');
    const tokenRegex = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--([\s\S]*?)-->|<\?[\s\S]*?\?>|<\/?[^>]+>|[^<]+/g;

    const root = {
        name: '__root__',
        attributes: {},
        children: {},
        text: ''
    };

    const stack = [root];
    let match;

    while ((match = tokenRegex.exec(source)) !== null) {
        const token = match[0];
        const current = stack[stack.length - 1];

        if (!token) {
            continue;
        }

        if (token.startsWith('<?') || token.startsWith('<!--')) {
            continue;
        }

        if (token.startsWith('<![CDATA[')) {
            appendText(current, match[1] || '');
            continue;
        }

        if (token.startsWith('</')) {
            if (stack.length > 1) {
                stack.pop();
            }
            continue;
        }

        if (token.startsWith('<')) {
            const tagContent = token.slice(1, -1).trim();
            const tag = parseTagDefinition(tagContent);

            if (!tag.name) {
                continue;
            }

            const node = {
                name: tag.name,
                attributes: tag.attributes || {},
                children: {},
                text: ''
            };

            addChildNode(current, node);

            if (!tag.selfClosing) {
                stack.push(node);
            }

            continue;
        }

        if (token.trim() !== '') {
            appendText(current, token);
        }
    }

    const rootKeys = Object.keys(root.children);
    if (!rootKeys.length) {
        return null;
    }

    if (rootKeys.length === 1 && root.children[rootKeys[0]].length === 1) {
        return {
            [rootKeys[0]]: nodeToValue(root.children[rootKeys[0]][0])
        };
    }

    const result = {};
    rootKeys.forEach((key) => {
        const children = root.children[key];
        result[key] = children.length === 1
            ? nodeToValue(children[0])
            : children.map(nodeToValue);
    });

    return result;
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? (fallback || 0) : parsed;
}

function clampFailureCount(value) {
    const parsed = toInt(value, 0);
    return Math.max(0, Math.min(parsed, FAILURE_THRESHOLD));
}

function toLauncherStatusLabel(status) {
    const normalized = String(status || '').trim().toLowerCase();

    if (normalized === 'up' || normalized === 'degraded') {
        return 'ONLINE';
    }

    return 'OFFLINE';
}

function getZoneServerNode(parsedXml) {
    if (!parsedXml || !isPlainObject(parsedXml)) {
        return null;
    }

    if (isPlainObject(parsedXml.zoneServer)) {
        return parsedXml.zoneServer;
    }

    return null;
}

function hasUsableZoneServer(parsedXml) {
    return !!getZoneServerNode(parsedXml);
}

function summarizeParsedXml(parsedXml) {
    const zoneServer = getZoneServerNode(parsedXml) || {};
    const users = isPlainObject(zoneServer.users) ? zoneServer.users : {};

    const serverName = String(zoneServer.name || '').trim() || DEFAULT_SERVER_NAME;
    const status = normalizeStatus(zoneServer.status || 'up', 'up');

    const connectedUsers = toInt(users.connected, 0);
    const playerCap = toInt(users.cap, 0);
    const peakPlayers = toInt(users.max, 0);
    const totalPlayers = toInt(users.total, 0);
    const deletedPlayers = toInt(users.deleted, 0);
    const explicitUptimeSeconds = toInt(zoneServer.uptime, 0);
    const timestampMs = toInt(zoneServer.timestamp, 0);

    return {
        status,
        serverName,
        connectedUsers,
        playerCap,
        peakPlayers,
        totalPlayers,
        deletedPlayers,
        explicitServerStartTime: 0,
        explicitUptimeSeconds,
        timestampMs,
        motd: '',
        version: ''
    };
}

function parseStatusXml(rawXml) {
    const xml = String(rawXml || '');
    const firstTagIndex = xml.indexOf('<');

    if (firstTagIndex === -1) {
        return {
            status: 'down',
            connectedUsers: 0,
            serverName: DEFAULT_SERVER_NAME,
            rawXml: '',
            xml: null,
            summary: null,
            probeError: 'No XML found in socket response',
            transportWarning: ''
        };
    }

    const cleanXml = xml.slice(firstTagIndex);

    try {
        const parsedXml = parseXmlToObject(cleanXml);

        if (!hasUsableZoneServer(parsedXml)) {
            return {
                status: 'down',
                connectedUsers: 0,
                serverName: DEFAULT_SERVER_NAME,
                rawXml: cleanXml,
                xml: parsedXml,
                summary: null,
                probeError: 'XML response did not include a usable zoneServer node',
                transportWarning: ''
            };
        }

        const summary = summarizeParsedXml(parsedXml || {});

        return {
            status: summary.status,
            connectedUsers: summary.connectedUsers,
            serverName: summary.serverName,
            rawXml: cleanXml,
            xml: parsedXml,
            summary,
            probeError: '',
            transportWarning: ''
        };
    } catch (error) {
        return {
            status: 'down',
            connectedUsers: 0,
            serverName: DEFAULT_SERVER_NAME,
            rawXml: cleanXml,
            xml: null,
            summary: null,
            probeError: 'XML parse failed: ' + error.message,
            transportWarning: ''
        };
    }
}

function shouldHoldStatusUp(previousStatus, consecutiveFailures, lastGoodSnapshot, lastSuccessAt, now) {
    if (previousStatus !== 'up' || !lastGoodSnapshot) {
        return false;
    }

    if (consecutiveFailures < FAILURE_THRESHOLD) {
        return true;
    }

    if (lastSuccessAt <= 0 || KEEP_ALIVE_GRACE_MS <= 0) {
        return false;
    }

    return ((now - lastSuccessAt) * 1000) < KEEP_ALIVE_GRACE_MS;
}

function parseIfAnyData(raw, warningText) {
    if (String(raw || '').trim() === '') {
        return null;
    }

    const parsed = parseStatusXml(raw);

    if (parsed.summary) {
        parsed.transportWarning = warningText || '';
        parsed.probeError = '';
    }

    return parsed;
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
            const parsed = parseIfAnyData(
                raw,
                connected ? 'Socket timed out after XML was received.' : ''
            );

            if (parsed) {
                finish(parsed);
                return;
            }

            finish({
                status: connected ? 'up' : 'down',
                connectedUsers: 0,
                serverName: DEFAULT_SERVER_NAME,
                rawXml: '',
                xml: null,
                summary: null,
                probeError: connected
                    ? 'Connected, but socket timed out without readable XML'
                    : 'Socket read timed out',
                transportWarning: ''
            });
        });

        socket.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const parsed = parseIfAnyData(
                raw,
                connected ? 'Socket closed after XML was received.' : ''
            );

            if (parsed) {
                finish(parsed);
                return;
            }

            finish({
                status: connected ? 'up' : 'down',
                connectedUsers: 0,
                serverName: DEFAULT_SERVER_NAME,
                rawXml: '',
                xml: null,
                summary: null,
                probeError: connected
                    ? 'Connected, but server closed without readable XML'
                    : 'Empty socket response',
                transportWarning: ''
            });
        });

        socket.on('error', (error) => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const parsed = parseIfAnyData(
                raw,
                connected ? `Socket error after XML was received: ${error.message}` : ''
            );

            if (parsed) {
                finish(parsed);
                return;
            }

            finish({
                status: connected ? 'up' : 'down',
                connectedUsers: 0,
                serverName: DEFAULT_SERVER_NAME,
                rawXml: '',
                xml: null,
                summary: null,
                probeError: connected
                    ? `Connected, then socket error occurred: ${error.message}`
                    : `Socket probe failed: ${error.message}`,
                transportWarning: ''
            });
        });
    });
}

async function runStatusUpdate() {
    const statePath = path.resolve(config.serverStatus.statePath);
    const outputPath = path.resolve(config.serverStatus.outputPath);
    const now = Math.floor(Date.now() / 1000);

    const state = loadJson(statePath, {
        previousStatus: 'down',
        serverStartTime: 0,
        maxConnectedUsers: 0,
        lastSuccessAt: 0,
        lastGoodSnapshot: null,
        consecutiveFailures: 0
    });

    const probe = await probeServerOnce();

    let previousStatus = String(state.previousStatus || 'down');
    let serverStartTime = toInt(state.serverStartTime, 0);
    let maxConnectedUsers = toInt(state.maxConnectedUsers, 0);
    let lastSuccessAt = toInt(state.lastSuccessAt, 0);
    let lastGoodSnapshot = state.lastGoodSnapshot || null;
    let consecutiveFailures = clampFailureCount(state.consecutiveFailures);

    let status = 'unknown';
    let connectedUsers = 0;
    let serverName = DEFAULT_SERVER_NAME;
    let probeError = probe.probeError || '';
    let transportWarning = probe.transportWarning || '';
    let xml = null;
    let rawXml = '';
    let summary = null;
    let playerCap = 0;
    let peakPlayers = 0;
    let totalPlayers = 0;
    let deletedPlayers = 0;

    if (probe.summary) {
        status = normalizeStatus(probe.summary.status || probe.status || 'up', 'up');
        consecutiveFailures = 0;
        connectedUsers = toInt(probe.summary.connectedUsers, 0);
        serverName = probe.summary.serverName || DEFAULT_SERVER_NAME;
        summary = probe.summary;
        xml = probe.xml;
        rawXml = probe.rawXml || '';
        playerCap = toInt(probe.summary.playerCap, 0);
        peakPlayers = toInt(probe.summary.peakPlayers, 0);
        totalPlayers = toInt(probe.summary.totalPlayers, 0);
        deletedPlayers = toInt(probe.summary.deletedPlayers, 0);
        lastSuccessAt = now;

        if (status === 'up') {
            if (probe.summary.explicitServerStartTime > 0) {
                serverStartTime = probe.summary.explicitServerStartTime;
            } else if (probe.summary.explicitUptimeSeconds > 0) {
                serverStartTime = now - probe.summary.explicitUptimeSeconds;
            } else if (previousStatus !== 'up' || serverStartTime <= 0) {
                serverStartTime = now;
            }

            if (connectedUsers > maxConnectedUsers) {
                maxConnectedUsers = connectedUsers;
            }

            lastGoodSnapshot = {
                serverName,
                connectedUsers,
                playerCap,
                peakPlayers,
                totalPlayers,
                deletedPlayers,
                summary,
                xml,
                rawXml
            };
        } else {
            serverStartTime = 0;
        }
    } else {
        consecutiveFailures = clampFailureCount(consecutiveFailures + 1);

        if (shouldHoldStatusUp(previousStatus, consecutiveFailures, lastGoodSnapshot, lastSuccessAt, now)) {
            status = 'up';
            connectedUsers = toInt(lastGoodSnapshot.connectedUsers, 0);
            serverName = lastGoodSnapshot.serverName || DEFAULT_SERVER_NAME;
            summary = lastGoodSnapshot.summary || null;
            xml = lastGoodSnapshot.xml || null;
            rawXml = lastGoodSnapshot.rawXml || '';
            playerCap = toInt(lastGoodSnapshot.playerCap, 0);
            peakPlayers = toInt(lastGoodSnapshot.peakPlayers, 0);
            totalPlayers = toInt(lastGoodSnapshot.totalPlayers, 0);
            deletedPlayers = toInt(lastGoodSnapshot.deletedPlayers, 0);
        } else {
            status = 'degraded';
            serverName = lastGoodSnapshot && lastGoodSnapshot.serverName
                ? lastGoodSnapshot.serverName
                : DEFAULT_SERVER_NAME;
            connectedUsers = lastGoodSnapshot ? toInt(lastGoodSnapshot.connectedUsers, 0) : 0;
            playerCap = lastGoodSnapshot ? toInt(lastGoodSnapshot.playerCap, 0) : 0;
            peakPlayers = lastGoodSnapshot ? toInt(lastGoodSnapshot.peakPlayers, 0) : 0;
            totalPlayers = lastGoodSnapshot ? toInt(lastGoodSnapshot.totalPlayers, 0) : 0;
            deletedPlayers = lastGoodSnapshot ? toInt(lastGoodSnapshot.deletedPlayers, 0) : 0;
            summary = lastGoodSnapshot && lastGoodSnapshot.summary
                ? Object.assign({}, lastGoodSnapshot.summary, { status: 'degraded' })
                : {
                    status: 'degraded',
                    serverName,
                    connectedUsers,
                    playerCap,
                    peakPlayers,
                    totalPlayers,
                    deletedPlayers,
                    explicitServerStartTime: serverStartTime > 0 ? serverStartTime : PROCESS_STARTED_AT_SECONDS,
                    explicitUptimeSeconds: serverStartTime > 0 ? Math.max(0, now - serverStartTime) : 0,
                    timestampMs: now * 1000,
                    motd: '',
                    version: ''
                };
            xml = lastGoodSnapshot ? (lastGoodSnapshot.xml || null) : null;
            rawXml = lastGoodSnapshot ? (lastGoodSnapshot.rawXml || '') : '';

            if (serverStartTime <= 0) {
                serverStartTime = PROCESS_STARTED_AT_SECONDS;
            }
        }
    }

    const uptimeSeconds = (status === 'up' || status === 'degraded') && serverStartTime > 0
        ? Math.max(0, now - serverStartTime)
        : 0;

    const output = {
        schemaVersion: 3,
        generatedAt: new Date().toISOString(),
        source: {
            type: 'tcp-xml',
            host: config.serverStatus.host,
            port: config.serverStatus.port,
            timeoutMs: config.serverStatus.timeoutMs
        },
        serverName,
        status,
        statusLabel: toLauncherStatusLabel(status),
        connectedUsers,
        playerCap,
        peakPlayers,
        maxConnectedUsers,
        serverStartTime,
        uptimeSeconds,
        lastChecked: now,
        lastSuccessAt,
        probeError,
        transportWarning,
        consecutiveFailures,
        users: {
            connected: connectedUsers,
            cap: playerCap,
            peak: peakPlayers,
            total: totalPlayers,
            deleted: deletedPlayers,
            highWater: maxConnectedUsers
        },
        summary: summary || {
            status,
            serverName,
            connectedUsers,
            playerCap: 0,
            peakPlayers: 0,
            totalPlayers: 0,
            deletedPlayers: 0,
            explicitServerStartTime: 0,
            explicitUptimeSeconds: 0,
            timestampMs: 0,
            motd: '',
            version: ''
        },
        xml,
        rawXml
    };

    writeJsonAtomic(outputPath, output);
    writeJsonAtomic(statePath, {
        previousStatus: status,
        serverStartTime,
        maxConnectedUsers,
        lastSuccessAt,
        lastGoodSnapshot,
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
    console.log(`Status probe target: ${config.serverStatus.host}:${config.serverStatus.port} | interval=${config.serverStatus.intervalMs}ms | timeout=${config.serverStatus.timeoutMs}ms | failureThreshold=${FAILURE_THRESHOLD} | keepAliveGraceMs=${KEEP_ALIVE_GRACE_MS}`);

    let running = false;
    let hasPrintedInitialStatus = false;
    let lastPrintedStatus = null;
    let lastPrintedConnectedUsers = null;

    function maybePrintStatus(output) {
        const currentStatus = String(output && output.status ? output.status : 'down');
        const currentConnectedUsers = Number(output && output.connectedUsers ? output.connectedUsers : 0);

        const shouldPrint =
            !hasPrintedInitialStatus ||
            currentStatus !== lastPrintedStatus ||
            currentConnectedUsers !== lastPrintedConnectedUsers;

        if (!shouldPrint) {
            return;
        }

        hasPrintedInitialStatus = true;
        lastPrintedStatus = currentStatus;
        lastPrintedConnectedUsers = currentConnectedUsers;

        const failureCount = Number(output && output.consecutiveFailures ? output.consecutiveFailures : 0);
        const errorText = String(output && output.probeError ? output.probeError : '').trim();
        const warningText = String(output && output.transportWarning ? output.transportWarning : '').trim();
        const extras = [];

        if (failureCount > 0) {
            extras.push(`Failures=${failureCount}`);
        }

        if (errorText) {
            extras.push(`ProbeError=${errorText}`);
        }

        if (warningText) {
            extras.push(`Warning=${warningText}`);
        }

        console.log(
            `Status: ${currentStatus} | PlayersConnected: ${currentConnectedUsers}` +
            (extras.length ? ` | ${extras.join(' | ')}` : '')
        );
    }

    async function tick() {
        if (running) {
            return;
        }

        running = true;

        try {
            const result = await runStatusUpdate();
            maybePrintStatus(result.output);
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
        schemaVersion: 3,
        generatedAt: '',
        source: {
            type: 'tcp-xml',
            host: config.serverStatus.host,
            port: config.serverStatus.port,
            timeoutMs: config.serverStatus.timeoutMs
        },
        serverName: DEFAULT_SERVER_NAME,
        status: 'down',
        statusLabel: 'OFFLINE',
        connectedUsers: 0,
        playerCap: 0,
        peakPlayers: 0,
        maxConnectedUsers: 0,
        serverStartTime: 0,
        uptimeSeconds: 0,
        lastChecked: 0,
        lastSuccessAt: 0,
        probeError: 'Status file missing',
        transportWarning: '',
        consecutiveFailures: 0,
        users: {
            connected: 0,
            cap: 0,
            peak: 0,
            total: 0,
            deleted: 0,
            highWater: 0
        },
        summary: null,
        xml: null,
        rawXml: ''
    });
}

module.exports = {
    startStatusMonitor,
    readCurrentStatus
};
