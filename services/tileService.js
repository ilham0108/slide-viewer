const http = require('http');

// 127.0.0.1 rather than "localhost": on Windows "localhost" tries IPv6 first, which adds
// a delay of about 250 ms to every tile.
const TILE_SERVICE_HOST = process.env.TILE_SERVICE_HOST || '127.0.0.1';
const TILE_SERVICE_PORT = Number(process.env.TILE_SERVICE_PORT) || 3100;
const TILE_SERVICE_URL = `http://${TILE_SERVICE_HOST}:${TILE_SERVICE_PORT}`;
// The viewer requests many tiles at once; reuse connections instead of opening one per tile.
const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
const REQUEST_TIMEOUT_MS = 30 * 1000;

/** Thrown when the tile service cannot be reached or answers with a server error. */
class TileServiceUnavailableError extends Error {}

function requestJson(method, requestPath) {
    return new Promise((resolve, reject) => {
        const request = http.request({
            agent,
            host: TILE_SERVICE_HOST,
            port: TILE_SERVICE_PORT,
            method,
            path: requestPath,
            timeout: REQUEST_TIMEOUT_MS,
        }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                if (response.statusCode >= 500) {
                    return reject(new TileServiceUnavailableError(`Tile service answered ${response.statusCode}`));
                }
                let data = null;
                try {
                    data = body ? JSON.parse(body) : null;
                } catch {
                    // Error pages are HTML; the status code is what matters.
                }
                resolve({ status: response.statusCode, data });
            });
        });
        request.on('timeout', () => request.destroy(new Error(`No answer within ${REQUEST_TIMEOUT_MS / 1000}s`)));
        request.on('error', error => {
            const unavailable = new TileServiceUnavailableError(`Tile service unreachable at ${TILE_SERVICE_URL}: ${error.message}`);
            unavailable.cause = error;
            reject(unavailable);
        });
        request.end();
    });
}

/**
 * Opens a slide in the tile service and returns { width, height, magnification, ... },
 * or null when the file is not a slide OpenSlide can read.
 */
async function getSlideInfo(slideName) {
    const { status, data } = await requestJson('GET', `/${encodeURIComponent(slideName)}/info`);
    if (status === 200) return data;
    if (status === 415) return null;
    // 404: the tile service looks in another folder than the one uploads are saved to.
    throw new TileServiceUnavailableError(status === 404
        ? `Tile service cannot find ${slideName}; check that SLIDE_SOURCE_DIR matches the upload folder`
        : `Tile service answered ${status} for ${slideName}`);
}

/** Closes a deleted slide in the tile service and removes its cached tiles. */
async function forgetSlide(slideName) {
    await requestJson('DELETE', `/${encodeURIComponent(slideName)}`);
}

/** Resolves once the tile service answers, or throws after `timeoutMs`. */
async function waitUntilAvailable(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
        try {
            const { status } = await requestJson('GET', '/health');
            if (status === 200) return;
        } catch (error) {
            if (!(error instanceof TileServiceUnavailableError) || Date.now() >= deadline) throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

module.exports = {
    TILE_SERVICE_HOST,
    TILE_SERVICE_PORT,
    TILE_SERVICE_URL,
    agent,
    TileServiceUnavailableError,
    getSlideInfo,
    forgetSlide,
    waitUntilAvailable,
};
