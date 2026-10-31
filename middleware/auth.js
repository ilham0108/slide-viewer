const userModel = require('../models/userModel');
const roleModel = require('../models/roleModel');

// Tile requests arrive by the hundreds per second while panning, so the signed-in user
// and their permissions are cached briefly instead of queried on every request.
// Changes to users or roles call clearUserCache() so they apply immediately.
const CACHE_TTL_MS = 15 * 1000;
const userCache = new Map();

function clearUserCache() {
    userCache.clear();
}

async function loadUser(userId) {
    const cached = userCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const row = await userModel.findById(userId);
    let user = null;
    if (row && row.is_active) {
        const permissions = await roleModel.getPermissions({ id: row.role_id, is_system: row.role_is_system });
        user = {
            id: row.id,
            username: row.username,
            name: row.name,
            roleId: row.role_id,
            roleName: row.role_name,
            // The Administrator role (is_system) also sees who uploaded each slide.
            isAdmin: Boolean(row.role_is_system),
            permissions: new Set(permissions),
        };
    }
    userCache.set(userId, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    return user;
}

function rejectUnauthenticated(req, res) {
    if (req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu.' });
    }
    res.status(401).send('Unauthorized');
}

/** Sets req.user from the session, or answers 401. Deactivated users lose their session. */
async function requireAuth(req, res, next) {
    const userId = req.session?.userId;
    if (!userId) return rejectUnauthenticated(req, res);

    try {
        const user = await loadUser(userId);
        if (!user) {
            req.session.destroy(() => rejectUnauthenticated(req, res));
            return;
        }
        req.user = user;
        next();
    } catch (error) {
        next(error);
    }
}

/** Allows the request when the user has at least one of the given permissions. */
function requirePermission(...permissions) {
    return (req, res, next) => {
        if (permissions.some(permission => req.user?.permissions.has(permission))) return next();
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses untuk tindakan ini.' });
        }
        res.status(403).send('Forbidden');
    };
}

module.exports = {
    requireAuth,
    requirePermission,
    clearUserCache,
};
