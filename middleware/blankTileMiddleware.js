const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR, SLIDE_DIR } = require('../config/paths');

const BLANK_TILE_PATH = path.join(PUBLIC_DIR, 'img', 'blank-tile.jpg');
// Mounted on /slides, so req.path looks like "/<slide>_files/<level>/<col>_<row>.<format>".
const TILE_PATTERN = /^\/(.+)_files\/\d+\/\d+_\d+\.([a-z0-9]+)$/i;
const tileFormats = new Map();

// The tile extension of a slide comes from the Format attribute of its .dzi (for example
// "jpg" or "jpeg"). Only that extension gets a blank tile, so wrong URLs still return 404.
function getTileFormat(slideName) {
    if (tileFormats.has(slideName)) return tileFormats.get(slideName);

    let format = null;
    try {
        const dzi = fs.readFileSync(path.join(SLIDE_DIR, `${slideName}.dzi`), 'utf8');
        format = /Format="([a-z0-9]+)"/i.exec(dzi)?.[1].toLowerCase() ?? null;
    } catch {
        return null;
    }
    tileFormats.set(slideName, format);
    return format;
}

/**
 * Slides converted by the old `vips dzsave --skip-blanks` have no files for tiles that are
 * only background. When such a tile is requested for an existing slide, answer with a
 * white tile so the viewer shows slide background instead of the black viewer canvas.
 */
function blankTileMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const match = TILE_PATTERN.exec(req.path);
    if (!match) return next();

    let slideName;
    try {
        slideName = decodeURIComponent(match[1]);
    } catch {
        return next();
    }
    if (slideName.includes('/') || slideName.includes('\\') || slideName.startsWith('.')) return next();

    if (getTileFormat(slideName) !== match[2].toLowerCase()) return next();

    res.sendFile(BLANK_TILE_PATH, { maxAge: '30d', immutable: true });
}

/** Drops the cached tile format of a deleted slide so its tile URLs return 404 again. */
function forgetSlide(slideName) {
    tileFormats.delete(slideName);
}

module.exports = blankTileMiddleware;
module.exports.forgetSlide = forgetSlide;
