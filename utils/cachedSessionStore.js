const session = require('express-session');

/**
 * Wraps a session store with a short in-memory cache.
 *
 * Every request carries the session cookie, including the hundreds of tile requests a
 * viewer makes while panning. Without this, each of them reads the session from MySQL and,
 * because sessions roll, writes its new expiry back: two queries per tile. Here reads are
 * served from memory for `ttlMs`, and expiry writes ("touch") reach the inner store at
 * most once per `touchIntervalMs` per session; sessions last hours, so that is harmless.
 *
 * Writes (login, logout, changed session data) still go straight to the inner store and
 * update the cache, so they take effect at once. Only one server runs per database (see
 * index.js), so no other process can change a session behind this cache.
 */
class CachedSessionStore extends session.Store {
    constructor(inner, { ttlMs = 30 * 1000, touchIntervalMs = 60 * 1000, maxEntries = 10000 } = {}) {
        super();
        this.inner = inner;
        this.ttlMs = ttlMs;
        this.touchIntervalMs = touchIntervalMs;
        this.maxEntries = maxEntries;
        // sid -> { data: JSON string or null (no such session), expiresAt }
        this.entries = new Map();
        // sid -> time the inner store was last touched
        this.lastTouch = new Map();
    }

    remember(sid, sess) {
        // Kept as JSON, so every request gets its own copy (express-session mutates it) and
        // it looks exactly like what the MySQL store returns.
        this.entries.delete(sid);
        this.entries.set(sid, { data: sess ? JSON.stringify(sess) : null, expiresAt: Date.now() + this.ttlMs });
        // Oldest first in a Map: drop the oldest when full (unknown cookies count too).
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            this.entries.delete(oldest);
            this.lastTouch.delete(oldest);
        }
    }

    forget(sid) {
        this.entries.delete(sid);
        this.lastTouch.delete(sid);
    }

    get(sid, callback) {
        const entry = this.entries.get(sid);
        if (entry && entry.expiresAt > Date.now()) {
            return callback(null, entry.data === null ? null : JSON.parse(entry.data));
        }
        this.inner.get(sid, (error, sess) => {
            if (!error) this.remember(sid, sess || null);
            callback(error, sess);
        });
    }

    set(sid, sess, callback) {
        this.inner.set(sid, sess, error => {
            if (error) this.forget(sid);
            else {
                this.remember(sid, sess);
                this.lastTouch.set(sid, Date.now());
            }
            callback?.(error);
        });
    }

    destroy(sid, callback) {
        this.forget(sid);
        this.inner.destroy(sid, callback);
    }

    touch(sid, sess, callback) {
        // The cached copy carries the new expiry even when the database write is skipped.
        if (this.entries.has(sid)) this.remember(sid, sess);
        const last = this.lastTouch.get(sid) || 0;
        if (Date.now() - last < this.touchIntervalMs) return callback?.();
        this.lastTouch.set(sid, Date.now());
        this.inner.touch(sid, sess, error => {
            if (error) this.lastTouch.delete(sid);
            callback?.(error);
        });
    }

    all(callback) {
        this.inner.all(callback);
    }

    length(callback) {
        this.inner.length(callback);
    }

    clear(callback) {
        this.entries.clear();
        this.lastTouch.clear();
        this.inner.clear(callback);
    }
}

module.exports = CachedSessionStore;
