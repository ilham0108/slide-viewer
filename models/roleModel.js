const pool = require('../database/pool');
const { PERMISSION_KEYS } = require('../config/permissions');

async function listRoles() {
    const [roles] = await pool.query(`
        SELECT r.id, r.name, r.description, r.is_system, COUNT(u.id) AS user_count
        FROM roles r LEFT JOIN users u ON u.role_id = r.id
        GROUP BY r.id
        ORDER BY r.is_system DESC, r.name
    `);
    const [permissions] = await pool.query('SELECT role_id, permission FROM role_permissions');
    const byRole = new Map();
    for (const row of permissions) {
        if (!byRole.has(row.role_id)) byRole.set(row.role_id, []);
        byRole.get(row.role_id).push(row.permission);
    }
    return roles.map(role => ({
        ...role,
        permissions: role.is_system ? [...PERMISSION_KEYS] : byRole.get(role.id) || [],
    }));
}

async function findById(id) {
    const [rows] = await pool.execute('SELECT id, name, description, is_system FROM roles WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
}

/** The system role always has every permission, including ones added after it was created. */
async function getPermissions(role) {
    if (role.is_system) return [...PERMISSION_KEYS];
    const [rows] = await pool.execute('SELECT permission FROM role_permissions WHERE role_id = ?', [role.id]);
    return rows.map(row => row.permission).filter(permission => PERMISSION_KEYS.includes(permission));
}

async function replacePermissions(connection, roleId, permissions) {
    await connection.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
    if (permissions.length) {
        await connection.query(
            'INSERT INTO role_permissions (role_id, permission) VALUES ?',
            [permissions.map(permission => [roleId, permission])]
        );
    }
}

async function createRole({ name, description, permissions }) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
            'INSERT INTO roles (name, description) VALUES (?, ?)',
            [name, description]
        );
        await replacePermissions(connection, result.insertId, permissions);
        await connection.commit();
        return result.insertId;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function updateRole(id, { name, description, permissions }) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute('UPDATE roles SET name = ?, description = ? WHERE id = ?', [name, description, id]);
        await replacePermissions(connection, id, permissions);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function countUsers(id) {
    const [[row]] = await pool.execute('SELECT COUNT(*) AS total FROM users WHERE role_id = ?', [id]);
    return row.total;
}

async function deleteRole(id) {
    await pool.execute('DELETE FROM roles WHERE id = ?', [id]);
}

module.exports = {
    listRoles,
    findById,
    getPermissions,
    createRole,
    updateRole,
    countUsers,
    deleteRole,
};
