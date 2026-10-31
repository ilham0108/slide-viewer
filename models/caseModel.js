const pool = require('../database/pool');

const CASE_COLUMNS = `
    cs.id, cs.case_number, cs.title, cs.category_id, cs.status, cs.description,
    cs.created_at, cs.updated_at, cs.created_by,
    cat.name AS category_name, cat.color AS category_color,
    u.name AS created_by_name
`;
const CASE_JOINS = `
    FROM cases cs
    LEFT JOIN categories cat ON cat.id = cs.category_id
    LEFT JOIN users u ON u.id = cs.created_by
`;

function casesFilter({ search, categoryId, status }) {
    const conditions = [];
    const params = [];
    if (search) {
        conditions.push('(cs.case_number LIKE ? OR cs.title LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
    }
    if (categoryId === 'none') {
        conditions.push('cs.category_id IS NULL');
    } else if (categoryId) {
        conditions.push('cs.category_id = ?');
        params.push(categoryId);
    }
    if (status) {
        conditions.push('cs.status = ?');
        params.push(status);
    }
    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

/** Cases matching the filters, newest first; with `limit` only that page (see countCases). */
async function listCases({ search, categoryId, status, limit, offset = 0 }) {
    const { where, params } = casesFilter({ search, categoryId, status });
    const [rows] = await pool.query(
        `SELECT ${CASE_COLUMNS},
            (SELECT COUNT(*) FROM slides s WHERE s.case_id = cs.id) AS slide_count
        ${CASE_JOINS}
        ${where}
        ORDER BY cs.created_at DESC, cs.id DESC
        ${limit ? 'LIMIT ? OFFSET ?' : ''}`,
        limit ? [...params, limit, offset] : params
    );
    return rows;
}

async function countCases(filters) {
    const { where, params } = casesFilter(filters);
    const [[row]] = await pool.query(`SELECT COUNT(*) AS total ${CASE_JOINS} ${where}`, params);
    return Number(row.total);
}

async function findById(id) {
    const [rows] = await pool.execute(`SELECT ${CASE_COLUMNS} ${CASE_JOINS} WHERE cs.id = ? LIMIT 1`, [id]);
    return rows[0] || null;
}

async function createCase({ caseNumber, title, categoryId, status, description, createdBy }) {
    const [result] = await pool.execute(
        `INSERT INTO cases (case_number, title, category_id, status, description, created_by)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [caseNumber, title, categoryId, status, description, createdBy]
    );
    return result.insertId;
}

async function updateCase(id, { caseNumber, title, categoryId, status, description }) {
    await pool.execute(
        `UPDATE cases SET case_number = ?, title = ?, category_id = ?, status = ?, description = ?
        WHERE id = ?`,
        [caseNumber, title, categoryId, status, description, id]
    );
}

async function countSlides(id) {
    const [[row]] = await pool.execute('SELECT COUNT(*) AS total FROM slides WHERE case_id = ?', [id]);
    return row.total;
}

async function deleteCase(id) {
    await pool.execute('DELETE FROM cases WHERE id = ?', [id]);
}

module.exports = {
    listCases,
    countCases,
    findById,
    createCase,
    updateCase,
    countSlides,
    deleteCase,
};
