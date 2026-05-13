const config = require('../config');

function buildFailureResult(message, attempted, statusCode) {
    return {
        success: false,
        attempted: Boolean(attempted),
        statusCode: statusCode || 400,
        message: String(message || 'Activation email notification failed.')
    };
}

async function sendActivationSuccessEmailNotification(payload) {
    const settings = config.accountNotifications || {};
    const enabled = settings.activationEmailEnabled !== false;
    const endpoint = String(settings.activationEmailUrl || '').trim();
    const sharedSecret = String(settings.activationEmailSharedSecret || '').trim();
    const timeoutMs = Number.parseInt(settings.activationEmailTimeoutMs, 10) || 10000;
    const username = String(payload && payload.username || '').trim();
    const email = String(payload && payload.email || '').trim();
    const activatedBy = String(payload && payload.activatedBy || '').trim();
    const source = String(payload && payload.source || '').trim();

    if (!enabled) {
        return buildFailureResult('Activation email notifications are disabled.', false, 200);
    }

    if (!username) {
        return buildFailureResult('Activation email notification skipped because the username was missing.', false, 400);
    }

    if (!email) {
        return buildFailureResult('Activation email notification skipped because no email is on file.', false, 200);
    }

    if (!endpoint) {
        return buildFailureResult('Activation email URL is not configured.', false, 500);
    }

    const headers = {
        'Content-Type': 'application/json'
    };

    if (sharedSecret) {
        headers['X-Starforge-Key'] = sharedSecret;
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(function () {
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                username,
                email,
                activatedBy,
                source
            }),
            signal: controller.signal
        });

        let json = null;

        try {
            json = await response.json();
        } catch (error) {
            return buildFailureResult('Activation email endpoint returned unreadable JSON.', true, response.status || 502);
        }

        if (!response.ok || !json || !json.success) {
            return buildFailureResult(
                json && json.message ? json.message : 'Activation email endpoint returned an error.',
                true,
                response.status || 502
            );
        }

        return {
            success: true,
            attempted: true,
            statusCode: response.status || 200,
            message: json.message || 'Activation email sent successfully.'
        };
    } catch (error) {
        return buildFailureResult(
            error && error.name === 'AbortError'
                ? 'Activation email request timed out.'
                : `Activation email request failed: ${error.message}`,
            true,
            502
        );
    } finally {
        clearTimeout(timeoutHandle);
    }
}

module.exports = {
    sendActivationSuccessEmailNotification
};
