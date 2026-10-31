const fs = require('fs');
const path = require('path');
const { SLIDE_DIR } = require('../config/paths');

// Mounted on /slides, so req.path is relative to SLIDE_DIR (e.g. "/1760880131791-Slide1.dzi").
function dziMiddleware(req, res, next) {
    if (!req.path.endsWith('.dzi')) return next();

    let requestedPath;
    try {
        requestedPath = decodeURIComponent(req.path).replace(/^[/\\]+/, '');
    } catch {
        return res.status(400).send('Invalid DZI path');
    }

    const filePath = path.resolve(SLIDE_DIR, requestedPath);
    if (!filePath.startsWith(`${SLIDE_DIR}${path.sep}`)) {
        return res.status(400).send('Invalid DZI path');
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('DZI file not found');
    }

    res.type('application/xml');
    // The .dzi disappears when a slide is deleted, so it must not be cached like tiles are.
    res.set('Cache-Control', 'private, no-cache');
    fs.createReadStream(filePath).on('error', next).pipe(res);
}

module.exports = dziMiddleware;
