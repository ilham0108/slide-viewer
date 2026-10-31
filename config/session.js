const crypto = require('crypto');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const pool = require('../database/pool');
const CachedSessionStore = require('../utils/cachedSessionStore');
const logger = require('../utils/logger');

const log = logger.child('server');
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_HOURS || 12) * 60 * 60 * 1000;

let secret = process.env.SESSION_SECRET;
if (!secret) {
    // Works, but every restart signs everyone out. Set SESSION_SECRET in .env.
    secret = crypto.randomBytes(32).toString('hex');
    log.warn('SESSION_SECRET is not set; using a random secret. Users are signed out on every restart.');
}

// Sessions live in MySQL (table "sessions", created automatically) so they survive restarts.
// The cache in front keeps tile requests from querying MySQL for the session every time.
const mysqlStore = new MySQLStore({ clearExpired: true, checkExpirationInterval: 15 * 60 * 1000 }, pool);
const store = new CachedSessionStore(mysqlStore);

const sessionMiddleware = session({
    name: 'sv.sid',
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // Set COOKIE_SECURE=true when the app is served over HTTPS.
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: SESSION_MAX_AGE_MS,
    },
});

module.exports = {
    sessionMiddleware,
    sessionStore: store,
};
