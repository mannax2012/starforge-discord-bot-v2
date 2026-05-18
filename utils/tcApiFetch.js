const DEFAULT_TC_API_PORTS = ['44567', '44557'];

function pushUnique(list, value) {
    if (value && !list.includes(value)) {
        list.push(value);
    }
}

function buildTcEndpointCandidates(endpoint) {
    const primaryEndpoint = String(endpoint || '').trim();
    const candidates = [];

    pushUnique(candidates, primaryEndpoint);

    if (!primaryEndpoint) {
        return candidates;
    }

    try {
        const parsed = new URL(primaryEndpoint);

        if (!parsed.port) {
            return candidates;
        }

        for (const port of DEFAULT_TC_API_PORTS) {
            if (port === parsed.port) {
                continue;
            }

            const alternate = new URL(parsed.toString());
            alternate.port = port;
            pushUnique(candidates, alternate.toString());
        }
    } catch (error) {
        // Keep the configured endpoint as-is when URL parsing fails.
    }

    return candidates;
}

function buildMirrorHeaders(sharedSecret) {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (String(sharedSecret || '').trim()) {
        headers['X-Starforge-Key'] = String(sharedSecret).trim();
    }

    return headers;
}

function formatAttemptedEndpoints(endpoints) {
    const uniqueEndpoints = [];

    for (const endpoint of endpoints || []) {
        pushUnique(uniqueEndpoints, String(endpoint || '').trim());
    }

    return uniqueEndpoints.length > 0
        ? ` Tried endpoints: ${uniqueEndpoints.join(', ')}`
        : '';
}

async function postTcApiJson(endpoint, sharedSecret, body, requestLabel) {
    const candidates = buildTcEndpointCandidates(endpoint);
    const headers = buildMirrorHeaders(sharedSecret);
    const attemptedEndpoints = [];
    const label = String(requestLabel || 'TC API').trim() || 'TC API';
    const payload = JSON.stringify(body || {});
    let lastError = null;

    for (const candidate of candidates) {
        attemptedEndpoints.push(candidate);

        let response;

        try {
            response = await fetch(candidate, {
                method: 'POST',
                headers,
                body: payload
            });
        } catch (error) {
            lastError = error;
            continue;
        }

        let json;

        try {
            json = await response.json();
        } catch (error) {
            return {
                ok: false,
                errorType: 'json',
                error,
                response,
                endpointUsed: candidate,
                attemptedEndpoints
            };
        }

        if (candidate !== candidates[0]) {
            console.warn(`[${label}] Fallback endpoint succeeded [primary=${candidates[0]}] [used=${candidate}]`);
        }

        return {
            ok: true,
            response,
            json,
            endpointUsed: candidate,
            attemptedEndpoints,
            fallbackUsed: candidate !== candidates[0]
        };
    }

    return {
        ok: false,
        errorType: 'network',
        error: lastError,
        attemptedEndpoints
    };
}

module.exports = {
    buildTcEndpointCandidates,
    formatAttemptedEndpoints,
    postTcApiJson
};
