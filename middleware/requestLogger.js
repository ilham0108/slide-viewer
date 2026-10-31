const logger = require('../utils/logger');

const log = logger.child('http');

// Tiles and static assets are requested thousands of times per viewing session; logging them
// would bury everything else. Status polling runs every 2 seconds and a large upload sends
// hundreds of chunks, so those are debug-only (failures are still logged as warnings).
const SKIPPED_PATH = /^\/(?:slides|share-tiles|assets|img|@vite|@react-refresh|src|node_modules)\//;
const DEBUG_PATH = /^\/api\/(?:slides\/\d+\/status|uploads\/[a-f0-9]{32})$/;

function requestLogger(req, res, next) {
    if (SKIPPED_PATH.test(req.path)) return next();

    // Read the path now: routers mounted on a prefix (e.g. /api) rewrite req.path later.
    const isDebugPath = DEBUG_PATH.test(req.path);
    // And the address: when the response ends before the request body was read (or the
    // client went away) the socket is already detached and req.ip throws.
    const { ip } = req;
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const meta = {
            ip,
            durationMs: Math.round(durationMs),
            bytesIn: Number(req.headers['content-length']) || undefined,
        };
        const message = `${req.method} ${req.originalUrl} ${res.statusCode}`;

        if (res.statusCode >= 500) log.error(message, meta);
        else if (res.statusCode >= 400) log.warn(message, meta);
        else if (isDebugPath) log.debug(message, meta);
        else log.info(message, meta);
    });
    next();
}

module.exports = requestLogger;
