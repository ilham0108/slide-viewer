const express = require('express');
const path = require('path');
const fs = require('fs');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const caseRoutes = require('./routes/caseRoutes');
const slideRoutes = require('./routes/slideRoutes');
const shareRoutes = require('./routes/shareRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const publicShareRoutes = require('./routes/publicShareRoutes');
const { authorizeTiles } = require('./controllers/publicShareController');
const dziMiddleware = require('./middleware/dziMiddleware');
const blankTileMiddleware = require('./middleware/blankTileMiddleware');
const tileProxyMiddleware = require('./middleware/tileProxyMiddleware');
const requestLogger = require('./middleware/requestLogger');
const { requireAuth, requirePermission } = require('./middleware/auth');
const { sessionMiddleware } = require('./config/session');
const { UPLOAD_DIR, SLIDE_DIR, CLIENT_DIST_DIR } = require('./config/paths');
const logger = require('./utils/logger');

const log = logger.child('app');

for (const directory of [UPLOAD_DIR, SLIDE_DIR]) {
    fs.mkdirSync(directory, { recursive: true });
}

const app = express();

if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.use(requestLogger);
app.use(sessionMiddleware);

// Slide images are patient data: every DZI and tile request needs a signed-in user.
// Tiles never change (file names are timestamped), so browsers may cache them for good,
// but only privately. Slides are served by the tile service; the static middlewares
// below it only serve slides converted to DZI files before the tile service existed.
app.use(
    '/slides',
    requireAuth,
    requirePermission('slides.view'),
    tileProxyMiddleware({ tileCacheControl: 'private, max-age=2592000, immutable' }),
    dziMiddleware,
    express.static(SLIDE_DIR, {
        maxAge: '30d',
        immutable: true,
        setHeaders: res => res.set('Cache-Control', 'private, max-age=2592000, immutable'),
    }),
    blankTileMiddleware
);
// Tiles of publicly shared slides: same files, authorised by the share token instead of a login.
app.use(
    '/share-tiles/:token',
    authorizeTiles,
    tileProxyMiddleware({ tileCacheControl: 'private, max-age=3600' }),
    dziMiddleware,
    express.static(SLIDE_DIR, {
        maxAge: '1h',
        setHeaders: res => res.set('Cache-Control', 'private, max-age=3600'),
    }),
    blankTileMiddleware
);
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use(express.json({ limit: '5mb' }));

app.use('/api', authRoutes);
app.use('/api', publicShareRoutes);
app.use('/api', settingsRoutes);
app.use('/api', requireAuth);
app.use('/api', userRoutes);
app.use('/api', caseRoutes);
app.use('/api', slideRoutes);
app.use('/api', shareRoutes);
app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.' }));

// React single-page app (built by "npm run build" into client/dist). Any other GET
// returns index.html so client-side routes such as /cases/12 work on reload.
const clientIndex = path.join(CLIENT_DIST_DIR, 'index.html');
app.use(express.static(CLIENT_DIST_DIR, { index: false }));
app.get('/{*splat}', (req, res) => {
    if (!fs.existsSync(clientIndex)) {
        return res.status(503).send('Frontend belum di-build. Jalankan "npm run build", atau gunakan "npm run dev" saat pengembangan.');
    }
    res.sendFile(clientIndex);
});

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status === 400 ? 400 : 500;
    if (status === 500) {
        log.error(`${req.method} ${req.originalUrl} failed`, { error: err });
    } else {
        log.warn(`${req.method} ${req.originalUrl} rejected: ${err.message}`, { code: err.code });
    }

    if (req.path.startsWith('/api/')) {
        return res.status(status).json({
            success: false,
            message: status === 413
                ? (req.path.startsWith('/api/settings/logo') ? 'Ukuran logo maksimal 1 MB.' : 'Ukuran file melebihi batas 5GB.')
                : status === 400
                    ? (err.expose && err.message) || 'Request tidak valid.'
                    : 'Terjadi kesalahan pada server.',
        });
    }

    res.status(500).send('Terjadi kesalahan pada server.');
});

module.exports = app;
