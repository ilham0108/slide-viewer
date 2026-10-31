const pool = require('../database/pool');

const SHARE_COLUMNS = `
    sl.id, sl.token, sl.resource_type, sl.resource_id, sl.title, sl.view_state,
    sl.password_hash IS NOT NULL AS has_password, sl.expires_at, sl.hide_clinical, sl.show_annotations,
    sl.allow_annotation_edit,
    sl.created_by, sl.created_at, sl.revoked_at, sl.view_count, sl.last_viewed_at,
    u.name AS created_by_name
`;

function parseViewState(row) {
    if (!row) return row;
    const viewState = typeof row.view_state === 'string' ? JSON.parse(row.view_state) : row.view_state;
    return { ...row, view_state: viewState };
}

async function createShare({ token, resourceType, resourceId, title, viewState, passwordHash, expiresAt, hideClinical, showAnnotations, allowAnnotationEdit, createdBy }) {
    const [result] = await pool.execute(
        `INSERT INTO share_links
            (token, resource_type, resource_id, title, view_state, password_hash, expires_at,
             hide_clinical, show_annotations, allow_annotation_edit, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            token, resourceType, resourceId, title,
            viewState ? JSON.stringify(viewState) : null,
            passwordHash, expiresAt, hideClinical ? 1 : 0, showAnnotations ? 1 : 0, allowAnnotationEdit ? 1 : 0, createdBy,
        ]
    );
    return result.insertId;
}

async function findById(id) {
    const [rows] = await pool.execute(
        `SELECT ${SHARE_COLUMNS} FROM share_links sl LEFT JOIN users u ON u.id = sl.created_by WHERE sl.id = ? LIMIT 1`,
        [id]
    );
    return parseViewState(rows[0]) || null;
}

/** Includes the password hash: only for checking a public visitor's password. */
async function findByToken(token) {
    const [rows] = await pool.execute(
        `SELECT ${SHARE_COLUMNS}, sl.password_hash
        FROM share_links sl LEFT JOIN users u ON u.id = sl.created_by
        WHERE sl.token = ? LIMIT 1`,
        [token]
    );
    return parseViewState(rows[0]) || null;
}

/** Share history with a readable target name; createdBy limits it to one user's links. */
async function listShares({ createdBy } = {}) {
    const [rows] = await pool.query(
        `SELECT ${SHARE_COLUMNS},
            CASE sl.resource_type
                WHEN 'slide' THEN s.original_name
                WHEN 'case' THEN CONCAT(cs.case_number, ' — ', cs.title)
                WHEN 'category' THEN cat.name
                ELSE NULL
            END AS target_name
        FROM share_links sl
        LEFT JOIN users u ON u.id = sl.created_by
        LEFT JOIN slides s ON sl.resource_type = 'slide' AND s.id = sl.resource_id
        LEFT JOIN cases cs ON sl.resource_type = 'case' AND cs.id = sl.resource_id
        LEFT JOIN categories cat ON sl.resource_type = 'category' AND cat.id = sl.resource_id
        ${createdBy ? 'WHERE sl.created_by = ?' : ''}
        ORDER BY sl.created_at DESC, sl.id DESC`,
        createdBy ? [createdBy] : []
    );
    return rows.map(parseViewState);
}

async function revokeShare(id) {
    await pool.execute('UPDATE share_links SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL', [id]);
}

async function recordView(id) {
    await pool.execute(
        'UPDATE share_links SET view_count = view_count + 1, last_viewed_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
    );
}

module.exports = {
    createShare,
    findById,
    findByToken,
    listShares,
    revokeShare,
    recordView,
};
