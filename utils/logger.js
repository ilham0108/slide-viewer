const fs = require('fs');
const path = require('path');
const util = require('util');
const { LOG_DIR } = require('../config/paths');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
const RETENTION_DAYS = Math.max(1, Number(process.env.LOG_RETENTION_DAYS) || 30);

fs.mkdirSync(LOG_DIR, { recursive: true });

function pad(value, length = 2) {
    return String(value).padStart(length, '0');
}

// Local time with UTC offset, e.g. 2026-10-18T19:40:12.345+07:00, so log lines match the wall clock.
function timestamp(date = new Date()) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
        + `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

function formatMeta(meta) {
    if (meta === undefined) return '';
    if (meta instanceof Error) return `\n${meta.stack || meta.message}`;
    if (meta && typeof meta === 'object') {
        const { error, ...rest } = meta;
        const defined = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
        const fields = Object.keys(defined).length ? ` ${JSON.stringify(defined)}` : '';
        const stack = error instanceof Error ? `\n${error.stack || error.message}` : '';
        return fields + stack;
    }
    return ` ${util.inspect(meta)}`;
}

/** Append-only stream that switches to a new file when the local date changes. */
class DailyFile {
    constructor(prefix) {
        this.prefix = prefix;
        this.date = null;
        this.stream = null;
    }

    write(line) {
        const today = timestamp().slice(0, 10);
        if (today !== this.date) {
            this.stream?.end();
            this.date = today;
            this.stream = fs.createWriteStream(path.join(LOG_DIR, `${this.prefix}-${today}.log`), { flags: 'a' });
            this.stream.on('error', error => process.stderr.write(`Log write failed: ${error.message}\n`));
        }
        this.stream.write(line);
    }
}

const appFile = new DailyFile('app');
const errorFile = new DailyFile('error');

function write(level, scope, message, meta) {
    if (LEVELS[level] < MIN_LEVEL) return;
    const line = `${timestamp()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${formatMeta(meta)}\n`;
    appFile.write(line);
    if (LEVELS[level] >= LEVELS.warn) errorFile.write(line);
    (LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout).write(line);
}

/**
 * Returns a logger for one part of the app. Usage:
 *   const log = logger.child('upload');
 *   log.info('Upload received', { file: 'a.svs', bytes: 123 });
 */
function child(scope) {
    return {
        debug: (message, meta) => write('debug', scope, message, meta),
        info: (message, meta) => write('info', scope, message, meta),
        warn: (message, meta) => write('warn', scope, message, meta),
        error: (message, meta) => write('error', scope, message, meta),
    };
}

/** Deletes daily app/error logs older than LOG_RETENTION_DAYS. */
function removeOldLogs() {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(LOG_DIR)) {
        if (!/^(app|error)-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
        const filePath = path.join(LOG_DIR, name);
        try {
            if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
        } catch (error) {
            process.stderr.write(`Failed to remove old log ${name}: ${error.message}\n`);
        }
    }
}

function scheduleLogCleanup() {
    removeOldLogs();
    setInterval(removeOldLogs, 24 * 60 * 60 * 1000).unref();
}

module.exports = {
    child,
    scheduleLogCleanup,
};
