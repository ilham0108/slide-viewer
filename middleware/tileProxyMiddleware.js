const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { SLIDE_DIR } = require('../config/paths');
const { TILE_SERVICE_HOST, TILE_SERVICE_PORT, TILE_SERVICE_URL, agent } = require('../services/tileService');
const logger = require('../utils/logger');

const log = logger.child('tiles');

// Mounted on /slides or /share-tiles/:token, so req.path is "/<slide>.dzi" or a tile path.
const REQUEST_PATTERN = /^\/([^/]+?)(\.dzi|_files\/\d+\/\d+_\d+\.jpg)$/;

async function hasStaticDzi(slideName) {
    try {
        await fs.access(path.join(SLIDE_DIR, `${slideName}.dzi`));
        return true;
    } catch {
        return false;
    }
}

/**
 * Serves slides from the tile service, which reads tiles straight from the uploaded file.
 * Slides converted earlier still have a .dzi in public/slides; those requests continue to
 * the static file middlewares behind this one.
 *
 * @param {object} options
 * @param {string} options.tileCacheControl Cache-Control header of tile responses.
 */
function tileProxyMiddleware({ tileCacheControl }) {
    return async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        const match = REQUEST_PATTERN.exec(req.path);
        if (!match) return next();

        let slideName;
        try {
            slideName = decodeURIComponent(match[1]);
        } catch {
            return res.status(400).send('Invalid slide path');
        }
        if (slideName.includes('\\') || slideName.startsWith('.')) return res.status(400).send('Invalid slide path');

        try {
            if (await hasStaticDzi(slideName)) return next();
        } catch (error) {
            return next(error);
        }

        const isDzi = match[2] === '.dzi';
        const upstream = http.request({
            agent,
            host: TILE_SERVICE_HOST,
            port: TILE_SERVICE_PORT,
            method: req.method,
            path: `/${encodeURIComponent(slideName)}${match[2]}`,
        }, upstreamRes => {
            const status = upstreamRes.statusCode;
            res.status(status);
            res.type(upstreamRes.headers['content-type'] || 'application/octet-stream');
            if (status === 200) {
                // The .dzi disappears when a slide is deleted, so it must not be cached like tiles are.
                res.set('Cache-Control', isDzi ? 'private, no-cache' : tileCacheControl);
            } else {
                res.set('Cache-Control', 'no-store');
            }
            upstreamRes.pipe(res);
        });

        upstream.on('error', error => {
            // The viewer cancels tiles that scroll out of view; that is not a failure.
            if (res.writableEnded || res.destroyed) return;
            log.error('Tile service unreachable', { url: TILE_SERVICE_URL, error });
            if (!res.headersSent) res.status(503).set('Cache-Control', 'no-store').send('Tile service unavailable');
            else res.destroy();
        });
        res.on('close', () => {
            if (!res.writableFinished) upstream.destroy();
        });
        upstream.end();
    };
}

module.exports = tileProxyMiddleware;
