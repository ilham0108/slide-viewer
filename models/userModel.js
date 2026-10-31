const pool = require('../database/pool');

const USER_COLUMNS = `
    u.id, u.username, u.name, u.role_id, u.is_active, u.last_login_at, u.created_at,
    r.name AS role_name, r.is_system AS role_is_system
`;

async function findByUsername(username) {
    const [rows] = await pool.execute(
        `SELECT ${USER_COLUMNS}, u.password_hash
        FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.username = ? LIMIT 1`,
        [username]
    );
    return rows[0] || null;
}

async function findById(id, { withPassword = false } = {}) {
    const [rows] = await pool.execute(
        `SELECT ${USER_COLUMNS}${withPassword ? ', u.password_hash' : ''}
        FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = ? LIMIT 1`,
        [id]
    );
    return rows[0] || null;
}

async function listUsers() {
    const [rows] = await pool.query(
        `SELECT ${USER_COLUMNS}
        FROM users u JOIN roles r ON r.id = u.role_id
        ORDER BY u.name, u.username`
    );
    return rows;
}

async function createUser({ username, name, passwordHash, roleId, isActive }) {
    const [result] = await pool.execute(
        'INSERT INTO users (username, name, password_hash, role_id, is_active) VALUES (?, ?, ?, ?, ?)',
        [username, name, passwordHash, roleId, isActive ? 1 : 0]
    );
    return result.insertId;
}

async function updateUser(id, { name, roleId, isActive }) {
    await pool.execute(
        'UPDATE users SET name = ?, role_id = ?, is_active = ? WHERE id = ?',
        [name, roleId, isActive ? 1 : 0, id]
    );
}

async function updatePassword(id, passwordHash) {
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

async function touchLastLogin(id) {
    await pool.execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

async function deleteUser(id) {
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
}

async function countActiveAdmins() {
    const [[row]] = await pool.query(
        `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.is_system = 1 AND u.is_active = 1`
    );
    return row.total;
}

module.exports = {
    findByUsername,
    findById,
    listUsers,
    createUser,
    updateUser,
    updatePassword,
    touchLastLogin,
    deleteUser,
    countActiveAdmins,
};
