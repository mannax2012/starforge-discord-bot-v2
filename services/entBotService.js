const path = require('path');
const { fork } = require('child_process');
const config = require('../config');

let worker = null;
let restartTimer = null;
let isStopping = false;
let stoppingPromise = null;

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

    const child = fork(path.join(__dirname, 'entBotWorker.js'), [], {
        cwd: path.join(__dirname, '..'),
        env: process.env,
        stdio: 'inherit'
    });
    worker = child;

    console.log(`[EntBot] Started worker [pid=${child.pid}]`);

    child.on('exit', (code, signal) => {
        const wasCurrentWorker = worker === child;
        console.warn(`[EntBot] Worker exited [code=${code}] [signal=${signal || 'none'}]`);

        if (!wasCurrentWorker) {
            return;
        }

        worker = null;

        if (code === 64) {
            console.warn('[EntBot] Worker reported invalid or incomplete configuration. Not restarting automatically.');
            return;
        }

        scheduleRestart();
    });

    return true;
}

function getEntBotServiceState() {
    return {
        enabled: entBotEnabled(),
        started: Boolean(worker),
        pid: worker && worker.pid ? worker.pid : 0
    };
}

function stopEntBotService() {
    isStopping = true;
    clearRestartTimer();

    if (!worker) {
        return Promise.resolve(false);
    }

    if (stoppingPromise) {
        return stoppingPromise;
    }

    const child = worker;
    stoppingPromise = new Promise((resolve) => {
        let finished = false;

        const finish = (stopped) => {
            if (finished) {
                return;
            }

            finished = true;
            clearTimeout(forceKillTimer);
            if (worker === child) {
                worker = null;
            }
            stoppingPromise = null;
            resolve(stopped);
        };

        const forceKillTimer = setTimeout(() => {
            if (child.exitCode === null && !child.killed) {
                console.warn('[EntBot] Worker did not exit after SIGTERM; sending SIGKILL.');
                child.kill('SIGKILL');
            }
        }, 10000);

        child.once('exit', () => {
            finish(true);
        });

        try {
            child.kill('SIGTERM');
        } catch (error) {
            console.error(`[EntBot] Failed to stop worker cleanly: ${error.message}`);
            finish(false);
        }
    });

    return stoppingPromise;
}

async function restartEntBotService() {
    if (!entBotEnabled()) {
        return false;
    }

    await stopEntBotService();
    clearRestartTimer();
    isStopping = false;
    return startEntBotService();
}

module.exports = {
    getEntBotServiceState,
    restartEntBotService,
    startEntBotService,
    stopEntBotService
};
