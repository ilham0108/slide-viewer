const pool = require('../database/pool');

async function listCategories() {
    const [rows] = await pool.query(`
        SELECT c.id, c.name, c.description, c.color, c.created_at, COUNT(cs.id) AS case_count
        FROM categories c LEFT JOIN cases cs ON cs.category_id = c.id
        GROUP BY c.id
        ORDER BY c.name
    `);
    return rows;
}

async function countUncategorizedCases() {
    const [[row]] = await pool.query('SELECT COUNT(*) AS total FROM cases WHERE category_id IS NULL');
    return row.total;
}

async function findById(id) {
    const [rows] = await pool.execute('SELECT id, name, description, color FROM categories WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
}

async function createCategory({ name, description, color }) {
    const [result] = await pool.execute(
        'INSERT INTO categories (name, description, color) VALUES (?, ?, ?)',
        [name, description, color]
    );
    return result.insertId;
}

async function updateCategory(id, { name, description, color }) {
    await pool.execute(
        'UPDATE categories SET name = ?, description = ?, color = ? WHERE id = ?',
        [name, description, color, id]
    );
}

async function countCases(id) {
    const [[row]] = await pool.execute('SELECT COUNT(*) AS total FROM cases WHERE category_id = ?', [id]);
    return row.total;
}

async function countSlides(id) {
    const [[row]] = await pool.execute('SELECT COUNT(*) AS total FROM slides WHERE case_id IS NULL AND category_id = ?', [id]);
    return row.total;
}

async function deleteCategory(id) {
    await pool.execute('DELETE FROM categories WHERE id = ?', [id]);
}

module.exports = {
    listCategories,
    countUncategorizedCases,
    findById,
    createCategory,
    updateCategory,
    countCases,
    countSlides,
    deleteCategory,
};
