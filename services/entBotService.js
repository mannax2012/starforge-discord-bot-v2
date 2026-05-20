const path = require('path');
const { fork } = require('child_process');
const config = require('../config');

let worker = null;
let restartTimer = null;
let isStopping = false;

function entBotEnabled() {
    return !!(config.features && config.features.entBotEnabled);
}

function clearRestartTimer() {
    if (!restartTimer) {
        return;
    }

    clearTimeout(restartTimer);
    restartTimer = null;
}

function scheduleRestart() {
    if (isStopping || !entBotEnabled() || restartTimer) {
        return;
    }

    restartTimer = setTimeout(() => {
        restartTimer = null;
        startEntBotService();
    }, 5000);
}

function startEntBotService() {
    if (!entBotEnabled()) {
        return false;
    }

    if (worker) {
        return true;
    }

    clearRestartTimer();
    isStopping = false;

    worker = fork(path.join(__dirname, 'entBotWorker.js'), [], {
        cwd: path.join(__dirname, '..'),
        env: process.env,
        stdio: 'inherit'
    });

    console.log(`[EntBot] Started worker [pid=${worker.pid}]`);

    worker.on('exit', (code, signal) => {
        console.warn(`[EntBot] Worker exited [code=${code}] [signal=${signal || 'none'}]`);
        worker = null;

        if (code === 64) {
            console.warn('[EntBot] Worker reported invalid or incomplete configuration. Not restarting automatically.');
            return;
        }

        scheduleRestart();
    });

    return true;
}

function stopEntBotService() {
    isStopping = true;
    clearRestartTimer();

    if (!worker) {
        return false;
    }

    worker.kill();
    worker = null;
    return true;
}

module.exports = {
    startEntBotService,
    stopEntBotService
};
