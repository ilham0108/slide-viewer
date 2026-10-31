require('dotenv').config();

const app = require('./app');
const { initializeDatabase } = require('./database/initialize');
const pool = require('./database/pool');
const slideModel = require('./models/slideModel');
const slideSourceService = require('./services/slideSourceService');
const uploadSessionService = require('./services/uploadSessionService');
const logger = require('./utils/logger');

const log = logger.child('server');
const PORT = process.env.PORT || 3000;

process.on('unhandledRejection', error => log.error('Unhandled promise rejection', { error }));
process.on('uncaughtException', error => {
    log.error('Uncaught exception, shutting down', { error });
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 500);
});

/**
 * State such as the login attempt limiter lives in memory, so two servers on the same
 * database would each enforce only half of it. A MySQL named lock, held on a dedicated
 * connection for the lifetime of the process, makes a second instance refuse to start.
 */
async function acquireInstanceLock() {
    const connection = await pool.getConnection();
    const [[{ locked }]] = await connection.query(
        "SELECT GET_LOCK(CONCAT(DATABASE(), ':slide-viewer-server'), 0) AS locked"
    );
    if (locked !== 1) {
        connection.release();
        throw new Error('Another Slide Viewer server is already running on this database. Stop it before starting a new one.');
    }
    // Never released: MySQL frees the lock when this process (and its connection) ends.
}

async function startServer() {
    logger.scheduleLogCleanup();
    uploadSessionService.scheduleStaleSessionCleanup();
    log.info('Starting server', { node: process.version, pid: process.pid });

    await acquireInstanceLock();
    await initializeDatabase();
    log.info('Database ready', { host: process.env.MYSQL_HOST, database: process.env.MYSQL_DATABASE });
    const importedSlides = await slideModel.importExistingSlides();
    if (importedSlides > 0) log.info(`Registered ${importedSlides} existing DZI file(s) from public/slides`);

    const server = app.listen(PORT, () => {
        log.info(`Server running at: http://localhost:${PORT}`);
        // Waits for the tile service, so it runs in the background instead of delaying startup.
        slideSourceService.settleProcessingSlides()
            .catch(error => log.error('Failed to check slides left in processing', { error }))
            .then(() => slideSourceService.fillMissingMpp())
            .catch(error => log.error('Failed to read slide mpp', { error }));
    });
    server.on('error', error => {
        log.error(`Server could not listen on port ${PORT}`, { error });
        process.exitCode = 1;
    });
    // Node's default 5-minute request timeout cuts off multi-GB uploads on slower networks.
    server.requestTimeout = Number(process.env.UPLOAD_TIMEOUT_MINUTES || 120) * 60 * 1000;
}

startServer().catch(async error => {
    log.error('Failed to start the server. Verify the MySQL configuration and database availability, and that no other instance is running.', { error });
    try {
        await pool.end();
    } catch (shutdownError) {
        log.error('Failed to close the MySQL connection pool', { error: shutdownError });
    }
    process.exitCode = 1;
});
