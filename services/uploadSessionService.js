const crypto = require('crypto');
const fs = require('fs/promises');
const { createWriteStream } = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { UPLOAD_DIR } = require('../config/paths');
const { storedUploadName } = require('../config/upload');
const logger = require('../utils/logger');

const log = logger.child('upload');

/**
 * Resumable uploads. The browser sends a file in chunks; each session keeps the bytes
 * received so far in uploads/.partial/<id>.part and its details in <id>.json. The size of
 * the .part file is the offset to continue from, so an upload survives a dropped
 * connection, a closed tab or a server restart.
 */
const PARTIAL_DIR = path.join(UPLOAD_DIR, '.partial');
// The browser sends 8 MB; a little headroom for other clients.
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
// Sessions nobody continued for this long are deleted.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[a-f0-9]{32}$/;

// Session ids with a chunk being written; a second chunk for the same session is refused.
const writing = new Set();

class UploadSessionError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        Object.assign(this, extra);
    }
}

const metaPath = id => path.join(PARTIAL_DIR, `${id}.json`);
const dataPath = id => path.join(PARTIAL_DIR, `${id}.part`);

/** The finished file goes into case `caseId`, or (caseId null) straight into category `categoryId`. */
async function createSession({ caseId = null, categoryId = null, userId, fileName, size }) {
    await fs.mkdir(PARTIAL_DIR, { recursive: true });
    const id = crypto.randomBytes(16).toString('hex');
    const session = { id, caseId, categoryId, userId, fileName: path.basename(fileName), size, createdAt: new Date().toISOString() };
    await fs.writeFile(dataPath(id), '');
    await fs.writeFile(metaPath(id), JSON.stringify(session));
    log.info(`Upload started: ${session.fileName}`, { session: id, sizeMB: Number((size / 1024 / 1024).toFixed(1)), caseId, categoryId });
    return { ...session, offset: 0 };
}

async function readSession(id) {
    const session = JSON.parse(await fs.readFile(metaPath(id), 'utf8'));
    const { size: offset, mtimeMs } = await fs.stat(dataPath(id));
    return { ...session, offset, updatedAt: new Date(mtimeMs).toISOString(), receiving: writing.has(id) };
}

/**
 * The session with its current offset, or null if it does not exist or belongs to someone
 * else (`anyUser` lifts that check, for administrators).
 */
async function getSession(id, userId, { anyUser = false } = {}) {
    if (!ID_PATTERN.test(id || '')) return null;
    try {
        const session = await readSession(id);
        return anyUser || session.userId === userId ? session : null;
    } catch {
        return null;
    }
}

/** Unfinished uploads, newest activity first; only those of `userId` unless it is null. */
async function listSessions(userId = null) {
    let names;
    try {
        names = await fs.readdir(PARTIAL_DIR);
    } catch {
        return [];
    }
    const sessions = [];
    for (const name of names.filter(item => item.endsWith('.json'))) {
        try {
            const session = await readSession(name.slice(0, -'.json'.length));
            if (userId === null || session.userId === userId) sessions.push(session);
        } catch {
            // Removed meanwhile (finished or cancelled).
        }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Appends one chunk read from `stream`. `offset` must equal the bytes already received,
 * so a retried chunk is never written twice. Returns the new offset.
 */
async function appendChunk(session, offset, stream) {
    if (writing.has(session.id)) throw new UploadSessionError(409, 'Potongan lain sedang diterima.', { offset: session.offset });
    if (offset !== session.offset) throw new UploadSessionError(409, 'Posisi upload tidak cocok.', { offset: session.offset });

    writing.add(session.id);
    let received = 0;
    const limit = Math.min(MAX_CHUNK_BYTES, session.size - session.offset);
    const counter = new Transform({
        transform(chunk, _, callback) {
            received += chunk.length;
            if (received > limit) return callback(new UploadSessionError(413, 'Potongan upload terlalu besar.'));
            callback(null, chunk);
        },
    });
    try {
        await pipeline(stream, counter, createWriteStream(dataPath(session.id), { flags: 'a' }));
    } catch (error) {
        if (error instanceof UploadSessionError) {
            // Drop the oversized chunk; the client continues from the previous offset.
            await fs.truncate(dataPath(session.id), session.offset).catch(() => {});
            throw error;
        }
        // A dropped connection keeps the bytes that arrived; the client asks for the offset.
    } finally {
        writing.delete(session.id);
    }
    const { size } = await fs.stat(dataPath(session.id));
    return size;
}

/** Moves a complete upload into the upload folder and returns its stored file name. */
async function completeSession(session) {
    const fileName = storedUploadName(session.fileName);
    await fs.rename(dataPath(session.id), path.join(UPLOAD_DIR, fileName));
    await fs.rm(metaPath(session.id), { force: true });
    return fileName;
}

async function deleteSession(id) {
    await Promise.all([
        fs.rm(dataPath(id), { force: true }),
        fs.rm(metaPath(id), { force: true }),
    ]);
}

/** Deletes sessions that received nothing for SESSION_TTL_MS. */
async function removeStaleSessions() {
    let names;
    try {
        names = await fs.readdir(PARTIAL_DIR);
    } catch {
        return;
    }
    const cutoff = Date.now() - SESSION_TTL_MS;
    let removed = 0;
    for (const name of names.filter(item => item.endsWith('.json'))) {
        const id = name.slice(0, -'.json'.length);
        if (writing.has(id)) continue;
        try {
            const { mtimeMs } = await fs.stat(dataPath(id)).catch(() => fs.stat(metaPath(id)));
            if (mtimeMs >= cutoff) continue;
            await deleteSession(id);
            removed += 1;
        } catch (error) {
            log.warn('Failed to remove stale upload session', { session: id, error });
        }
    }
    if (removed) log.info(`Removed ${removed} unfinished upload(s) older than 24 hours`);
}

function scheduleStaleSessionCleanup() {
    removeStaleSessions();
    setInterval(removeStaleSessions, 6 * 60 * 60 * 1000).unref();
}

module.exports = {
    MAX_CHUNK_BYTES,
    UploadSessionError,
    createSession,
    getSession,
    listSessions,
    appendChunk,
    completeSession,
    deleteSession,
    scheduleStaleSessionCleanup,
};
