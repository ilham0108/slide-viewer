const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { SLIDE_DIR, TILE_CACHE_DIR } = require('../config/paths');
const { TILE_SERVICE_HOST, TILE_SERVICE_PORT, TILE_SERVICE_URL, agent } = require('../services/tileService');
const logger = require('../utils/logger');

const log = logger.child('tiles');

// Mounted on /slides or /share-tiles/:token, so req.path is "/<slide>.dzi" or a tile path.
const REQUEST_PATTERN = /^\/([^/]+?)(\.dzi|_files\/(\d+)\/(\d+)_(\d+)\.jpg)$/;
// The tile service trims its cache by modification time (least recently used first). A tile
// served from here is touched so it counts as used, but at most this often, to avoid a disk
// write on every request.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A tile the tile service already rendered, read straight from its cache folder, or null.
 * Any failure (not cached yet, or removed this instant by a cache trim or a slide delete)
 * returns null and the request goes on to the tile service.
 */
async function readCachedTile(slideName, level, col, row) {
    const file = path.join(TILE_CACHE_DIR, slideName, level, `${col}_${row}.jpg`);
    if (!file.startsWith(`${TILE_CACHE_DIR}${path.sep}`)) return null;
    let handle;
    try {
        handle = await fs.open(file, 'r');
        const [stat, data] = [await handle.stat(), await handle.readFile()];
        if (Date.now() - stat.mtimeMs > TOUCH_INTERVAL_MS) {
            const now = new Date();
            fs.utimes(file, now, now).catch(() => {});
        }
        return data;
    } catch {
        return null;
    } finally {
        await handle?.close().catch(() => {});
    }
}

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
 * A tile it rendered before is read from its cache folder here, so the tile service only
 * handles tiles nobody has looked at yet. Slides converted earlier still have a .dzi in
 * public/slides; those requests continue to the static file middlewares behind this one.
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
        // "%2F" decodes to "/": a name must stay one path segment (in the cache folder and upstream).
        if (slideName.includes('/') || slideName.includes('\\') || slideName.startsWith('.')) {
            return res.status(400).send('Invalid slide path');
        }

        try {
            if (await hasStaticDzi(slideName)) return next();
        } catch (error) {
            return next(error);
        }

        const isDzi = match[2] === '.dzi';
        if (!isDzi) {
            const cached = await readCachedTile(slideName, match[3], match[4], match[5]);
            if (cached) {
                res.set({
                    'Content-Type': 'image/jpeg',
                    'Content-Length': cached.length,
                    'Cache-Control': tileCacheControl,
                    'X-Tile-Cache': 'hit',
                });
                return res.end(req.method === 'HEAD' ? undefined : cached);
            }
        }

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
                if (upstreamRes.headers['x-tile-cache']) res.set('X-Tile-Cache', upstreamRes.headers['x-tile-cache']);
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
