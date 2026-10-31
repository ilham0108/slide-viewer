const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');
const { PERMISSIONS } = require('../config/permissions');
const { cleanString, badRequest } = require('../utils/validation');
const logger = require('../utils/logger');

const log = logger.child('auth');

// Simple in-memory brute-force protection: too many failed logins from one IP for one
// username blocks further attempts for a while. Enough for a single-instance server.
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedLogins = new Map();

function attemptKey(req, username) {
    return `${req.ip}|${username.toLowerCase()}`;
}

function isLockedOut(key) {
    const entry = failedLogins.get(key);
    if (!entry) return false;
    if (entry.resetAt < Date.now()) {
        failedLogins.delete(key);
        return false;
    }
    return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(key) {
    const entry = failedLogins.get(key);
    if (!entry || entry.resetAt < Date.now()) {
        failedLogins.set(key, { count: 1, resetAt: Date.now() + LOCKOUT_MS });
    } else {
        entry.count += 1;
    }
}

function serializeUser(user) {
    return {
        id: user.id,
        username: user.username,
        name: user.name,
        roleId: user.roleId,
        roleName: user.roleName,
        isAdmin: user.isAdmin,
        permissions: [...user.permissions],
    };
}

async function login(req, res, next) {
    const username = cleanString(req.body?.username, 64);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password) return badRequest(res, 'Username dan password wajib diisi.');

    const key = attemptKey(req, username);
    if (isLockedOut(key)) {
        log.warn(`Login blocked after repeated failures: ${username}`, { ip: req.ip });
        return res.status(429).json({ success: false, message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' });
    }

    const user = await userModel.findByUsername(username);
    const valid = user && user.is_active && await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        recordFailure(key);
        log.warn(`Failed login: ${username}`, { ip: req.ip });
        return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    failedLogins.delete(key);
    // A new session id on login prevents session fixation.
    req.session.regenerate(async error => {
        if (error) return next(error);
        req.session.userId = user.id;
        try {
            await userModel.touchLastLogin(user.id);
        } catch (touchError) {
            log.warn('Failed to store last login time', { error: touchError });
        }
        log.info(`User logged in: ${user.username}`, { ip: req.ip });
        res.json({ success: true });
    });
}

function logout(req, res, next) {
    const username = req.user?.username;
    req.session.destroy(error => {
        if (error) return next(error);
        res.clearCookie('sv.sid');
        if (username) log.info(`User logged out: ${username}`);
        res.json({ success: true });
    });
}

function me(req, res) {
    res.json({ user: serializeUser(req.user) });
}

function listPermissions(req, res) {
    res.json({ permissions: PERMISSIONS });
}

async function changePassword(req, res) {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (newPassword.length < 8 || newPassword.length > 128) {
        return badRequest(res, 'Password baru minimal 8 karakter.');
    }

    const user = await userModel.findById(req.user.id, { withPassword: true });
    if (!user || !await bcrypt.compare(currentPassword, user.password_hash)) {
        return badRequest(res, 'Password saat ini salah.');
    }

    await userModel.updatePassword(req.user.id, await bcrypt.hash(newPassword, 10));
    log.info(`Password changed: ${req.user.username}`);
    res.json({ success: true });
}

module.exports = {
    login,
    logout,
    me,
    listPermissions,
    changePassword,
};
