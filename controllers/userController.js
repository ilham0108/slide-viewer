const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');
const roleModel = require('../models/roleModel');
const { clearUserCache } = require('../middleware/auth');
const { parseId, cleanString, badRequest, notFound, conflict, isDuplicateKey } = require('../utils/validation');
const logger = require('../utils/logger');

const log = logger.child('users');
const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/i;

function serialize(row) {
    return {
        id: row.id,
        username: row.username,
        name: row.name,
        roleId: row.role_id,
        roleName: row.role_name,
        isActive: Boolean(row.is_active),
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
    };
}

async function readUserInput(req, res, { isNew }) {
    const name = cleanString(req.body?.name, 150);
    const roleId = parseId(req.body?.roleId);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const isActive = req.body?.isActive !== false;

    if (!name) return badRequest(res, 'Nama wajib diisi (maksimal 150 karakter).');
    if (!roleId || !await roleModel.findById(roleId)) return badRequest(res, 'Role tidak valid.');
    if ((isNew || password) && (password.length < 8 || password.length > 128)) {
        return badRequest(res, 'Password minimal 8 karakter.');
    }
    return { name, roleId, password, isActive };
}

async function listUsers(req, res) {
    res.json({ users: (await userModel.listUsers()).map(serialize) });
}

async function createUser(req, res) {
    const username = cleanString(req.body?.username, 64);
    if (!username || !USERNAME_PATTERN.test(username)) {
        return badRequest(res, 'Username 3–64 karakter, hanya huruf, angka, titik, garis bawah, atau strip.');
    }
    const input = await readUserInput(req, res, { isNew: true });
    if (!input) return;

    try {
        const id = await userModel.createUser({
            username,
            name: input.name,
            passwordHash: await bcrypt.hash(input.password, 10),
            roleId: input.roleId,
            isActive: input.isActive,
        });
        log.info(`User created: ${username}`, { by: req.user.username });
        res.status(201).json({ user: serialize(await userModel.findById(id)) });
    } catch (error) {
        if (isDuplicateKey(error)) return conflict(res, 'Username sudah digunakan.');
        throw error;
    }
}

async function updateUser(req, res) {
    const id = parseId(req.params.userId);
    if (!id) return badRequest(res, 'ID user tidak valid.');
    const existing = await userModel.findById(id);
    if (!existing) return notFound(res, 'User tidak ditemukan.');

    const input = await readUserInput(req, res, { isNew: false });
    if (!input) return;

    if (id === req.user.id && (!input.isActive || input.roleId !== existing.role_id)) {
        return badRequest(res, 'Anda tidak dapat menonaktifkan atau mengubah role akun sendiri.');
    }
    // Keep at least one active administrator so the system cannot be locked out.
    const newRole = await roleModel.findById(input.roleId);
    const losesAdmin = existing.role_is_system && existing.is_active && (!input.isActive || !newRole.is_system);
    if (losesAdmin && await userModel.countActiveAdmins() <= 1) {
        return badRequest(res, 'Harus ada minimal satu administrator aktif.');
    }

    await userModel.updateUser(id, input);
    if (input.password) await userModel.updatePassword(id, await bcrypt.hash(input.password, 10));
    clearUserCache();
    log.info(`User updated: ${existing.username}`, { by: req.user.username, passwordReset: Boolean(input.password) });
    res.json({ user: serialize(await userModel.findById(id)) });
}

async function deleteUser(req, res) {
    const id = parseId(req.params.userId);
    if (!id) return badRequest(res, 'ID user tidak valid.');
    if (id === req.user.id) return badRequest(res, 'Anda tidak dapat menghapus akun sendiri.');
    const existing = await userModel.findById(id);
    if (!existing) return notFound(res, 'User tidak ditemukan.');
    if (existing.role_is_system && existing.is_active && await userModel.countActiveAdmins() <= 1) {
        return badRequest(res, 'Harus ada minimal satu administrator aktif.');
    }

    await userModel.deleteUser(id);
    clearUserCache();
    log.info(`User deleted: ${existing.username}`, { by: req.user.username });
    res.json({ success: true });
}

module.exports = {
    listUsers,
    createUser,
    updateUser,
    deleteUser,
};
