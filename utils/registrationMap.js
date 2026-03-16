const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../data/registrationMap.json');

function ensureDirectory() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadMap() {
    try {
        ensureDirectory();
        if (!fs.existsSync(filePath)) {
            return {};
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return {};
    }
}

function saveMap(data) {
    ensureDirectory();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = {
    set(username, discordId) {
        const data = loadMap();
        data[String(username).toLowerCase()] = discordId;
        saveMap(data);
    },

    get(username) {
        const data = loadMap();
        return data[String(username).toLowerCase()] || null;
    },

    delete(username) {
        const data = loadMap();
        const key = String(username).toLowerCase();
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            delete data[key];
            saveMap(data);
        }
    }
};
