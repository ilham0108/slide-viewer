const pool = require('../database/pool');

// Shown until an administrator changes them on the Settings page.
const DEFAULT_SETTINGS = {
    appName: 'Biozatix',
    appSubtitle: 'Slide Viewer',
    logoFile: null,
};

async function getSettings() {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM app_settings');
    const stored = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
    return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [key, stored[key] ?? fallback]));
}

async function saveSettings(values) {
    const entries = Object.entries(values).filter(([key]) => key in DEFAULT_SETTINGS);
    if (!entries.length) return;
    await pool.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES ?
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [entries]
    );
}

module.exports = {
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
};
