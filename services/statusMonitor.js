const fs = require('fs');
const path = require('path');
const net = require('net');
const config = require('../config');

const FAILURE_THRESHOLD = 3;
const DEFAULT_SERVER_NAME = 'Starforge';

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

function normalizeKey(key) {
    return String(key || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
    return (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    );
}

function getDirectScalarByKeys(obj, keys) {
    if (!isPlainObject(obj)) {
        return '';
    }

    const wanted = keys.map(normalizeKey);

    for (const key of Object.keys(obj)) {
        if (wanted.includes(normalizeKey(key)) && isScalar(obj[key])) {
            return String(obj[key]).trim();
        }
    }

    return '';
}

function findNestedScalarByKeys(value, keys) {
    const wanted = keys.map(normalizeKey);

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findNestedScalarByKeys(item, keys);
            if (found !== '') {
                return found;
            }
        }
        return '';
    }

    if (!isPlainObject(value)) {
        return '';
    }

    for (const key of Object.keys(value)) {
        if (wanted.includes(normalizeKey(key)) && isScalar(value[key])) {
            return String(value[key]).trim();
        }
    }

    for (const key of Object.keys(value)) {
        const found = findNestedScalarByKeys(value[key], keys);
        if (found !== '') {
            return found;
        }
    }

    return '';
}

function findNestedObjectByKeys(value, keys) {
    const wanted = keys.map(normalizeKey);

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findNestedObjectByKeys(item, keys);
            if (found) {
                return found;
            }
        }
        return null;
    }

    if (!isPlainObject(value)) {
        return null;
    }

    for (const key of Object.keys(value)) {
        if (wanted.includes(normalizeKey(key)) && isPlainObject(value[key])) {
            return value[key];
        }
    }

    for (const key of Object.keys(value)) {
        const found = findNestedObjectByKeys(value[key], keys);
        if (found) {
            return found;
        }
    }

    return null;
}

function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? (fallback || 0) : parsed;
}

function summarizeParsedXml(parsedXml) {
    const usersNode = findNestedObjectByKeys(parsedXml, ['users', 'population', 'players']);

    const connectedUsers = toInt(
        getDirectScalarByKeys(usersNode, ['connected', 'current', 'online']) ||
        findNestedScalarByKeys(parsedXml, ['connectedusers', 'onlinecount', 'currentusers', 'connected']),
        0
    );

    const advertisedMaxPlayers = toInt(
        getDirectScalarByKeys(usersNode, ['max', 'maximum', 'capacity', 'maxconnected']) ||
        findNestedScalarByKeys(parsedXml, ['maxusers', 'maxconnectedusers', 'capacity']),
        0
    );

    const explicitServerStartTime = toInt(
        findNestedScalarByKeys(parsedXml, ['serverstarttime', 'starttime', 'boottime', 'startedat']),
        0
    );

    const explicitUptimeSeconds = toInt(
        findNestedScalarByKeys(parsedXml, ['uptime', 'uptimeseconds', 'elapsed']),
        0
    );

    const serverName =
        findNestedScalarByKeys(parsedXml, ['servername', 'server_name', 'name']) ||
        '';

    const motd =
        findNestedScalarByKeys(parsedXml, ['motd', 'messageoftheday']) ||
        '';

    const version =
        findNestedScalarByKeys(parsedXml, ['version', 'build']) ||
        '';

    const statusCandidate =
        findNestedScalarByKeys(parsedXml, ['status', 'serverstatus']) ||
        'up';

    return {
        status: normalizeStatus(statusCandidate, 'up'),
        serverName: serverName || DEFAULT_SERVER_NAME,
        connectedUsers,
        advertisedMaxPlayers,
        explicitServerStartTime,
        explicitUptimeSeconds,
        motd,
        version
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
            probeError: 'No XML found in socket response'
        };
    }

    const cleanXml = xml.slice(firstTagIndex);

    try {
        const parsedXml = parseXmlToObject(cleanXml);
        const summary = summarizeParsedXml(parsedXml || {});

        return {
            status: summary.status,
            connectedUsers: summary.connectedUsers,
            serverName: summary.serverName,
            rawXml: cleanXml,
            xml: parsedXml,
            summary,
            probeError: ''
        };
    } catch (error) {
        return {
            status: 'down',
            connectedUsers: 0,
            serverName: DEFAULT_SERVER_NAME,
            rawXml: cleanXml,
            xml: null,
            summary: null,
            probeError: 'XML parse failed: ' + error.message
        };
    }
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
                serverName: DEFAULT_SERVER_NAME,
                rawXml: '',
                xml: null,
                summary: null,
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
                serverName: DEFAULT_SERVER_NAME,
                rawXml: '',
                xml: null,
                summary: null,
                probeError: connected
                    ? 'Connected, but server closed without readable XML'
                    : 'Empty socket response'
            });
        });

        socket.on('error', (error) => {
            finish({
                status: connected ? 'up' : 'down',
                connectedUsers: 0,
                serverName: DEFAULT_SERVER_NAME,
                rawXml: '',
                xml: null,
                summary: null,
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
    let consecutiveFailures = toInt(state.consecutiveFailures, 0);

    let status = 'down';
    let connectedUsers = 0;
    let serverName = DEFAULT_SERVER_NAME;
    let probeError = probe.probeError || '';
    let xml = null;
    let rawXml = '';
    let summary = null;
    let advertisedMaxPlayers = 0;

    if (probe.status === 'up' && probe.summary) {
        status = 'up';
        consecutiveFailures = 0;
        connectedUsers = toInt(probe.summary.connectedUsers, 0);
        serverName = probe.summary.serverName || DEFAULT_SERVER_NAME;
        summary = probe.summary;
        xml = probe.xml;
        rawXml = probe.rawXml || '';
        advertisedMaxPlayers = toInt(probe.summary.advertisedMaxPlayers, 0);
        lastSuccessAt = now;

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
            advertisedMaxPlayers,
            summary,
            xml,
            rawXml
        };
    } else {
        consecutiveFailures += 1;

        if (previousStatus === 'up' && consecutiveFailures < FAILURE_THRESHOLD && lastGoodSnapshot) {
            status = 'up';
            connectedUsers = toInt(lastGoodSnapshot.connectedUsers, 0);
            serverName = lastGoodSnapshot.serverName || DEFAULT_SERVER_NAME;
            summary = lastGoodSnapshot.summary || null;
            xml = lastGoodSnapshot.xml || null;
            rawXml = lastGoodSnapshot.rawXml || '';
            advertisedMaxPlayers = toInt(lastGoodSnapshot.advertisedMaxPlayers, 0);
        } else {
            status = 'down';
            connectedUsers = 0;
            serverStartTime = 0;
            summary = null;
            xml = null;
            rawXml = '';
            advertisedMaxPlayers = 0;
        }
    }

    const uptimeSeconds = status === 'up' && serverStartTime > 0
        ? Math.max(0, now - serverStartTime)
        : 0;

    const output = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        source: {
            type: 'tcp-xml',
            host: config.serverStatus.host,
            port: config.serverStatus.port,
            timeoutMs: config.serverStatus.timeoutMs
        },
        serverName,
        status,
        statusLabel: status === 'up' ? 'ONLINE' : 'OFFLINE',
        connectedUsers,
        maxConnectedUsers,
        serverStartTime,
        uptimeSeconds,
        lastChecked: now,
        lastSuccessAt,
        probeError,
        consecutiveFailures,
        users: {
            connected: connectedUsers,
            max: advertisedMaxPlayers,
            highWater: maxConnectedUsers
        },
        summary: summary || {
            status,
            serverName,
            connectedUsers,
            advertisedMaxPlayers: 0,
            explicitServerStartTime: 0,
            explicitUptimeSeconds: 0,
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

    let running = false;

    async function tick() {
        if (running) {
            return;
        }

        running = true;

        try {
            const result = await runStatusUpdate();
            let line =
                `Status updated: ${result.output.status} | ServerName=${result.output.serverName} | PlayersConnected=${result.output.connectedUsers} | MaxPlayers=${result.output.maxConnectedUsers}`;

            if (result.output.users && result.output.users.max > 0) {
                line += ` | MaxPlayers=${result.output.users.max}`;
            }

           // if (result.output.consecutiveFailures > 0) {
           //     line += ` | failures=${result.output.consecutiveFailures}`;
           // }

           // if (result.output.probeError) {
           //     line += ` | probeError=${result.output.probeError}`;
           // }

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
        schemaVersion: 2,
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
        maxConnectedUsers: 0,
        serverStartTime: 0,
        uptimeSeconds: 0,
        lastChecked: 0,
        lastSuccessAt: 0,
        probeError: 'Status file missing',
        consecutiveFailures: 0,
        users: {
            connected: 0,
            max: 0,
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