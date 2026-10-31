const fs = require('fs/promises');
const path = require('path');
const settingsModel = require('../models/settingsModel');
const { BRANDING_DIR } = require('../config/paths');
const { cleanString, badRequest } = require('../utils/validation');
const logger = require('../utils/logger');

const log = logger.child('settings');

// Raster images only: an uploaded SVG could carry script and is served from our origin.
// The type is decided by the file's leading bytes, not by its name.
const IMAGE_SIGNATURES = [
    { ext: 'png', test: buffer => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { ext: 'jpg', test: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
    { ext: 'webp', test: buffer => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' },
];

function serialize(settings) {
    return {
        appName: settings.appName,
        appSubtitle: settings.appSubtitle,
        logoUrl: settings.logoFile ? `/branding/${settings.logoFile}` : null,
    };
}

/** Public: the login page and share links need the name and logo before anyone signs in. */
async function getPublicSettings(req, res) {
    res.set('Cache-Control', 'no-cache');
    res.json({ settings: serialize(await settingsModel.getSettings()) });
}

async function updateSettings(req, res) {
    const appName = cleanString(req.body?.appName, 60);
    const appSubtitle = cleanString(req.body?.appSubtitle, 120);
    if (!appName) return badRequest(res, 'Nama aplikasi wajib diisi (maksimal 60 karakter).');
    if (appSubtitle === null) return badRequest(res, 'Subtitle maksimal 120 karakter.');

    await settingsModel.saveSettings({ appName, appSubtitle });
    log.info('Branding updated', { appName, appSubtitle, by: req.user.username });
    res.json({ settings: serialize(await settingsModel.getSettings()) });
}

async function removeLogoFile(fileName) {
    if (!fileName) return;
    await fs.rm(path.join(BRANDING_DIR, path.basename(fileName)), { force: true }).catch(() => {});
}

async function uploadLogo(req, res) {
    if (!req.file) return badRequest(res, 'Pilih file gambar logo.');
    const type = IMAGE_SIGNATURES.find(signature => signature.test(req.file.buffer));
    if (!type) return badRequest(res, 'Logo harus berupa gambar PNG, JPG, atau WebP.');

    // A new name on every upload, so browsers never show a cached old logo.
    const fileName = `logo-${Date.now()}.${type.ext}`;
    await fs.mkdir(BRANDING_DIR, { recursive: true });
    await fs.writeFile(path.join(BRANDING_DIR, fileName), req.file.buffer);

    const previous = (await settingsModel.getSettings()).logoFile;
    await settingsModel.saveSettings({ logoFile: fileName });
    await removeLogoFile(previous);
    log.info('Logo uploaded', { fileName, bytes: req.file.size, by: req.user.username });
    res.json({ settings: serialize(await settingsModel.getSettings()) });
}

async function deleteLogo(req, res) {
    const previous = (await settingsModel.getSettings()).logoFile;
    await settingsModel.saveSettings({ logoFile: null });
    await removeLogoFile(previous);
    log.info('Logo removed', { by: req.user.username });
    res.json({ settings: serialize(await settingsModel.getSettings()) });
}

module.exports = {
    getPublicSettings,
    updateSettings,
    uploadLogo,
    deleteLogo,
};
