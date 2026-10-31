const roleModel = require('../models/roleModel');
const { PERMISSION_KEYS } = require('../config/permissions');
const { clearUserCache } = require('../middleware/auth');
const { parseId, cleanString, badRequest, notFound, conflict, isDuplicateKey } = require('../utils/validation');
const logger = require('../utils/logger');

const log = logger.child('roles');

function serialize(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        isSystem: Boolean(row.is_system),
        userCount: row.user_count,
        permissions: row.permissions,
    };
}

function readRoleInput(req, res) {
    const name = cleanString(req.body?.name, 100);
    const description = cleanString(req.body?.description, 255);
    const permissions = req.body?.permissions;
    if (!name) return badRequest(res, 'Nama role wajib diisi (maksimal 100 karakter).');
    if (description === null) return badRequest(res, 'Deskripsi maksimal 255 karakter.');
    if (!Array.isArray(permissions) || permissions.some(permission => !PERMISSION_KEYS.includes(permission))) {
        return badRequest(res, 'Daftar permission tidak valid.');
    }
    return { name, description: description || null, permissions: [...new Set(permissions)] };
}

async function findRole(id) {
    return (await roleModel.listRoles()).find(role => role.id === id);
}

async function listRoles(req, res) {
    res.json({ roles: (await roleModel.listRoles()).map(serialize) });
}

async function createRole(req, res) {
    const input = readRoleInput(req, res);
    if (!input) return;
    try {
        const id = await roleModel.createRole(input);
        log.info(`Role created: ${input.name}`, { by: req.user.username, permissions: input.permissions });
        res.status(201).json({ role: serialize(await findRole(id)) });
    } catch (error) {
        if (isDuplicateKey(error)) return conflict(res, 'Nama role sudah digunakan.');
        throw error;
    }
}

async function updateRole(req, res) {
    const id = parseId(req.params.roleId);
    if (!id) return badRequest(res, 'ID role tidak valid.');
    const existing = await roleModel.findById(id);
    if (!existing) return notFound(res, 'Role tidak ditemukan.');
    if (existing.is_system) return badRequest(res, 'Role sistem tidak dapat diubah.');

    const input = readRoleInput(req, res);
    if (!input) return;
    try {
        await roleModel.updateRole(id, input);
    } catch (error) {
        if (isDuplicateKey(error)) return conflict(res, 'Nama role sudah digunakan.');
        throw error;
    }
    clearUserCache();
    log.info(`Role updated: ${input.name}`, { by: req.user.username, permissions: input.permissions });
    res.json({ role: serialize(await findRole(id)) });
}

async function deleteRole(req, res) {
    const id = parseId(req.params.roleId);
    if (!id) return badRequest(res, 'ID role tidak valid.');
    const existing = await roleModel.findById(id);
    if (!existing) return notFound(res, 'Role tidak ditemukan.');
    if (existing.is_system) return badRequest(res, 'Role sistem tidak dapat dihapus.');
    const userCount = await roleModel.countUsers(id);
    if (userCount > 0) return conflict(res, `Role masih dipakai oleh ${userCount} user.`);

    await roleModel.deleteRole(id);
    log.info(`Role deleted: ${existing.name}`, { by: req.user.username });
    res.json({ success: true });
}

module.exports = {
    listRoles,
    createRole,
    updateRole,
    deleteRole,
};
